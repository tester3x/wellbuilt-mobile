// src/services/driverAuth.ts
// Driver authentication using Firebase and SHA-256 hashed passcodes
//
// How it works:
// 1. Driver enters name + passcode
// 2. App SHA-256 hashes the passcode client-side
// 3. Login: Find driver by passcode hash, verify name matches
// 4. Registration: Post to drivers/pending/, admin approves to drivers/approved/
//
// Security:
// - Passcode is never sent in plaintext
// - Hash is computed client-side before transmission
// - Admin sets active=false or deletes from Firebase to revoke access
//
// Structure:
// - drivers/approved/{passcodeHash}/ = { displayName, active, approvedAt, isAdmin? }
// - drivers/pending/{key}/ = { displayName, passcodeHash, requestedAt }

import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { diagnoseThrown } from "./connectionDiagnosis";
import { normalizeRouteList } from "./eligibility";
import { wipeDurableWellConfigCache, clearWbmMemoryCatalog } from "./wellConfig";
import {
  claimSessionGeneration,
  getSessionGeneration,
  permitGenerationCurrent,
  runSessionTransition,
  type SessionLogoutPermit,
} from "./wbmSessionFence";

// Firebase configuration (same as firebase.ts)
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";

/** Device writes are incompatible with proposed read-only device rules. */
export const DEVICE_MANAGEMENT_AVAILABLE = false;

// Firebase paths
const DRIVERS_PENDING = "drivers/pending";
const DRIVERS_APPROVED = "drivers/approved";

// --- Interfaces ---

export interface DriverInfo {
  driverId: string;
  displayName: string;
  passcodeHash: string;
  approvedAt: string;
  active: boolean;
}

export type CompanyTier = 'free' | 'field' | 'god';

export interface DriverSession {
  driverId: string;
  displayName: string;
  isAdmin: boolean;
  isViewer: boolean;
  companyId?: string;
  companyName?: string;
  tier?: CompanyTier;
  roles?: string[];
  assignedRoutes?: string[];
  assignedCustomers?: unknown;
  authMethod?: 'sso' | 'manual';
}

// --- Firebase helpers ---

const FETCH_TIMEOUT_MS = 10000; // 10s timeout prevents indefinite hangs

const buildFirebaseUrl = async (path: string): Promise<string> => {
  const { getValidIdToken } = await import('./firebaseAuthSession');
  const token = await getValidIdToken();
  return `${FIREBASE_DATABASE_URL}/${path}.json?auth=${encodeURIComponent(token)}`;
};

/** fetch() with AbortController timeout — prevents app hang on slow/dead network. */
const fetchWithTimeout = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const firebaseGet = async (path: string): Promise<any> => {
  const url = await buildFirebaseUrl(path);
  const response = await fetchWithTimeout(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Firebase GET failed (${response.status})`);
  }

  return response.json();
};

const firebasePost = async (path: string, data: any): Promise<string> => {
  const url = await buildFirebaseUrl(path);
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Firebase POST failed (${response.status})`);
  }

  const result = await response.json();
  return result.name; // Firebase returns {"name": "generated-key"}
};

const firebasePatch = async (path: string, data: any): Promise<void> => {
  const url = await buildFirebaseUrl(path);
  const response = await fetchWithTimeout(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Firebase PATCH failed (${response.status})`);
  }
};

// --- Crypto helpers ---

/**
 * Hash a passcode using SHA-256
 * Returns lowercase hex string
 */
export const hashPasscode = async (passcode: string, name?: string): Promise<string> => {
  const input = name ? name.toLowerCase().trim() + passcode : passcode;
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input
  );
  return hash.toLowerCase();
};

/**
 * Generate a unique device ID for this installation
 * Used for tracking purposes only (not for auth)
 * Stored in SecureStore so it persists across app restarts
 */
export const getDeviceId = async (): Promise<string> => {
  let deviceId = await SecureStore.getItemAsync("deviceId");

  if (!deviceId) {
    // Generate a new UUID-like device ID
    deviceId = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${Date.now()}-${Math.random()}-${Math.random()}`
    );
    deviceId = deviceId.slice(0, 32); // Shorten to 32 chars
    await SecureStore.setItemAsync("deviceId", deviceId);
  }

  return deviceId;
};

// --- Authentication ---

/**
 * Verify login with name + passcode
 * Looks up driver by passcode hash, then verifies name matches
 *
 * Structure: drivers/approved/{passcodeHash}/ = { displayName, active, isAdmin? }
 * Also supports legacy structure: drivers/approved/{passcodeHash}/{deviceId}/
 */
export type LoginErrorKind =
  | 'invalid_credentials'
  | 'deactivated'
  | 'must_change'
  | 'no_network'
  | 'timeout'
  | 'unreachable'
  | 'auth_session'
  | 'permission'
  | 'server'
  | 'unknown';

export type VerifyLoginResult =
  | {
      valid: true;
      customToken: string;
      driverId: string;
      displayName: string;
      isAdmin: boolean;
      isViewer: boolean;
      companyId?: string;
      companyName?: string;
      tier?: CompanyTier;
      roles: string[];
      assignedRoutes: unknown;
      assignedCustomers?: unknown;
    }
  | {
      valid: false;
      error: string;
      errorKind: LoginErrorKind;
      errorCode: string;
    };

