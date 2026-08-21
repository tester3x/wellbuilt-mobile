// src/services/wellConfig.ts
// Loads and caches well configuration from Firebase

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { diagnoseHttpStatus, diagnoseThrown } from "./connectionDiagnosis";
import {
  EligibilityStatus,
  EligibilityVerdict,
  evaluateAuthoritativeAssignedRoutes,
  normalizeRouteList,
  resolveEligibility,
  unknownVerdict,
  verdictFromAuthoritative,
} from "./eligibility";

const STORAGE_KEY = "@wellbuilt_well_config";
const LAST_FETCH_KEY = "@wellbuilt_config_last_fetch";
const ASSIGNED_ROUTES_KEY = "@wellbuilt_assigned_routes";
const ASSIGNED_WELLS_KEY = "@wellbuilt_assigned_wells";
const ELIGIBILITY_STATUS_KEY = "@wellbuilt_eligibility_status";
const REFRESH_INTERVAL_DAYS = 3;

// Firebase config
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";

export interface WellConfig {
  allowedBottom: number;
  numTanks: number;
  loadLine: number;
  avgFlowRate?: string;
  avgFlowRateMinutes?: number;
  route?: string;
  isDown?: boolean;
}

export interface WellConfigMap {
  [wellName: string]: WellConfig;
}

const DEFAULT_CONFIG: WellConfig = {
  allowedBottom: 3,
  numTanks: 1,
  loadLine: 1.33,
};

let cachedConfig: WellConfigMap | null = null;

export async function loadWellConfig(
  forceRefresh: boolean = false
): Promise<WellConfigMap | null> {
  try {
    if (!forceRefresh && cachedConfig) {
      return cachedConfig;
    }

    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    const lastFetch = await AsyncStorage.getItem(LAST_FETCH_KEY);

    if (stored && !forceRefresh) {
      cachedConfig = JSON.parse(stored);

      if (lastFetch && !needsRefresh(lastFetch)) {
        console.log("[WellConfig] Using cached config");
        return cachedConfig;
      }
    }

    console.log("[WellConfig] Fetching fresh config from Firebase...");
    const freshConfig = await fetchConfigFromFirebase();

    if (freshConfig) {
      cachedConfig = freshConfig;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(freshConfig));
      await AsyncStorage.setItem(LAST_FETCH_KEY, new Date().toISOString());
      console.log("[WellConfig] Config updated and cached");
      return freshConfig;
    }

    if (cachedConfig) {
      console.log("[WellConfig] Fetch failed, using stale cache");
      return cachedConfig;
    }

    return null;
  } catch (error) {
    console.error("[WellConfig] Error loading config:", error);
    return cachedConfig;
  }
}

