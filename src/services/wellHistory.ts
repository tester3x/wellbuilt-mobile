// src/services/wellHistory.ts
// Stores last pull data per well locally on device
// Used to estimate current level without hitting the DB
// Also stores slider position and cached flow rates per well

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "@wellbuilt_well_history";
const SLIDER_KEY = "@wellbuilt_slider_positions";
const FLOWRATE_KEY = "@wellbuilt_flow_rates";
const PENDING_PULL_KEY = "@wellbuilt_pending_pull_";

export interface WellPullRecord {
  levelFeet: number;
  timestamp: number; // ms since epoch
  bblsTaken?: number;
  dateTime?: string;
}

export interface WellHistoryMap {
  [wellName: string]: WellPullRecord;
}

export interface SliderPositionMap {
  [wellName: string]: number;
}

let cachedHistory: WellHistoryMap = {};
let cachedSliders: SliderPositionMap = {};

// ========== WELL PULL HISTORY ==========

export async function loadWellHistory(): Promise<WellHistoryMap> {
  if (Object.keys(cachedHistory).length > 0) return cachedHistory;

  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    cachedHistory = stored ? JSON.parse(stored) : {};
    return cachedHistory;
  } catch (error) {
    console.error("[WellHistory] Error loading:", error);
    cachedHistory = {};
    return cachedHistory;
  }
}

export async function saveWellPull(
  wellName: string,
  levelFeet: number,
  bblsTaken?: number,
  dateTime?: string
): Promise<void> {
  try {
    if (Object.keys(cachedHistory).length === 0) await loadWellHistory();

    cachedHistory[wellName] = {
      levelFeet,
      timestamp: Date.now(),
      bblsTaken,
      dateTime,
    };

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cachedHistory));
  } catch (error) {
    console.error("[WellHistory] Error saving:", error);
  }
}

export async function getWellPull(
  wellName: string
): Promise<WellPullRecord | null> {
  if (Object.keys(cachedHistory).length === 0) await loadWellHistory();
  return cachedHistory[wellName] || null;
}

export function getWellPullSync(wellName: string): WellPullRecord | null {
  return cachedHistory[wellName] || null;
}