export function classifyLoginFailure(err: unknown): { kind: LoginErrorKind; code: string; message: string } {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (/reset required|must.?change/i.test(msg)) {
    return { kind: 'must_change', code: 'must_change', message: msg };
  }
  if (/deactivated/i.test(msg)) {
    return { kind: 'deactivated', code: 'deactivated', message: 'deactivated' };
  }
  if (/too many login/i.test(msg)) {
    return { kind: 'permission', code: 'rate_limited', message: 'rate_limited' };
  }
  if (/invalid|not found|incorrect|name or passcode|unauthenticated/i.test(msg)) {
    return { kind: 'invalid_credentials', code: 'invalid_credentials', message: 'invalid_credentials' };
  }
  const d = diagnoseThrown(err);
  const mapped: LoginErrorKind[] = ['no_network', 'timeout', 'unreachable', 'auth_session', 'permission', 'server'];
  const kind: LoginErrorKind = mapped.includes(d.kind as LoginErrorKind) ? (d.kind as LoginErrorKind) : 'unknown';
  return { kind, code: d.code, message: `${d.kind} [${d.code}]` };
}

export const verifyLogin = async (
  displayName: string,
  passcode: string
): Promise<VerifyLoginResult> => {
  console.log("[DriverAuth] Verifying login for:", displayName);

  try {
    const { secureLogin } = await import('./secureDriverAuth');
    const s = await secureLogin(displayName, passcode);
    if (!s.customToken) {
      throw new Error('authenticateDriver did not return a Firebase custom token');
    }
    return {
      valid: true,
      customToken: s.customToken,
      driverId: s.driverId,
      displayName: s.displayName,
      isAdmin: s.isAdmin === true,
      isViewer: s.isViewer === true,
      companyId: s.companyId || undefined,
      companyName: s.companyName || undefined,
      roles: Array.isArray(s.roles) ? s.roles : ['driver'],
      assignedRoutes: s.assignedRoutes,
    };
  } catch (error) {
    console.error("[DriverAuth] Login failed:", error);
    const c = classifyLoginFailure(error);
    return { valid: false, error: c.message, errorKind: c.kind, errorCode: c.code };
  }
};

// Legacy aliases for compatibility
export const verifyPasscode = verifyLogin;
export const verifyDriverPin = verifyLogin;
export const verifyPasscodeWithName = async (passcode: string, displayName: string) => {
  return verifyLogin(displayName, passcode);
};

/**
 * Update device tracking info on successful login
 * Only tracks company-owned devices (listed in devices/company/)
 *
 * Updates two places:
 * 1. Driver record: lastDeviceId, lastLoginAt (quick lookup)
 * 2. Device login history: full trail of who used this device when
 */
const updateDeviceTracking = async (passcodeHash: string, driverName: string): Promise<void> => {
  if (!DEVICE_MANAGEMENT_AVAILABLE) {
    return;
  }
  try {
    const deviceId = await getDeviceId();

    // Check if this is a company-owned device
    const companyDevice = await firebaseGet(`devices/company/${deviceId}`);
    if (!companyDevice) {
      console.log("[DriverAuth] Personal device - skipping tracking");
      return;
    }

    const now = new Date().toISOString();

    // Update driver's last known device (quick lookup)
    const driverTrackingData = {
      lastDeviceId: deviceId,
      lastLoginAt: now,
    };
    await firebasePatch(`${DRIVERS_APPROVED}/${passcodeHash}`, driverTrackingData);

    // Add to device's login history (full trail)
    const loginEntry = {
      driver: driverName,
      at: now,
    };
    await firebasePost(`devices/company/${deviceId}/loginHistory`, loginEntry);

    // Update device's last user info (quick lookup)
    const deviceTrackingData = {
      lastDriver: driverName,
      lastLoginAt: now,
    };
    await firebasePatch(`devices/company/${deviceId}`, deviceTrackingData);

    console.log("[DriverAuth] Company device tracking updated:", deviceId.slice(0, 8) + "...");
  } catch (error) {
    // Don't fail login if tracking update fails
    console.error("[DriverAuth] Failed to update device tracking:", error);
  }
};

/**
 * Check if current device is registered as company-owned
 */
export const isCompanyDevice = async (): Promise<boolean> => {
  if (!DEVICE_MANAGEMENT_AVAILABLE) {
    return false;
  }
  try {
    const deviceId = await getDeviceId();
    const companyDevice = await firebaseGet(`devices/company/${deviceId}`);
    return !!companyDevice;
  } catch {
    return false;
  }
};

/**
 * Register current device as company-owned (admin only)
 * Stores device info from expo-device for identification even after reinstall
 */
export const registerCompanyDevice = async (nickname?: string): Promise<{ success: boolean; error?: string }> => {
  if (!DEVICE_MANAGEMENT_AVAILABLE) {
    return { success: false, error: "update_required" };
  }
  try {
    const deviceId = await getDeviceId();

    // Get hardware info from expo-device (survives app reinstalls)
    const deviceInfo = {
      modelName: Device.modelName || "Unknown Model",     // e.g., "Galaxy S24"
      deviceName: Device.deviceName || "Unknown Device",  // e.g., "John's Phone"
      brand: Device.brand || "Unknown",                   // e.g., "Samsung"
      osName: Device.osName || "Unknown",                 // e.g., "Android"
      osVersion: Device.osVersion || "Unknown",           // e.g., "14"
    };

    const deviceData = {
      registeredAt: new Date().toISOString(),
      nickname: nickname || deviceInfo.deviceName || "Unnamed Device",
      // Hardware info for identifying device after reinstall
      modelName: deviceInfo.modelName,
      deviceName: deviceInfo.deviceName,
      brand: deviceInfo.brand,
      osName: deviceInfo.osName,
      osVersion: deviceInfo.osVersion,
    };

    const url = await buildFirebaseUrl(`devices/company/${deviceId}`);
    const response = await fetchWithTimeout(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deviceData),
    });

    if (!response.ok) {
      throw new Error(`Failed to register device (${response.status})`);
    }

    console.log("[DriverAuth] Device registered as company-owned:", deviceId.slice(0, 8) + "...", deviceInfo.modelName);
    return { success: true };
  } catch (error) {
    console.error("[DriverAuth] Failed to register company device:", error);
    return { success: false, error: "Could not register device" };
  }
};

