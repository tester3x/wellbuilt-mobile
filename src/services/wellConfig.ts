// src/services/wellConfig.ts
// Loads and caches well configuration from Firebase

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "@wellbuilt_well_config";
const LAST_FETCH_KEY = "@wellbuilt_config_last_fetch";
const ASSIGNED_ROUTES_KEY = "@wellbuilt_assigned_routes";
const ASSIGNED_WELLS_KEY = "@wellbuilt_assigned_wells";
const REFRESH_INTERVAL_DAYS = 3;

// Firebase config
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

export interface WellConfig {
  allowedBottom: number;
  numTanks: number;
  loadLine: number;
  avgFlowRate?: string;
  avgFlowRateMinutes?: number;
  route?: string;
  routeColor?: string;
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
    // Fetch well_config from Firebase (VBA exports to /well_config)
    const url = `${FIREBASE_DATABASE_URL}/well_config.json?auth=${FIREBASE_API_KEY}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error("[WellConfig] Firebase fetch failed:", response.status);
      return null;
    }

    const config = await response.json();

    if (!config) {
      console.warn("[WellConfig] No well config found in Firebase");
      return null;
    }

    console.log("[WellConfig] Fetched", Object.keys(config).length, "wells from Firebase");
    return config;
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
  return 20 * config.numTanks;
}

export function getWellConfigSync(wellName: string): WellConfig {
  if (cachedConfig && cachedConfig[wellName]) {
    return cachedConfig[wellName];
  }
  return DEFAULT_CONFIG;
}

export function getBblPerFootSync(wellName: string): number {
  const config = getWellConfigSync(wellName);
  return 20 * config.numTanks;
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

/**
 * Fetch driver's assignedRoutes and assignedWells from Firebase.
 * Returns { routes, wells } arrays. Empty arrays = no restriction (sees all).
 */
export async function fetchDriverRouteAssignment(): Promise<{ routes: string[]; wells: string[] }> {
  try {
    const passcodeHash = await SecureStore.getItemAsync("passcodeHash");
    if (!passcodeHash) {
      console.log("[WellConfig] No passcodeHash, skipping route assignment fetch");
      return { routes: [], wells: [] };
    }

    const url = `${FIREBASE_DATABASE_URL}/drivers/approved/${passcodeHash}.json?auth=${FIREBASE_API_KEY}`;
    const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });

    if (!response.ok) {
      console.error("[WellConfig] Route assignment fetch failed:", response.status);
      return { routes: cachedAssignedRoutes || [], wells: cachedAssignedWells || [] };
    }

    const data = await response.json();
    const routes = Array.isArray(data?.assignedRoutes) ? data.assignedRoutes : [];
    const wells = Array.isArray(data?.assignedWells) ? data.assignedWells : [];

    // Cache locally
    cachedAssignedRoutes = routes;
    cachedAssignedWells = wells;
    await AsyncStorage.setItem(ASSIGNED_ROUTES_KEY, JSON.stringify(routes));
    await AsyncStorage.setItem(ASSIGNED_WELLS_KEY, JSON.stringify(wells));

    console.log(`[WellConfig] Route assignment: ${routes.length} routes, ${wells.length} wells`);
    return { routes, wells };
  } catch (error) {
    console.error("[WellConfig] Route assignment fetch error:", error);
    return { routes: cachedAssignedRoutes || [], wells: cachedAssignedWells || [] };
  }
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
 * Filter well_config to only include wells matching driver's assigned routes/wells.
 * If no assignments (empty arrays), returns ALL wells (no restriction).
 */
export function filterWellConfigByAssignment(
  config: WellConfigMap,
  assignedRoutes: string[],
  assignedWells: string[]
): WellConfigMap {
  // No assignments = see everything (WB admin or unassigned driver)
  if (assignedRoutes.length === 0 && assignedWells.length === 0) {
    return config;
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
 * Check if a driver has "real" routes (not just Unrouted* variants).
 * Used to gate WB M access — Unrouted-only drivers use WB T, not WB M.
 *
 * - undefined = legacy driver, routes never assigned → allow access
 * - [] = explicitly no routes → no access
 * - ["Unrouted"] = unrouted only → no access
 * - ["North Loop", "Unrouted"] = has real route → allow access
 */
export function driverHasRealRoutes(assignedRoutes: string[] | undefined | null): boolean {
  if (assignedRoutes === undefined || assignedRoutes === null) return true;
  if (assignedRoutes.length === 0) return false;
  return assignedRoutes.some(r => !r.startsWith('Unrouted'));
}