export async function clearWellHistory(): Promise<void> {
  cachedHistory = {};
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// ========== SLIDER POSITIONS ==========

export async function loadSliderPositions(): Promise<SliderPositionMap> {
  if (Object.keys(cachedSliders).length > 0) return cachedSliders;

  try {
    const stored = await AsyncStorage.getItem(SLIDER_KEY);
    cachedSliders = stored ? JSON.parse(stored) : {};
    return cachedSliders;
  } catch (error) {
    console.error("[WellHistory] Error loading sliders:", error);
    cachedSliders = {};
    return cachedSliders;
  }
}

export async function saveSliderPosition(
  wellName: string,
  position: number
): Promise<void> {
  try {
    if (Object.keys(cachedSliders).length === 0) await loadSliderPositions();
    cachedSliders[wellName] = position;
    await AsyncStorage.setItem(SLIDER_KEY, JSON.stringify(cachedSliders));
  } catch (error) {
    console.error("[WellHistory] Error saving slider:", error);
  }
}

export async function getSliderPosition(wellName: string): Promise<number> {
  if (Object.keys(cachedSliders).length === 0) await loadSliderPositions();
  return cachedSliders[wellName] ?? 10.5; // Default to 10'6"
}

export function getSliderPositionSync(wellName: string): number {
  return cachedSliders[wellName] ?? 10.5;
}

// ========== CACHED FLOW RATES (DEPRECATED) ==========
// DEPRECATED: Flow rate is now stored in LevelSnapshot to keep level and flow rate in sync.
// This prevents stale flow rate data from causing level drift.
// Keeping these functions temporarily for backwards compatibility and to clean up old data.

export interface CachedFlowRate {
  flowRate: string;        // "1:16:00" format
  flowRateMinutes: number; // parsed to minutes
  timestamp: number;       // when we got this
}

export interface FlowRateMap {
  [wellName: string]: CachedFlowRate;
}

let cachedFlowRates: FlowRateMap = {};

/** @deprecated Flow rate is now stored in LevelSnapshot */
export async function loadFlowRates(): Promise<FlowRateMap> {
  if (Object.keys(cachedFlowRates).length > 0) return cachedFlowRates;

  try {
    const stored = await AsyncStorage.getItem(FLOWRATE_KEY);
    cachedFlowRates = stored ? JSON.parse(stored) : {};
    return cachedFlowRates;
  } catch (error) {
    console.error("[WellHistory] Error loading flow rates:", error);
    cachedFlowRates = {};
    return cachedFlowRates;
  }
}

/** @deprecated Flow rate is now stored in LevelSnapshot */
export async function saveFlowRate(
  wellName: string,
  flowRate: string
): Promise<void> {
  try {
    if (Object.keys(cachedFlowRates).length === 0) await loadFlowRates();

    // Parse H:MM:SS to minutes
    const parts = flowRate.split(':').map(Number);
    let flowRateMinutes = 0;
    if (parts.length === 3) {
      flowRateMinutes = parts[0] * 60 + parts[1] + parts[2] / 60;
    }

    cachedFlowRates[wellName] = {
      flowRate,
      flowRateMinutes,
      timestamp: Date.now(),
    };

    await AsyncStorage.setItem(FLOWRATE_KEY, JSON.stringify(cachedFlowRates));
  } catch (error) {
    console.error("[WellHistory] Error saving flow rate:", error);
  }
}

/** @deprecated Flow rate is now stored in LevelSnapshot */
export async function getFlowRate(wellName: string): Promise<CachedFlowRate | null> {
  if (Object.keys(cachedFlowRates).length === 0) await loadFlowRates();
  return cachedFlowRates[wellName] || null;
}

/** @deprecated Flow rate is now stored in LevelSnapshot */
export function getFlowRateSync(wellName: string): CachedFlowRate | null {
  return cachedFlowRates[wellName] || null;
}

/**
 * Clear the deprecated flow rate cache from AsyncStorage.
 * Call this on app startup to clean up old data.
 */
export async function clearDeprecatedFlowRateCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(FLOWRATE_KEY);
    cachedFlowRates = {};
    console.log("[WellHistory] Cleared deprecated flow rate cache");
  } catch (error) {
    console.error("[WellHistory] Error clearing flow rate cache:", error);
  }
}

/**
 * Clear ALL level snapshots from AsyncStorage.
 * Use this as a nuclear option when cached data is corrupted.
 * The app will re-fetch fresh data from Firebase on next sync.
 */
export async function clearAllLevelSnapshots(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SNAPSHOT_KEY);
    cachedSnapshots = {};
    console.log("[WellHistory] Cleared all level snapshots - will re-fetch from Firebase");
  } catch (error) {
    console.error("[WellHistory] Error clearing level snapshots:", error);
  }
}

// ========== CURRENT LEVEL SNAPSHOTS ==========
// Stores the current level from response packets (from any driver)
// This is the level AT THE TIME of the response, used to estimate current level

const SNAPSHOT_KEY = "@wellbuilt_level_snapshots";

export interface LevelSnapshot {
  levelFeet: number;        // Current level at time of snapshot (= bottom level after last pull)
  timestamp: number;        // When the last pull happened (ms since epoch) - used for level estimation
  responseTimestamp: string; // Original timestamp from response packet
  isDown?: boolean;         // Whether well was down at time of snapshot
  lastPullDateTime?: string;
  lastPullDateTimeUTC?: string;  // ISO 8601 UTC timestamp of last pull - use for calculations
  lastPullBbls?: number;
  lastPullTopLevel?: string;     // Tank level before pull (from VBA)
  lastPullBottomLevel?: string;  // Tank level after pull (from VBA)
  lastPullBottomLevelFeet?: number; // Parsed bottom level in feet - for accurate estimation
  flowRate?: string;             // Flow rate string (e.g., "0:07:25") - stored with snapshot so they stay in sync
  flowRateMinutes?: number;      // Parsed flow rate in minutes (e.g., 7.417)
  windowBblsDay?: number;        // Window-averaged bbls/day (from Cloud Function or history screen)
  overnightBblsDay?: number;     // Longest-gap (overnight) bbls/day from Cloud Function
}

export interface LevelSnapshotMap {
  [wellName: string]: LevelSnapshot;
}

let cachedSnapshots: LevelSnapshotMap = {};