/**
 * Get all company devices (admin only)
 */
export const getCompanyDevices = async (): Promise<Record<string, {
  nickname: string;
  registeredAt: string;
  modelName?: string;
  deviceName?: string;
  brand?: string;
  osName?: string;
  osVersion?: string;
  lastDriver?: string;
  lastLoginAt?: string;
}> | null> => {
  if (!DEVICE_MANAGEMENT_AVAILABLE) {
    return null;
  }
  try {
    return await firebaseGet("devices/company");
  } catch {
    return null;
  }
};

/**
 * Remove a company device (admin only)
 */
export const removeCompanyDevice = async (deviceId: string): Promise<{ success: boolean }> => {
  if (!DEVICE_MANAGEMENT_AVAILABLE) {
    return { success: false };
  }
  try {
    const url = await buildFirebaseUrl(`devices/company/${deviceId}`);
    const response = await fetchWithTimeout(url, {
      method: "DELETE",
    });
    return { success: response.ok };
  } catch {
    return { success: false };
  }
};

/**
 * Save driver session after successful passcode verification
 */
let saveSessionWritePause: ((key: string) => Promise<void>) | null = null;
export function setSaveSessionWritePauseForTests(fn: ((key: string) => Promise<void>) | null): void {
  saveSessionWritePause = fn;
}

async function writeSessionItem(key: string, value: string): Promise<void> {
  if (saveSessionWritePause) await saveSessionWritePause(key);
  await SecureStore.setItemAsync(key, value);
}

// ─────────────────── resilient driver-IDENTITY mirror (AsyncStorage) ───────────────────
// RELEASE FIX: the signed-in driver identity was persisted ONLY to expo-secure-store,
// whose Android-Keystore-backed entries can be invalidated across a process restart /
// `install -r` upgrade — silently logging the driver out. AsyncStorage is a plain durable
// file that reliably survives process death and in-place upgrades, so we MIRROR the
// non-secret identity (driverId/name/company/roles/authMethod — NEVER the passcode) there.
// On startup, when SecureStore comes back empty, we re-hydrate SecureStore from this mirror
// so the session restores. Only an explicit Logout (or a genuine revocation) clears it.
const DRIVER_IDENTITY_MIRROR_KEY = "@wellbuilt_driver_identity_v1";
// Ensures getDriverSession stamps the mirror at most once per session for a
// carried-over (pre-mirror) session. Reset on logout so a new session re-stamps.
let _mirrorEnsuredThisSession = false;

/** Storage-shaped identity: values mirror exactly what SecureStore holds (raw JSON
 *  strings for the list fields) so re-hydration writes them back verbatim. */
interface DriverIdentityMirror {
  driverId: string;
  driverName: string;
  isAdmin: string;      // "true" | "false"
  isViewer: string;
  driverVerifiedAt?: string;
  companyId?: string;
  companyName?: string;
  tier?: string;
  rolesRaw?: string;
  assignedRoutesRaw?: string;
  assignedCustomersRaw?: string;
  authMethod?: string;  // "sso" | "manual"
}

async function writeIdentityMirror(m: DriverIdentityMirror): Promise<void> {
  try { await AsyncStorage.setItem(DRIVER_IDENTITY_MIRROR_KEY, JSON.stringify(m)); }
  catch { /* mirror is best-effort; SecureStore remains the primary store */ }
}

