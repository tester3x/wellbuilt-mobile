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

// Firebase configuration (same as firebase.ts)
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

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
  passcodeHash: string;
  isAdmin: boolean;
  isViewer: boolean;
  companyId?: string;
  companyName?: string;
  tier?: CompanyTier;
}

// --- Firebase helpers ---

const buildFirebaseUrl = (path: string): string => {
  let url = `${FIREBASE_DATABASE_URL}/${path}.json`;
  if (FIREBASE_API_KEY) {
    url += `?auth=${FIREBASE_API_KEY}`;
  }
  return url;
};

const firebaseGet = async (path: string): Promise<any> => {
  const url = buildFirebaseUrl(path);
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Firebase GET failed (${response.status})`);
  }

  return response.json();
};

const firebasePost = async (path: string, data: any): Promise<string> => {
  const url = buildFirebaseUrl(path);
  const response = await fetch(url, {
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
  const url = buildFirebaseUrl(path);
  const response = await fetch(url, {
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
export const verifyLogin = async (
  displayName: string,
  passcode: string
): Promise<{
  valid: boolean;
  driverId?: string;
  displayName?: string;
  passcodeHash?: string;
  isAdmin?: boolean;
  isViewer?: boolean;
  companyId?: string;
  companyName?: string;
  tier?: CompanyTier;
  error?: string;
}> => {
  console.log("[DriverAuth] Verifying login for:", displayName);

  try {
    const hash = await hashPasscode(passcode, displayName);
    console.log("[DriverAuth] Hash:", hash.slice(0, 8) + "...");

    // Look up by name+passcode hash
    const driverData = await firebaseGet(`${DRIVERS_APPROVED}/${hash}`);

    if (!driverData) {
      console.log("[DriverAuth] No driver found with this passcode");
      return { valid: false, error: "Invalid name or passcode" };
    }

    // Check if this is the new flat structure (has displayName directly)
    if (driverData.displayName) {
      // New structure: drivers/approved/{hash}/ = { displayName, active, ... }
      if (driverData.active === false) {
        return { valid: false, error: "This account has been deactivated" };
      }

      if (driverData.displayName.toLowerCase() !== displayName.toLowerCase()) {
        console.log("[DriverAuth] Name mismatch");
        return { valid: false, error: "Invalid name or passcode" };
      }

      console.log("[DriverAuth] Login verified for:", driverData.displayName);

      // Update device tracking (fire and forget)
      updateDeviceTracking(hash, driverData.displayName);

      return {
        valid: true,
        driverId: hash,
        displayName: driverData.displayName,
        passcodeHash: hash,
        isAdmin: driverData.isAdmin === true,
        isViewer: driverData.isViewer === true,
        companyId: driverData.companyId || undefined,
        companyName: driverData.companyName || undefined,
        tier: driverData.tier || undefined,
      };
    }

    // Legacy structure: drivers/approved/{hash}/{deviceId}/ = { displayName, ... }
    // Check each sub-entry for matching name
    for (const key of Object.keys(driverData)) {
      const entry = driverData[key];
      if (
        entry.displayName?.toLowerCase() === displayName.toLowerCase() &&
        entry.active !== false
      ) {
        console.log("[DriverAuth] Login verified (legacy) for:", entry.displayName);

        // Update device tracking (fire and forget)
        updateDeviceTracking(hash, entry.displayName);

        return {
          valid: true,
          driverId: hash,
          displayName: entry.displayName,
          passcodeHash: hash,
          isAdmin: entry.isAdmin === true,
          isViewer: entry.isViewer === true,
          companyId: entry.companyId || undefined,
          companyName: entry.companyName || undefined,
          tier: entry.tier || undefined,
        };
      }
    }

    console.log("[DriverAuth] Name mismatch in legacy structure");
    return { valid: false, error: "Invalid name or passcode" };
  } catch (error) {
    console.error("[DriverAuth] Error verifying login:", error);
    return { valid: false, error: "Connection error" };
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

    const url = buildFirebaseUrl(`devices/company/${deviceId}`);
    const response = await fetch(url, {
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
  try {
    const url = buildFirebaseUrl(`devices/company/${deviceId}`);
    const response = await fetch(url, {
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
export const saveDriverSession = async (
  driverId: string,
  displayName: string,
  passcodeHash: string,
  isAdmin: boolean = false,
  isViewer: boolean = false,
  companyId?: string,
  companyName?: string,
  tier?: CompanyTier
): Promise<void> => {
  await SecureStore.setItemAsync("driverId", driverId);
  await SecureStore.setItemAsync("driverName", displayName);
  await SecureStore.setItemAsync("passcodeHash", passcodeHash);
  await SecureStore.setItemAsync("isAdmin", isAdmin ? "true" : "false");
  await SecureStore.setItemAsync("isViewer", isViewer ? "true" : "false");
  await SecureStore.setItemAsync("driverVerifiedAt", Date.now().toString());
  if (companyId) await SecureStore.setItemAsync("companyId", companyId);
  else await SecureStore.deleteItemAsync("companyId");
  if (companyName) await SecureStore.setItemAsync("companyName", companyName);
  else await SecureStore.deleteItemAsync("companyName");
  if (tier) await SecureStore.setItemAsync("tier", tier);
  else await SecureStore.deleteItemAsync("tier");

  // Clear any pending registration data
  await clearPendingRegistration();
};

/**
 * Get current driver session
 */
export const getDriverSession = async (): Promise<DriverSession | null> => {
  const driverId = await SecureStore.getItemAsync("driverId");
  const displayName = await SecureStore.getItemAsync("driverName");
  const passcodeHash = await SecureStore.getItemAsync("passcodeHash");
  const isAdminStr = await SecureStore.getItemAsync("isAdmin");
  const isViewerStr = await SecureStore.getItemAsync("isViewer");
  const companyId = await SecureStore.getItemAsync("companyId");
  const companyName = await SecureStore.getItemAsync("companyName");
  const tier = await SecureStore.getItemAsync("tier");

  if (driverId && displayName && passcodeHash) {
    return {
      driverId,
      displayName,
      passcodeHash,
      isAdmin: isAdminStr === "true",
      isViewer: isViewerStr === "true",
      companyId: companyId || undefined,
      companyName: companyName || undefined,
      tier: (tier as CompanyTier) || undefined,
    };
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
export const revalidateDriverSession = async (): Promise<boolean> => {
  const session = await getDriverSession();
  if (!session) return false;

  try {
    const hash = session.passcodeHash;
    if (!hash) {
      console.log("[DriverAuth] No passcodeHash in session");
      return false;
    }

    console.log("[DriverAuth] Revalidating session for hash:", hash.slice(0, 8) + "...");
    const driverData = await firebaseGet(`${DRIVERS_APPROVED}/${hash}`);

    if (!driverData) {
      console.log("[DriverAuth] Driver not found, clearing session...");
      await clearDriverSession();
      return false;
    }

    // Check new structure (displayName at root)
    if (driverData.displayName) {
      if (driverData.active === false) {
        console.log("[DriverAuth] Driver deactivated, clearing session...");
        await clearDriverSession();
        return false;
      }
      return true;
    }

    // Check legacy structure (nested by deviceId)
    for (const key of Object.keys(driverData)) {
      const entry = driverData[key];
      if (entry.displayName?.toLowerCase() === session.displayName.toLowerCase()) {
        if (entry.active === false) {
          console.log("[DriverAuth] Driver deactivated (legacy), clearing session...");
          await clearDriverSession();
          return false;
        }
        return true;
      }
    }

    console.log("[DriverAuth] Driver name not found in approved list");
    await clearDriverSession();
    return false;
  } catch (error) {
    console.error("[DriverAuth] Error revalidating session:", error);
    // Don't clear session on network error - allow offline use
    return true;
  }
};

/**
 * Clear driver session (logout)
 */
export const clearDriverSession = async (): Promise<void> => {
  await SecureStore.deleteItemAsync("driverId");
  await SecureStore.deleteItemAsync("driverName");
  await SecureStore.deleteItemAsync("passcodeHash");
  await SecureStore.deleteItemAsync("driverVerifiedAt");
  // Legacy cleanup
  await SecureStore.deleteItemAsync("driverPin");
  await SecureStore.deleteItemAsync("driverEmail");
  await clearPendingRegistration();
};

// --- Registration ---

/**
 * Check if a passcode is available (not already in use)
 */
export const isPasscodeAvailable = async (
  passcode: string,
  name?: string
): Promise<{ available: boolean; reason?: string }> => {
  try {
    const hash = await hashPasscode(passcode, name);

    // Check if name+passcode combo is already approved
    const existingDriver = await firebaseGet(`${DRIVERS_APPROVED}/${hash}`);
    if (existingDriver) {
      return { available: false, reason: "This name and passcode combination is already registered" };
    }

    // Check pending registrations
    const pendingDrivers = await firebaseGet(DRIVERS_PENDING);
    if (pendingDrivers) {
      for (const key of Object.keys(pendingDrivers)) {
        const pending = pendingDrivers[key];
        if (pending.passcodeHash === hash) {
          return { available: false, reason: "A registration with this name and passcode is already pending" };
        }
      }
    }

    return { available: true };
  } catch (error) {
    console.error("[DriverAuth] Error checking passcode availability:", error);
    return { available: false, reason: "Connection error" };
  }
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
    const hash = await hashPasscode(params.passcode, params.displayName);

    const registrationData: Record<string, any> = {
      displayName: params.displayName,
      passcodeHash: hash,
      requestedAt: new Date().toISOString(),
      source: 'wbm',
    };
    if (params.companyName?.trim()) {
      registrationData.companyName = params.companyName.trim();
    }
    if (params.legalName?.trim()) {
      registrationData.legalName = params.legalName.trim();
    }

    // POST to pending registrations (Firebase generates key)
    await firebasePost(DRIVERS_PENDING, registrationData);

    // Save pending registration locally
    await SecureStore.setItemAsync("pendingPasscodeHash", hash);
    await SecureStore.setItemAsync("pendingDisplayName", params.displayName);
    await SecureStore.setItemAsync("pendingRegistrationTime", Date.now().toString());

    console.log("[DriverAuth] Registration submitted successfully");
    return { success: true };
  } catch (error) {
    console.error("[DriverAuth] Error submitting registration:", error);
    return { success: false, error: "Connection error" };
  }
};

/**
 * Get pending registration info
 */
export const getPendingRegistration = async (): Promise<{
  passcodeHash: string;
  displayName: string;
} | null> => {
  const passcodeHash = await SecureStore.getItemAsync("pendingPasscodeHash");
  const displayName = await SecureStore.getItemAsync("pendingDisplayName");

  if (passcodeHash && displayName) {
    return { passcodeHash, displayName };
  }
  return null;
};

/**
 * Check registration status
 * Structure: drivers/approved/{passcodeHash}/ = { displayName, ... }
 */
export const checkRegistrationStatus = async (): Promise<
  "pending" | "approved" | "rejected" | "none"
> => {
  const pending = await getPendingRegistration();
  if (!pending) {
    return "none";
  }

  try {
    // Check if approved
    const driver = await firebaseGet(`${DRIVERS_APPROVED}/${pending.passcodeHash}`);
    if (driver) {
      return "approved";
    }

    // Check if still in pending
    const pendingDrivers = await firebaseGet(DRIVERS_PENDING);
    if (pendingDrivers) {
      for (const key of Object.keys(pendingDrivers)) {
        const registration = pendingDrivers[key];
        if (registration.passcodeHash === pending.passcodeHash) {
          return "pending";
        }
      }
    }

    // Not in approved, not in pending = rejected
    return "rejected";
  } catch (error) {
    console.error("[DriverAuth] Error checking registration status:", error);
    return "pending";
  }
};

/**
 * Complete registration after approval
 * Called when checkRegistrationStatus returns "approved"
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
    const driverData = await firebaseGet(`${DRIVERS_APPROVED}/${pending.passcodeHash}`);

    if (!driverData) {
      return { success: false, error: "Driver not found in approved list" };
    }

    // New structure: displayName at root
    const displayName = driverData.displayName || pending.displayName;
    const isAdmin = driverData.isAdmin === true;
    const isViewer = driverData.isViewer === true;

    await saveDriverSession(pending.passcodeHash, displayName, pending.passcodeHash, isAdmin, isViewer, driverData.companyId, driverData.companyName, driverData.tier);
    return {
      success: true,
      driverId: pending.passcodeHash,
      displayName,
    };
  } catch (error) {
    console.error("[DriverAuth] Error completing registration:", error);
    return { success: false, error: "Connection error" };
  }
};

/**
 * Clear pending registration
 */
export const clearPendingRegistration = async (): Promise<void> => {
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
  // With Firebase, we always have access (no OAuth needed)
  try {
    const testResult = await firebaseGet("");
    return { hasAccess: true };
  } catch (error) {
    return { hasAccess: false, error: "Could not connect to server" };
  }
};

/**
 * Get driver ID for the current session
 * Used for "your pull" tracking
 */
export const getDriverId = async (): Promise<string | null> => {
  return SecureStore.getItemAsync("driverId");
};

/**
 * Get driver display name for the current session
 */
export const getDriverName = async (): Promise<string | null> => {
  return SecureStore.getItemAsync("driverName");
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