export async function loadLevelSnapshots(): Promise<LevelSnapshotMap> {
  if (Object.keys(cachedSnapshots).length > 0) return cachedSnapshots;

  try {
    const stored = await AsyncStorage.getItem(SNAPSHOT_KEY);
    cachedSnapshots = stored ? JSON.parse(stored) : {};
    return cachedSnapshots;
  } catch (error) {
    console.error("[WellHistory] Error loading snapshots:", error);
    cachedSnapshots = {};
    return cachedSnapshots;
  }
}

// Helper: Parse feet'inches" string to decimal feet
function parseFeetInchesToFeet(str: string | undefined): number | undefined {
  if (!str || str === 'Unknown' || str === 'N/A') return undefined;
  const match = str.match(/^(\d+)\s*'\s*(\d+)"?$/);
  if (match) {
    return Number(match[1]) + Number(match[2]) / 12;
  }
  return undefined;
}

export async function saveLevelSnapshot(
  wellName: string,
  levelFeet: number,
  responseTimestamp: string,
  isDown: boolean = false,
  lastPullDateTime?: string,
  lastPullBbls?: number,
  lastPullTopLevel?: string,
  lastPullBottomLevel?: string,
  flowRate?: string,
  flowRateMinutes?: number,
  lastPullDateTimeUTC?: string,
  forceUpdate: boolean = false,  // Skip timestamp comparison (for edits)
  windowBblsDay?: number,
  overnightBblsDay?: number,
): Promise<void> {
  try {
    if (Object.keys(cachedSnapshots).length === 0) await loadLevelSnapshots();

    // Parse timestamp for the snapshot
    // CRITICAL: Use lastPullDateTimeUTC if available - this is the ACTUAL pull time
    // The responseTimestamp might be processing time if response came from dashboard functions
    const timestampSource = lastPullDateTimeUTC || responseTimestamp;
    let timestamp = Date.now();
    if (timestampSource) {
      // Try parsing directly first (works for ISO 8601)
      let parsed = new Date(timestampSource);
      // If that fails, try the old format with space replacement
      if (isNaN(parsed.getTime())) {
        parsed = new Date(timestampSource.replace(" ", "T"));
      }
      if (!isNaN(parsed.getTime())) {
        timestamp = parsed.getTime();
      }
    }

    // VALIDATION: Reject obviously corrupt data
    // - Timestamps before year 2020 are likely Excel epoch errors (1899/1900)
    // - Flow rates under 1 minute are likely corrupt (real wells take at least several minutes per inch)
    const minValidTimestamp = new Date('2020-01-01').getTime();
    if (timestamp < minValidTimestamp) {
      console.log(`[WellHistory] Rejecting corrupt data for ${wellName}: timestamp ${timestampSource} is before 2020`);
      return; // Don't save corrupt data
    }

    // Validate flow rate - under 1 minute is almost certainly corrupt
    // Real wells take at least 2-3 minutes per inch at the fastest
    const MIN_VALID_FLOW_RATE_MINUTES = 1;
    let validFlowRate = flowRate;
    let validFlowRateMinutes = flowRateMinutes;
    if (flowRateMinutes !== undefined && flowRateMinutes > 0 && flowRateMinutes < MIN_VALID_FLOW_RATE_MINUTES) {
      console.log(`[WellHistory] Rejecting corrupt flow rate for ${wellName}: ${flowRateMinutes} minutes (${flowRate}) is too fast`);
      validFlowRate = undefined;
      validFlowRateMinutes = undefined;
    }

    // Check if we already have NEWER data - don't let old responses overwrite new ones!
    // NOTE: This comparison uses the PULL timestamp, not the current time.
    // This is intentional - we want the most recent PULL's level for accurate estimation.
    // EXCEPTION: forceUpdate=true skips this check (used for edits where we need to update
    // regardless of timestamp because the user is explicitly correcting data)
    const existingSnapshot = cachedSnapshots[wellName];
    if (!forceUpdate && existingSnapshot && existingSnapshot.timestamp > timestamp) {
      console.log(`[WellHistory] Skipping older response for ${wellName}: existing=${existingSnapshot.timestamp} > new=${timestamp}`);
      return; // Don't overwrite newer data with older data!
    }

    // If levelFeet is -1, keep the existing level but update isDown
    const finalLevel = levelFeet === -1 ? (existingSnapshot?.levelFeet ?? 0) : levelFeet;

    // Parse lastPullBottomLevel to feet for accurate estimation
    const lastPullBottomLevelFeet = parseFeetInchesToFeet(lastPullBottomLevel);

    cachedSnapshots[wellName] = {
      levelFeet: finalLevel,
      timestamp,
      responseTimestamp,
      isDown,
      lastPullDateTime: lastPullDateTime || existingSnapshot?.lastPullDateTime,
      lastPullDateTimeUTC: lastPullDateTimeUTC || existingSnapshot?.lastPullDateTimeUTC,
      lastPullBbls: lastPullBbls ?? existingSnapshot?.lastPullBbls,
      lastPullTopLevel: lastPullTopLevel || existingSnapshot?.lastPullTopLevel,
      lastPullBottomLevel: lastPullBottomLevel || existingSnapshot?.lastPullBottomLevel,
      lastPullBottomLevelFeet: lastPullBottomLevelFeet ?? existingSnapshot?.lastPullBottomLevelFeet,
      flowRate: validFlowRate || existingSnapshot?.flowRate,
      flowRateMinutes: validFlowRateMinutes ?? existingSnapshot?.flowRateMinutes,
      windowBblsDay: windowBblsDay ?? existingSnapshot?.windowBblsDay,
      overnightBblsDay: overnightBblsDay ?? existingSnapshot?.overnightBblsDay,
    };

    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(cachedSnapshots));
  } catch (error) {
    console.error("[WellHistory] Error saving snapshot:", error);
  }
}