async function readIdentityMirror(): Promise<DriverIdentityMirror | null> {
  try {
    const raw = await AsyncStorage.getItem(DRIVER_IDENTITY_MIRROR_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<DriverIdentityMirror>;
    // A usable identity requires at least a driverId + driverName; malformed → null.
    if (m && typeof m.driverId === "string" && m.driverId
      && typeof m.driverName === "string" && m.driverName) {
      return m as DriverIdentityMirror;
    }
    return null;
  } catch { return null; }
}

async function clearIdentityMirror(): Promise<void> {
  _mirrorEnsuredThisSession = false;
  try { await AsyncStorage.removeItem(DRIVER_IDENTITY_MIRROR_KEY); }
  catch { /* non-fatal */ }
}

/** Test-only: reset the per-session "mirror stamped" flag (module state). */
export function __resetSessionMirrorFlagForTests(): void {
  _mirrorEnsuredThisSession = false;
}

/** Re-populate the SecureStore session keys from a durable AsyncStorage mirror when
 *  SecureStore returned empty (keystore invalidation / cold start). Self-healing:
 *  after this runs, subsequent SecureStore reads (getDriverId etc.) succeed too. */
async function rehydrateSecureStoreFromMirror(m: DriverIdentityMirror): Promise<void> {
  try {
    await SecureStore.setItemAsync("driverId", m.driverId);
    await SecureStore.setItemAsync("driverName", m.driverName);
    await SecureStore.setItemAsync("isAdmin", m.isAdmin || "false");
    await SecureStore.setItemAsync("isViewer", m.isViewer || "false");
    if (m.driverVerifiedAt) await SecureStore.setItemAsync("driverVerifiedAt", m.driverVerifiedAt);
    if (m.companyId) await SecureStore.setItemAsync("companyId", m.companyId);
    if (m.companyName) await SecureStore.setItemAsync("companyName", m.companyName);
    if (m.tier) await SecureStore.setItemAsync("tier", m.tier);
    if (m.rolesRaw) await SecureStore.setItemAsync("roles", m.rolesRaw);
    if (m.assignedRoutesRaw) await SecureStore.setItemAsync("assignedRoutes", m.assignedRoutesRaw);
    if (m.assignedCustomersRaw) await SecureStore.setItemAsync("assignedCustomers", m.assignedCustomersRaw);
    if (m.authMethod) await SecureStore.setItemAsync("authMethod", m.authMethod);
  } catch { /* if SecureStore is unwritable, the mirror still answers reads */ }
}

/** Build a DriverSession from a mirror blob (same shape getDriverSession returns). */
function sessionFromMirror(m: DriverIdentityMirror): DriverSession {
  let roles: string[] | undefined;
  let assignedRoutes: string[] | undefined;
  let assignedCustomers: unknown;
  try { roles = m.rolesRaw ? JSON.parse(m.rolesRaw) : undefined; } catch { roles = undefined; }
  try {
    const parsed = m.assignedRoutesRaw ? JSON.parse(m.assignedRoutesRaw) : undefined;
    const n = normalizeRouteList(parsed);
    assignedRoutes = n.present ? n.routes : undefined;
  } catch { assignedRoutes = undefined; }
  try { assignedCustomers = m.assignedCustomersRaw ? JSON.parse(m.assignedCustomersRaw) : undefined; } catch { assignedCustomers = undefined; }
  return {
    driverId: m.driverId,
    displayName: m.driverName,
    isAdmin: m.isAdmin === "true",
    isViewer: m.isViewer === "true",
    companyId: m.companyId || undefined,
    companyName: m.companyName || undefined,
    tier: (m.tier as CompanyTier) || undefined,
    roles,
    assignedRoutes,
    assignedCustomers,
    authMethod: m.authMethod === "sso" || m.authMethod === "manual" ? m.authMethod : undefined,
  };
}

export const saveDriverSession = async (
  driverId: string,
  displayName: string,
  _unusedPasscodeHash: string | undefined,
  isAdmin: boolean = false,
  isViewer: boolean = false,
  companyId?: string,
  companyName?: string,
  tier?: CompanyTier,
  authMethod?: 'sso' | 'manual',
  extra?: {
    roles?: string[];
    assignedRoutes?: unknown;
    assignedCustomers?: unknown;
  },
): Promise<void> => {
  await writeSessionItem("driverId", driverId);
  await writeSessionItem("driverName", displayName);
  await SecureStore.deleteItemAsync("passcodeHash");
  await writeSessionItem("isAdmin", isAdmin ? "true" : "false");
  await writeSessionItem("isViewer", isViewer ? "true" : "false");
  await writeSessionItem("driverVerifiedAt", Date.now().toString());
  if (companyId) await writeSessionItem("companyId", companyId);
  else await SecureStore.deleteItemAsync("companyId");
  if (companyName) await writeSessionItem("companyName", companyName);
  else await SecureStore.deleteItemAsync("companyName");
  if (tier) await writeSessionItem("tier", tier);
  else await SecureStore.deleteItemAsync("tier");
  if (extra?.roles) await writeSessionItem("roles", JSON.stringify(extra.roles));
  else await SecureStore.deleteItemAsync("roles");
  if (extra?.assignedRoutes) await writeSessionItem("assignedRoutes", JSON.stringify(extra.assignedRoutes));
  else await SecureStore.deleteItemAsync("assignedRoutes");
  if (extra?.assignedCustomers) await writeSessionItem("assignedCustomers", JSON.stringify(extra.assignedCustomers));
  else await SecureStore.deleteItemAsync("assignedCustomers");
  // Track how driver logged in — SSO sessions are owned by WB S (cascade logout applies),
  // manual sessions are owned by the driver (WB S logout is ignored).
  if (authMethod) await writeSessionItem("authMethod", authMethod);

  // Durable identity MIRROR (AsyncStorage) so the session survives a process
  // restart / install -r even if SecureStore's keystore entries are invalidated.
  // Non-secret identity only — the passcode is never mirrored.
  await writeIdentityMirror({
    driverId,
    driverName: displayName,
    isAdmin: isAdmin ? "true" : "false",
    isViewer: isViewer ? "true" : "false",
    driverVerifiedAt: Date.now().toString(),
    companyId: companyId || undefined,
    companyName: companyName || undefined,
    tier: tier || undefined,
    rolesRaw: extra?.roles ? JSON.stringify(extra.roles) : undefined,
    assignedRoutesRaw: extra?.assignedRoutes ? JSON.stringify(extra.assignedRoutes) : undefined,
    assignedCustomersRaw: extra?.assignedCustomers ? JSON.stringify(extra.assignedCustomers) : undefined,
    authMethod: authMethod || undefined,
  });

  // Clear any pending registration data
  await clearPendingRegistration();
};

/**
 * Get current driver session
 */
export const getDriverSession = async (): Promise<DriverSession | null> => {
  const driverId = await SecureStore.getItemAsync("driverId");
  const displayName = await SecureStore.getItemAsync("driverName");
  const isAdminStr = await SecureStore.getItemAsync("isAdmin");
  const isViewerStr = await SecureStore.getItemAsync("isViewer");
  const companyId = await SecureStore.getItemAsync("companyId");
  const companyName = await SecureStore.getItemAsync("companyName");
  const tier = await SecureStore.getItemAsync("tier");

  const rolesRaw = await SecureStore.getItemAsync("roles");
  const routesRaw = await SecureStore.getItemAsync("assignedRoutes");
  const customersRaw = await SecureStore.getItemAsync("assignedCustomers");
  const authMethod = await SecureStore.getItemAsync("authMethod");
  let roles: string[] | undefined;
  let assignedRoutes: string[] | undefined;
  let assignedCustomers: unknown;
  try { roles = rolesRaw ? JSON.parse(rolesRaw) : undefined; } catch { roles = undefined; }
  try {
    const parsed = routesRaw ? JSON.parse(routesRaw) : undefined;
    const n = normalizeRouteList(parsed);
    assignedRoutes = n.present ? n.routes : undefined;
  } catch { assignedRoutes = undefined; }
  try { assignedCustomers = customersRaw ? JSON.parse(customersRaw) : undefined; } catch { assignedCustomers = undefined; }

  if (driverId && displayName) {
    // Opportunistically ensure the durable mirror exists for THIS session (once).
    // Covers a session carried over from a build that predates the mirror (e.g. an
    // in-place upgrade whose SecureStore survived): the first read stamps the mirror
    // so a later restart that DOES lose SecureStore can still self-heal.
    if (!_mirrorEnsuredThisSession) {
      _mirrorEnsuredThisSession = true;
      void writeIdentityMirror({
        driverId, driverName: displayName,
        isAdmin: isAdminStr === "true" ? "true" : "false",
        isViewer: isViewerStr === "true" ? "true" : "false",
        driverVerifiedAt: (await SecureStore.getItemAsync("driverVerifiedAt")) || undefined,
        companyId: companyId || undefined,
        companyName: companyName || undefined,
        tier: tier || undefined,
        rolesRaw: rolesRaw || undefined,
        assignedRoutesRaw: routesRaw || undefined,
        assignedCustomersRaw: customersRaw || undefined,
        authMethod: authMethod || undefined,
      });
    }
    return {
      driverId,
      displayName,
      isAdmin: isAdminStr === "true",
      isViewer: isViewerStr === "true",
      companyId: companyId || undefined,
      companyName: companyName || undefined,
      tier: (tier as CompanyTier) || undefined,
      roles,
      assignedRoutes,
      assignedCustomers,
      authMethod: authMethod === 'sso' || authMethod === 'manual' ? authMethod : undefined,
    };
  }
  // SecureStore came back empty (keystore invalidation / cold start after install -r).
  // Fall back to the durable AsyncStorage identity mirror and RE-HYDRATE SecureStore so
  // the session self-heals. Only a genuine logout clears the mirror, so a present mirror
  // means the driver is still signed in — do NOT show Driver Login for this.
  const mirror = await readIdentityMirror();
  if (mirror) {
    await rehydrateSecureStoreFromMirror(mirror);
    return sessionFromMirror(mirror);
  }
  return null;
};

/**
 * Check if current user is admin
 */
export const isCurrentUserAdmin = async (): Promise<boolean> => {
  const isAdminStr = await SecureStore.getItemAsync("isAdmin");
  return isAdminStr === "true";
};

/**
 * Check if current user is viewer-only (can't submit pulls)
 */
export const isCurrentUserViewer = async (): Promise<boolean> => {
  const isViewerStr = await SecureStore.getItemAsync("isViewer");
  return isViewerStr === "true";
};

/**
 * Check if driver is verified (has a valid session)
 */
export const isDriverVerified = async (): Promise<boolean> => {
  const session = await getDriverSession();
  return session !== null;
};

/**
 * Revalidate driver session - verify driver is still approved
 * Checks drivers/approved/{passcodeHash}/
 */
export type Revalidation = 'valid' | 'revoked' | 'unknown';

export const revalidateDriverSession = async (): Promise<boolean> => {
  const r = await revalidateDriverSessionClassified();
  return r === 'valid';
};

export async function revalidateDriverSessionClassified(): Promise<Revalidation> {
  const session = await getDriverSession();
  // A missing session at revalidation time is a HYDRATION state, not a revocation —
  // never destroy identity on it (the startup guard already routes a truly-absent
  // session to Driver Login via isDriverVerified()).
  if (!session) return 'unknown';
  try {
    const { verifySessionOnServer } = await import('./firebaseAuthSession');
    const live = await verifySessionOnServer();
    if (live.active === true && live.driverId === session.driverId) return 'valid';
    // Only a GENUINE identity change — the server maps this authenticated account to a
    // DIFFERENT driver — is a revocation. Any other ambiguity (active not strictly true,
    // missing/short-shaped fields, response drift) must NOT clear a durably-persisted
    // valid session; hold as 'unknown' so the app waits/retries rather than silently
    // logging the driver out.
    if (typeof live.driverId === 'string' && live.driverId && live.driverId !== session.driverId) {
      return 'revoked';
    }
    return 'unknown';
  } catch (error) {
    console.error("[DriverAuth] Server revalidation failed:", error);
    return 'unknown';
  }
}

/**
 * Persist a complete session after Firebase Auth exists. Manual and SSO
 * both land here so cold start reads the same contract.
 * If local save fails after Firebase sign-in, the auth session is cleared.
 */
export function identityChanged(
  prev: { driverId: string | null; companyId: string | null },
  next: { driverId: string; companyId: string },
): boolean {
  if (prev.driverId && prev.driverId !== next.driverId) return true;
  if (prev.driverId && (prev.companyId || '') !== (next.companyId || '')) return true;
  return false;
}

/**
 * Rollback after Firebase sign-in without taking the session gate or
 * requiring captureCurrentSessionPermit (wb_auth_uid may already be gone).
 * Caller must already own the session-transition.
 */
async function rollbackOwnedLogin(): Promise<void> {
  try {
    const { clearAuthSession } = await import('./firebaseAuthSession');
    await clearAuthSession();
  } catch { /* ignore */ }
  try {
    await SecureStore.deleteItemAsync('wb_auth_uid');
  } catch { /* ignore */ }
  clearWbmMemoryCatalog();
  try {
    await wipeDurableWellConfigCache();
  } catch { /* ignore */ }
  for (const key of SESSION_SECURE_KEYS) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch { /* ignore */ }
  }
  try { await clearIdentityMirror(); } catch { /* ignore */ }
  try {
    await clearPendingRegistration();
  } catch { /* ignore */ }
}

