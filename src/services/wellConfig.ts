// src/services/wellConfig.ts
// Loads and caches well configuration from Firebase

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@wellbuilt_well_config";
const LAST_FETCH_KEY = "@wellbuilt_config_last_fetch";
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