export async function getLevelSnapshot(wellName: string): Promise<LevelSnapshot | null> {
  if (Object.keys(cachedSnapshots).length === 0) await loadLevelSnapshots();
  return cachedSnapshots[wellName] || null;
}

export function getLevelSnapshotSync(wellName: string): LevelSnapshot | null {
  return cachedSnapshots[wellName] || null;
}

// ========== PENDING PULL STORAGE ==========
// Used when record.tsx submits and goes back to index.tsx
// index.tsx picks up the pending pull to show animation + polling

export interface PendingPull {
  wellName: string;
  topLevel: number;        // Level before pull (feet)
  bblsTaken: number;       // Barrels pulled
  packetTimestamp: string; // For checking response file
  packetId?: string;       // For checking fallback response from Cloud Function
  timestamp: number;       // When submitted (for timer)
  wellDown?: boolean;      // If marking well as down
  isEdit?: boolean;        // If this is an edit (skip immediate response check)
}

export async function savePendingPull(
  wellName: string, 
  data: Omit<PendingPull, 'wellName'>
): Promise<void> {
  const key = PENDING_PULL_KEY + wellName.replace(/\s+/g, '_');
  const pending: PendingPull = { wellName, ...data };
  await AsyncStorage.setItem(key, JSON.stringify(pending));
}

export async function getPendingPull(wellName: string): Promise<PendingPull | null> {
  const key = PENDING_PULL_KEY + wellName.replace(/\s+/g, '_');
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingPull;
  } catch {
    return null;
  }
}

export async function clearPendingPull(wellName: string): Promise<void> {
  const key = PENDING_PULL_KEY + wellName.replace(/\s+/g, '_');
  await AsyncStorage.removeItem(key);
}

// Maximum age for a pending pull before we consider it stale (2 hours)
const STALE_PENDING_PULL_MS = 2 * 60 * 60 * 1000;

/**
 * Clear all pending pulls that are older than STALE_PENDING_PULL_MS
 * Call this on app startup to prevent stuck polling
 */
export async function cleanupStalePendingPulls(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const pendingKeys = allKeys.filter(k => k.startsWith(PENDING_PULL_KEY));

    const now = Date.now();
    let cleanedCount = 0;

    for (const key of pendingKeys) {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;

      try {
        const pending = JSON.parse(raw) as PendingPull;
        const age = now - pending.timestamp;

        if (age > STALE_PENDING_PULL_MS) {
          await AsyncStorage.removeItem(key);
          cleanedCount++;
        }
      } catch {
        // Invalid JSON, remove it
        await AsyncStorage.removeItem(key);
        cleanedCount++;
      }
    }
  } catch (error) {
    console.error('[WellHistory] Error cleaning up pending pulls:', error);
  }
}