/**
 * One owned, serialized authenticated-session establishment.
 * Manual and SSO both call this after they hold a custom token.
 * Does not nest runSessionTransition: persistCustomTokenSession is ungated.
 */
export async function completeAuthenticatedSession(input: {
  customToken: string;
  driverId: string;
  displayName: string;
  isAdmin?: boolean;
  isViewer?: boolean;
  companyId?: string | null;
  companyName?: string | null;
  tier?: string | null;
  roles?: unknown;
  assignedRoutes?: unknown;
  assignedCustomers?: unknown;
  authMethod: 'sso' | 'manual';
}): Promise<DriverSession> {
  if (!input.customToken) throw new Error('missing_custom_token');
  return runSessionTransition(async () => {
    const claimed = claimSessionGeneration();
    try {
      const { persistCustomTokenSession, getFirebaseAuth } = await import('./firebaseAuthSession');
      const tokens = await persistCustomTokenSession(input.customToken);
      let uid: string | null = null;
      try {
        uid = getFirebaseAuth().currentUser?.uid || null;
      } catch {
        uid = null;
      }
      if (!uid || !tokens.idToken) throw new Error('auth_uid_token_invalid');
      if (afterSignInPause) await afterSignInPause();

      // Identity comes from authenticateDriver / SSO exchange. Canonical
      // assignedRoutes, assignedWells, eligibility, and wells come from
      // bootstrapWbmSession via fetchAssignmentClassified below.
      const merged = { ...input };

      const roles = Array.isArray(merged.roles) ? merged.roles.filter((r): r is string => typeof r === 'string') : ['driver'];
      const routesNorm = normalizeRouteList(merged.assignedRoutes);
      const prevId = await SecureStore.getItemAsync('driverId');
      const prevCo = await SecureStore.getItemAsync('companyId');
      const nextId = merged.driverId;
      const nextCo = merged.companyId || '';
      if (identityChanged({ driverId: prevId, companyId: prevCo }, { driverId: nextId, companyId: nextCo })) {
        clearWbmMemoryCatalog();
        await wipeDurableWellConfigCache();
      }

      await saveDriverSession(
        merged.driverId,
        merged.displayName,
        undefined,
        merged.isAdmin === true,
        merged.isViewer === true,
        merged.companyId || undefined,
        merged.companyName || undefined,
        (merged.tier as CompanyTier | undefined) || undefined,
        merged.authMethod,
        {
          roles,
          assignedRoutes: routesNorm.present ? routesNorm.routes : merged.assignedRoutes,
          assignedCustomers: merged.assignedCustomers,
        },
      );

      const session = await getDriverSession();
      if (!session) throw new Error('session_persist_failed');

      try {
        const { fetchAssignmentClassified } = await import('./wellConfig');
        await fetchAssignmentClassified();
      } catch { /* eligibility persistence is not a login blocker */ }

      if (getSessionGeneration() !== claimed) throw new Error('session_generation_lost');
      let liveUid: string | null = null;
      try {
        liveUid = getFirebaseAuth().currentUser?.uid || null;
      } catch {
        liveUid = null;
      }
      if (liveUid !== uid) throw new Error('auth_uid_lost');
      const storedId = await SecureStore.getItemAsync('driverId');
      const storedMethod = await SecureStore.getItemAsync('authMethod');
      if (storedId !== session.driverId || storedMethod !== merged.authMethod) {
        throw new Error('session_identity_lost');
      }

      try {
        const { notifyAuthenticated } = await import('./deliveryStatus');
        notifyAuthenticated();
      } catch { /* reconcile is not a login blocker */ }

      return session;
    } catch (err) {
      await rollbackOwnedLogin();
      throw err;
    }
  });
}