function needsRefresh(lastFetchISO: string): boolean {
  const lastFetch = new Date(lastFetchISO);
  const now = new Date();
  const daysSince =
    (now.getTime() - lastFetch.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= REFRESH_INTERVAL_DAYS;
}

async function fetchConfigFromFirebase(): Promise<WellConfigMap | null> {
  try {
    // Company/assignment scoped callable. Never GET /well_config.json.
    const { authorizedCallable } = await import("./firebaseAuthSession");
    const res = await authorizedCallable<{
      ok: true;
      companyId: string;
      wells: WellConfigMap;
      assignmentStatus?: string;
      assignmentReason?: string;
    }>(
      "getDriverWellConfig",
      {},
    );
    if (res?.assignmentStatus === "assignment_unavailable") {
      console.warn("[WellConfig] assignment_unavailable");
      return null;
    }
    if (!res?.wells) {
      console.warn("[WellConfig] Callable returned no wells");
      return null;
    }
    console.log("[WellConfig] Fetched", Object.keys(res.wells).length, "assigned wells");
    return res.wells;
  } catch (error) {
    console.error("[WellConfig] Fetch error:", error);
    return null;
  }
}

export async function getWellConfig(wellName: string): Promise<WellConfig> {
  if (!cachedConfig) {
    await loadWellConfig();
  }

  if (cachedConfig && cachedConfig[wellName]) {
    return cachedConfig[wellName];
  }

  console.warn(`[WellConfig] No config for "${wellName}", using defaults`);
  return DEFAULT_CONFIG;
}

export async function getBblPerFoot(wellName: string): Promise<number> {
  const config = await getWellConfig(wellName);
  // Use stored bblPerFoot from Dashboard if available, else derive from legacy formula
  return (config as any).bblPerFoot || 20 * config.numTanks;
}

export function getWellConfigSync(wellName: string): WellConfig {
  if (cachedConfig && cachedConfig[wellName]) {
    return cachedConfig[wellName];
  }
  return DEFAULT_CONFIG;
}

export function getBblPerFootSync(wellName: string): number {
  const config = getWellConfigSync(wellName);
  // Use stored bblPerFoot from Dashboard if available, else derive from legacy formula
  return (config as any).bblPerFoot || 20 * config.numTanks;
}

export async function forceRefreshWellConfig(): Promise<boolean> {
  const config = await loadWellConfig(true);
  return config !== null;
}

export async function clearWellConfigCache(): Promise<void> {
  cachedConfig = null;
  await AsyncStorage.removeItem(STORAGE_KEY);
  await AsyncStorage.removeItem(LAST_FETCH_KEY);
}

export async function getAllWellNames(): Promise<string[]> {
  if (!cachedConfig) {
    await loadWellConfig();
  }

  if (cachedConfig) {
    return Object.keys(cachedConfig).sort();
  }

  return [];
}

// ── Driver Route Assignment ──

let cachedAssignedRoutes: string[] | null = null;
let cachedAssignedWells: string[] | null = null;

export async function readDurableEligibility(): Promise<EligibilityVerdict | null> {
  try {
    const raw = await AsyncStorage.getItem(ELIGIBILITY_STATUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EligibilityVerdict;
    if (parsed?.status !== 'eligible' && parsed?.status !== 'ineligible' && parsed?.status !== 'unknown') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function persistDurableEligibility(v: EligibilityVerdict): Promise<void> {
  if (v.status === 'unknown') return; // never persist unknown as last-known denial/grant
  await AsyncStorage.setItem(ELIGIBILITY_STATUS_KEY, JSON.stringify(v));
  if (v.routes) {
    cachedAssignedRoutes = v.routes;
    await AsyncStorage.setItem(ASSIGNED_ROUTES_KEY, JSON.stringify(v.routes));
  }
  if (v.wells) {
    cachedAssignedWells = v.wells;
    await AsyncStorage.setItem(ASSIGNED_WELLS_KEY, JSON.stringify(v.wells));
  }
}

export async function fetchAssignmentClassified(
  fetchFn: typeof fetch = fetch,
): Promise<EligibilityVerdict> {
  try {
    const driverId = await SecureStore.getItemAsync("driverId");
    if (!driverId) {
      return unknownVerdict('missing_driver_id', true);
    }
    let token = 'missing';
    try {
      const { getValidIdToken } = await import("./firebaseAuthSession");
      token = await getValidIdToken();
    } catch (err) {
      const d = diagnoseThrown(err);
      return unknownVerdict(d.code || 'missing_token', d.retryable);
    }
    if (token === 'missing') {
      return unknownVerdict('missing_token', true);
    }
    const url = `${FIREBASE_DATABASE_URL}/drivers/profiles/${driverId}.json?auth=${encodeURIComponent(token)}`;
    const response = await fetchFn(url, { method: "GET", headers: { "Content-Type": "application/json" } });
    if (!response.ok) {
      const d = diagnoseHttpStatus(response.status);
      return unknownVerdict(d.code, d.retryable);
    }
    const data = await response.json();
    if (data == null) {
      return unknownVerdict('null_profile', true);
    }
    const verdict = verdictFromAuthoritative(data.assignedRoutes, data.assignedWells);
    if (verdict.status !== 'unknown') {
      cachedAssignedRoutes = verdict.routes;
      cachedAssignedWells = verdict.wells;
      await persistDurableEligibility(verdict);
    }
    return verdict;
  } catch (error) {
    const d = diagnoseThrown(error);
    return unknownVerdict(d.code, d.retryable);
  }
}

/**
 * Resolve current eligibility: classified fetch + durable last-known + session.
 * Unknown never becomes ineligible.
 */
export async function resolveCurrentEligibility(): Promise<EligibilityVerdict> {
  const companyId = await SecureStore.getItemAsync("companyId");
  const sessionRoutesRaw = await SecureStore.getItemAsync("assignedRoutes");
  let sessionRoutes: unknown = null;
  try { sessionRoutes = sessionRoutesRaw ? JSON.parse(sessionRoutesRaw) : null; } catch { sessionRoutes = null; }
  const fetch = await fetchAssignmentClassified();
  const durable = await readDurableEligibility();
  return resolveEligibility({
    hasCompanyId: !!companyId,
    fetch,
    durable,
    sessionRoutes,
  });
}

/**
 * Fetch driver's assignedRoutes and assignedWells.
 * Failed/unknown lookups do NOT collapse to [] (that was the false-denial).
 * Callers that need a filter list should use verdict.routes when status is eligible.
 */
export async function fetchDriverRouteAssignment(): Promise<{
  routes: string[];
  wells: string[];
  status: EligibilityStatus;
  authoritative: boolean;
}> {
  const verdict = await resolveCurrentEligibility();
  return {
    routes: verdict.routes || [],
    wells: verdict.wells || [],
    status: verdict.status,
    authoritative: verdict.source === 'authoritative',
  };
}

/**
 * Get cached route assignment (synchronous, from memory or AsyncStorage).
 */
export async function getDriverRouteAssignment(): Promise<{ routes: string[]; wells: string[] }> {
  if (cachedAssignedRoutes !== null) {
    return { routes: cachedAssignedRoutes, wells: cachedAssignedWells || [] };
  }

  try {
    const storedRoutes = await AsyncStorage.getItem(ASSIGNED_ROUTES_KEY);
    const storedWells = await AsyncStorage.getItem(ASSIGNED_WELLS_KEY);
    cachedAssignedRoutes = storedRoutes ? JSON.parse(storedRoutes) : [];
    cachedAssignedWells = storedWells ? JSON.parse(storedWells) : [];
    return { routes: cachedAssignedRoutes || [], wells: cachedAssignedWells || [] };
  } catch {
    return { routes: [], wells: [] };
  }
}

/**
 * Filter well_config to wells matching assigned routes/wells.
 * Empty arrays are NOT "see everything" — that was the [] contradiction.
 * Pass unrestricted:true only for no-company admin sessions.
 */
export function filterWellConfigByAssignment(
  config: WellConfigMap,
  assignedRoutes: string[],
  assignedWells: string[],
  opts?: { unrestricted?: boolean },
): WellConfigMap {
  if (opts?.unrestricted) {
    return config;
  }
  if (assignedRoutes.length === 0 && assignedWells.length === 0) {
    return {};
  }

  const filtered: WellConfigMap = {};
  for (const [wellName, wellConfig] of Object.entries(config)) {
    const wellRoute = wellConfig.route || '';
    const routeMatch = assignedRoutes.some(assignedRoute => {
      // "Unrouted" matches "Unrouted", "Unrouted 2", "Unrouted 3", etc.
      if (assignedRoute === 'Unrouted') return wellRoute.startsWith('Unrouted');
      return assignedRoute === wellRoute;
    });
    const wellMatch = assignedWells.includes(wellName);
    if (routeMatch || wellMatch) {
      filtered[wellName] = wellConfig;
    }
  }

  console.log(`[WellConfig] Filtered: ${Object.keys(filtered).length}/${Object.keys(config).length} wells`);
  return filtered;
}

/**
 * Authoritative-array helper only. Do NOT pass failed-lookup leftovers.
 * Missing field → not a boolean denial (returns true for legacy "field absent"
 * only when the caller already proved the fetch succeeded AND the field was
 * omitted — prefer evaluateAuthoritativeAssignedRoutes).
 */
export function driverHasRealRoutes(assignedRoutes: string[] | undefined | null): boolean {
  return evaluateAuthoritativeAssignedRoutes(assignedRoutes) === 'eligible';
}