const SESSION_SECURE_KEYS = [
  "driverId",
  "driverName",
  "passcodeHash",
  "driverVerifiedAt",
  "authMethod",
  "isAdmin",
  "isViewer",
  "companyId",
  "companyName",
  "tier",
  "roles",
  "assignedRoutes",
  "assignedCustomers",
  "driverPin",
  "driverEmail",
] as const;

async function readLiveAuthUid(): Promise<string | null> {
  try {
    const { getFirebaseAuth } = await import('./firebaseAuthSession');
    const live = getFirebaseAuth().currentUser?.uid;
    if (live) return live;
  } catch { /* fall through */ }
  try {
    return (await SecureStore.getItemAsync('wb_auth_uid')) || null;
  } catch {
    return null;
  }
}

let liveReadCount = 0;
let logoutDuringNthLiveRead: { n: number; pause: () => Promise<void> } | null = null;

export function setLogoutDuringNthLiveReadPauseForTests(
  n: number,
  fn: (() => Promise<void>) | null,
): void {
  liveReadCount = 0;
  logoutDuringNthLiveRead = fn ? { n, pause: fn } : null;
}

async function readLiveSessionFields(): Promise<{
  driverId: string | null;
  companyId: string | null;
  authMethod: string | null;
  driverVerifiedAt: string | null;
  authUid: string | null;
}> {
  liveReadCount += 1;
  if (logoutDuringNthLiveRead && liveReadCount === logoutDuringNthLiveRead.n) {
    await logoutDuringNthLiveRead.pause();
  }
  return {
    driverId: await SecureStore.getItemAsync('driverId'),
    companyId: await SecureStore.getItemAsync('companyId'),
    authMethod: await SecureStore.getItemAsync('authMethod'),
    driverVerifiedAt: await SecureStore.getItemAsync('driverVerifiedAt'),
    authUid: await readLiveAuthUid(),
  };
}

export async function captureCurrentSessionPermit(): Promise<SessionLogoutPermit | null> {
  const live = await readLiveSessionFields();
  if (!live.driverId || !live.authMethod || !live.driverVerifiedAt || !live.authUid) return null;
  return {
    generation: getSessionGeneration(),
    driverId: live.driverId,
    companyId: live.companyId || '',
    authMethod: live.authMethod,
    driverVerifiedAt: live.driverVerifiedAt,
    authUid: live.authUid,
  };
}

function identityMatchesPermit(
  permit: SessionLogoutPermit,
  live: { driverId: string | null; companyId: string | null; authMethod: string | null; driverVerifiedAt: string | null; authUid: string | null },
): boolean {
  return permit.driverId === live.driverId
    && permit.companyId === (live.companyId || '')
    && permit.authMethod === live.authMethod
    && permit.driverVerifiedAt === live.driverVerifiedAt
    && permit.authUid === live.authUid;
}

async function sessionStolenByOther(permit: SessionLogoutPermit): Promise<boolean> {
  const live = await readLiveSessionFields();
  if (live.driverId && live.driverId !== permit.driverId) return true;
  if (live.authUid && live.authUid !== permit.authUid) return true;
  if (live.driverVerifiedAt && live.driverVerifiedAt !== permit.driverVerifiedAt) return true;
  return false;
}

async function deleteOwnedSecureStore(permit: SessionLogoutPermit): Promise<boolean> {
  const driverId = await SecureStore.getItemAsync('driverId');
  if (driverId && driverId !== permit.driverId) return false;
  const uid = await SecureStore.getItemAsync('wb_auth_uid');
  if (uid && uid !== permit.authUid) return false;
  for (const key of SESSION_SECURE_KEYS) {
    await SecureStore.deleteItemAsync(key);
  }
  // Explicit logout is the ONLY ordinary action that clears the durable identity mirror.
  await clearIdentityMirror();
  await clearPendingRegistration();
  return true;
}

let logoutAfterRereadPause: (() => Promise<void>) | null = null;
export function setLogoutAfterRereadPauseForTests(fn: (() => Promise<void>) | null): void {
  logoutAfterRereadPause = fn;
}

let afterSignInPause: (() => Promise<void>) | null = null;
export function setAfterSignInPauseForTests(fn: (() => Promise<void>) | null): void {
  afterSignInPause = fn;
}

/**
 * Destructive logout of exactly the session named by the permit.
 * Stale or mismatched permits perform no sign-out, SecureStore deletion,
 * or cache deletion. Serialized with login via the session-transition gate.
 */
export async function performPermittedLogout(permit: SessionLogoutPermit): Promise<boolean> {
  return runSessionTransition(async () => {
    liveReadCount = 0;
    if (!permitGenerationCurrent(permit)) return false;
    const liveBefore = await readLiveSessionFields();
    if (!permitGenerationCurrent(permit)) return false;
    if (!identityMatchesPermit(permit, liveBefore)) return false;

    if (logoutAfterRereadPause) await logoutAfterRereadPause();

    if (!permitGenerationCurrent(permit)) return false;
    const liveImmediate = await readLiveSessionFields();
    if (!identityMatchesPermit(permit, liveImmediate)) return false;
    if (!permitGenerationCurrent(permit)) return false;

    const claimed = claimSessionGeneration();

    const liveAfterClaim = await readLiveSessionFields();
    if (!identityMatchesPermit(permit, liveAfterClaim)) return false;

    const { clearAuthSession, getFirebaseAuth } = await import('./firebaseAuthSession');
    let uid: string | null = null;
    try {
      uid = getFirebaseAuth().currentUser?.uid || null;
    } catch {
      uid = null;
    }
    if (uid !== permit.authUid) return false;

    await clearAuthSession();

    if (getSessionGeneration() !== claimed) return false;
    if (await sessionStolenByOther(permit)) return false;

    await wipeDurableWellConfigCache();

    if (getSessionGeneration() !== claimed) return false;
    if (await sessionStolenByOther(permit)) return false;

    return deleteOwnedSecureStore(permit);
  });
}

/**
 * Manual logout of the exact current session. No-ops if identity cannot
 * be bound (avoids clearing a newer driver).
 */
export const clearDriverSession = async (): Promise<void> => {
  const permit = await captureCurrentSessionPermit();
  if (!permit) return;
  await performPermittedLogout(permit);
};

// --- Registration ---

/**
 * Check if a passcode is available (not already in use)
 */
export const isPasscodeAvailable = async (
  _passcode: string,
  _name?: string
): Promise<{ available: boolean; reason?: string }> => {
  // Availability is decided by requestDriverRegistration. The client no
  // longer reads drivers/approved or drivers/pending.
  return { available: true };
};

// Legacy alias
export const isPinAvailable = isPasscodeAvailable;

/**
 * Submit a registration request
 * Creates entry in Firebase drivers/pending/
 */
export const submitRegistration = async (params: {
  passcode: string;
  displayName: string;
  companyName?: string;
  legalName?: string;
}): Promise<{ success: boolean; error?: string }> => {
  console.log("[DriverAuth] Submitting registration for:", params.displayName);

  try {
    const { secureRegister } = await import('./secureDriverAuth');
    const result = await secureRegister(params);
    if (!result.pendingId) {
      return { success: false, error: 'Registration did not return a pending id' };
    }
    await SecureStore.setItemAsync("pendingSecureId", result.pendingId);
    await SecureStore.setItemAsync("pendingDisplayName", params.displayName);
    await SecureStore.setItemAsync("pendingRegistrationTime", Date.now().toString());
    await SecureStore.deleteItemAsync("pendingPasscodeHash");
    await SecureStore.deleteItemAsync("pendingPasscode");
    console.log("[DriverAuth] Secure registration submitted");
    return { success: true };
  } catch (error: any) {
    console.error("[DriverAuth] Error submitting registration:", error);
    return { success: false, error: error?.message || "Connection error" };
  }
};

/**
 * Get pending registration info
 */
export const getPendingRegistration = async (): Promise<{
  pendingSecureId: string;
  displayName: string;
} | null> => {
  const pendingSecureId = await SecureStore.getItemAsync("pendingSecureId");
  const displayName = await SecureStore.getItemAsync("pendingDisplayName");

  if (pendingSecureId && displayName) {
    return { pendingSecureId, displayName };
  }
  return null;
};

/**
 * Check registration status via checkDriverRegistrationStatus.
 */
export const checkRegistrationStatus = async (): Promise<
  "pending" | "approved" | "rejected" | "none"
> => {
  const pending = await getPendingRegistration();
  if (!pending) {
    return "none";
  }

  try {
    const { checkDriverRegistrationStatus } = await import('./secureDriverAuth');
    const result = await checkDriverRegistrationStatus(pending.pendingSecureId);
    if (result.status === 'approved' || result.status === 'rejected' || result.status === 'pending') {
      return result.status;
    }
    return 'none';
  } catch (error) {
    console.error("[DriverAuth] Error checking registration status:", error);
    return "pending";
  }
};

/**
 * Complete registration after approval by authenticating normally.
 */
export const completeRegistration = async (): Promise<{
  success: boolean;
  driverId?: string;
  displayName?: string;
  error?: string;
}> => {
  const pending = await getPendingRegistration();
  if (!pending) {
    return { success: false, error: "No pending registration" };
  }

  try {
    const status = await checkRegistrationStatus();
    if (status !== 'approved') {
      return { success: false, error: 'Registration is not approved' };
    }
    await clearPendingRegistration();
    return { success: false, error: 'approved_login_required', displayName: pending.displayName };
  } catch (error) {
    console.error("[DriverAuth] Error completing registration:", error);
    return { success: false, error: "Connection error" };
  }
};

/**
 * Clear pending registration
 */
export const clearPendingRegistration = async (): Promise<void> => {
  await SecureStore.deleteItemAsync("pendingSecureId");
  await SecureStore.deleteItemAsync("pendingPasscode");
  await SecureStore.deleteItemAsync("pendingPasscodeHash");
  await SecureStore.deleteItemAsync("pendingDisplayName");
  await SecureStore.deleteItemAsync("pendingRegistrationTime");
  // Legacy cleanup
  await SecureStore.deleteItemAsync("pendingRegistrationPin");
  await SecureStore.deleteItemAsync("pendingRegistrationName");
};

// --- Legacy compatibility ---

/**
 * Legacy function for compatibility
 */
export const checkWellBuiltAccess = async (): Promise<{
  hasAccess: boolean;
  error?: string;
}> => {
  try {
    const { getValidIdToken } = await import('./firebaseAuthSession');
    await getValidIdToken();
    return { hasAccess: true };
  } catch (error) {
    const { diagnoseThrown, formatDiagnosis } = await import('./connectionDiagnosis');
    return { hasAccess: false, error: formatDiagnosis(diagnoseThrown(error)) };
  }
};

/**
 * Get driver ID for the current session
 * Used for "your pull" tracking
 */
export const getDriverId = async (): Promise<string | null> => {
  try {
    const id = await SecureStore.getItemAsync("driverId");
    if (id) return id;
  } catch { /* fall through to the durable mirror */ }
  // SecureStore empty/unreadable → durable identity mirror keeps the driverId so
  // startup work (history backfill, scheduler) is never wrongly told "No driverId".
  const mirror = await readIdentityMirror();
  return mirror ? mirror.driverId : null;
};

/**
 * Get driver display name for the current session
 */
export const getDriverName = async (): Promise<string | null> => {
  try {
    const name = await SecureStore.getItemAsync("driverName");
    if (name) return name;
  } catch { /* fall through to the durable mirror */ }
  const mirror = await readIdentityMirror();
  return mirror ? mirror.driverName : null;
};

// Legacy stubs for compatibility (no-ops)
export const shouldSkipDevicePrompt = async (): Promise<boolean> => false;
export const setSkipDevicePrompt = async (_skip: boolean): Promise<void> => {};
export const registerDeviceAsMain = async (
  _passcodeHash: string,
  _displayName: string
): Promise<{ success: boolean; error?: string }> => {
  return { success: true }; // No-op, device registration not needed
};
