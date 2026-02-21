// src/services/backgroundSync.ts
// Background sync for Firebase responses
//
// NOW USING FIREBASE LISTENERS instead of polling!
// Instead of downloading ALL data every 5 seconds, we subscribe once
// and Firebase pushes only CHANGES to us. ~99% bandwidth reduction.

import { fetchAllOutgoingResponses } from "./firebase";
import { subscribeToOutgoing, unsubscribeAll, isListening, watchIncomingVersion } from "./firebaseListener";
import { saveLevelSnapshot, getLevelSnapshotSync, clearPendingPull } from "./wellHistory";

// Lazy import to avoid expo-notifications warning in Expo Go
// Notifications only work in development builds anyway
let scheduleWellAlert: typeof import("./wellAlerts").scheduleWellAlert | null = null;

const loadWellAlerts = async () => {
  if (scheduleWellAlert === null) {
    try {
      const module = await import("./wellAlerts");
      scheduleWellAlert = module.scheduleWellAlert;
    } catch (e) {
      console.log("[BackgroundSync] Well alerts not available");
    }
  }
  return scheduleWellAlert;
};

// REMOVED: const SYNC_INTERVAL_MS = 5000; // No more polling!

let syncTimer: ReturnType<typeof setInterval> | null = null; // Keep for legacy, but unused
let isSyncing = false;
let listenerUnsubscribe: (() => void) | null = null;
let versionUnsubscribe: (() => void) | null = null; // For incoming_version watcher
let justDidSync = false; // Skip initial load if we just synced via REST

// Sync status listeners - UI can subscribe to know when sync is happening
type SyncStatusListener = (syncing: boolean) => void;
const syncListeners = new Set<SyncStatusListener>();

const notifyListeners = (syncing: boolean) => {
  syncListeners.forEach(listener => listener(syncing));
};

/**
 * Subscribe to sync status changes
 * Returns unsubscribe function
 */
export function onSyncStatusChange(listener: SyncStatusListener): () => void {
  syncListeners.add(listener);
  // Immediately notify of current state
  listener(isSyncing);
  return () => syncListeners.delete(listener);
}

/**
 * Check if currently syncing (one-time check)
 */
export function getIsSyncing(): boolean {
  return isSyncing;
}

interface ResponsePacket {
  wellName: string;
  currentLevel: string;
  flowRate: string;
  timeTillPull: string;
  nextPullTime: string;
  bbls24hrs: string;
  status: string;
  timestamp: string;
  timestampUTC?: string;  // ISO 8601 UTC timestamp for calculations
  wellDown?: boolean;
  lastPullDateTime?: string;
  lastPullDateTimeUTC?: string;
  lastPullBbls?: string;
  lastPullTopLevel?: string;
  lastPullBottomLevel?: string;
  isEdit?: boolean;  // True if this response is from an edit packet
  originalPacketId?: string;  // The packet that was edited
  windowBblsDay?: string;    // Window-averaged bbls/day from Cloud Function
  overnightBblsDay?: string; // Longest-gap bbls/day from Cloud Function
}

// Parse feet/inches string to decimal feet
const parseFeet = (raw: string): number => {
  if (!raw || raw.toLowerCase() === "down" || raw === "N/A") return 0;
  const match = raw.match(/^(\d+)\s*'\s*(\d+)"?$/);
  if (match) {
    return Number(match[1]) + Number(match[2]) / 12;
  }
  return 0;
};

// Check if well is down
const isWellDown = (raw: string): boolean => {
  const str = (raw ?? "").trim().toLowerCase();
  return str === "down" || str === "offline" || str === "shut in";
};

// Parse flow rate string (H:MM:SS) to minutes
const parseFlowRateToMinutes = (flowRate: string): number => {
  if (!flowRate || flowRate === "N/A" || flowRate === "Down" || flowRate === "Unknown") return 0;
  const parts = flowRate.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 60 + parts[1] + parts[2] / 60;
  }
  return 0;
};

/**
 * Process a response packet and update local cache
 * This is called by firebase.ts when a response is received
 *
 * Flow rate is now stored WITH the level snapshot (not separately in AsyncStorage)
 * This ensures level and flow rate are always in sync and prevents stale flow rate issues.
 */
export async function processResponsePacket(packet: ResponsePacket): Promise<void> {
  if (!packet || !packet.wellName) return;

  // VALIDATION: Reject packets with obviously corrupt timestamps (Excel epoch errors)
  // Timestamps before 2020 are likely Excel epoch errors (1899/1900)
  const timestampForCalc = packet.timestampUTC || packet.timestamp;
  if (timestampForCalc) {
    const parsed = new Date(timestampForCalc);
    const minValidTimestamp = new Date('2020-01-01').getTime();
    if (!isNaN(parsed.getTime()) && parsed.getTime() < minValidTimestamp) {
      console.log(`[BackgroundSync] Rejecting corrupt packet for ${packet.wellName}: timestamp ${timestampForCalc} is before 2020`);
      return; // Don't process corrupt data
    }
  }

  // Check if well is down
  const wellIsDown = packet.wellDown === true || isWellDown(packet.currentLevel);

  // Parse lastPullBbls
  const lastPullBbls = packet.lastPullBbls ? parseFloat(packet.lastPullBbls) : undefined;

  // Parse level
  const levelFeet = parseFeet(packet.currentLevel);

  // Parse flow rate - stored with snapshot so they stay in sync
  let flowRate: string | undefined;
  let flowRateMinutes: number | undefined;
  if (packet.flowRate && packet.flowRate !== "N/A" && packet.flowRate !== "Down" && packet.flowRate !== "Unknown") {
    flowRate = packet.flowRate;
    flowRateMinutes = parseFlowRateToMinutes(packet.flowRate);
  }

  // Parse bbls/day values from Cloud Function
  const windowBblsDay = packet.windowBblsDay ? parseInt(packet.windowBblsDay, 10) : undefined;
  const overnightBblsDay = packet.overnightBblsDay ? parseInt(packet.overnightBblsDay, 10) : undefined;

  // For edit packets, force update to bypass timestamp comparison
  // (edits may have older timestamps but we still want to show the corrected data)
  const forceUpdate = packet.isEdit === true;

  if (wellIsDown) {
    await saveLevelSnapshot(packet.wellName, levelFeet, timestampForCalc, true, packet.lastPullDateTime, lastPullBbls, packet.lastPullTopLevel, packet.lastPullBottomLevel, flowRate, flowRateMinutes, packet.lastPullDateTimeUTC, forceUpdate, windowBblsDay, overnightBblsDay);
  } else if (levelFeet > 0) {
    await saveLevelSnapshot(packet.wellName, levelFeet, timestampForCalc, false, packet.lastPullDateTime, lastPullBbls, packet.lastPullTopLevel, packet.lastPullBottomLevel, flowRate, flowRateMinutes, packet.lastPullDateTimeUTC, forceUpdate, windowBblsDay, overnightBblsDay);

    // Schedule alert based on flow rate from snapshot
    const snapshot = getLevelSnapshotSync(packet.wellName);
    if (snapshot && snapshot.flowRateMinutes && snapshot.flowRateMinutes > 0) {
      let snapshotTimestamp = Date.now();
      // Prefer timestampUTC (ISO 8601) for accurate parsing
      const tsParse = packet.timestampUTC || packet.timestamp;
      if (tsParse) {
        const parsed = new Date(tsParse);
        if (!isNaN(parsed.getTime())) {
          snapshotTimestamp = parsed.getTime();
        }
      }

      const alertFn = await loadWellAlerts();
      if (alertFn) {
        await alertFn(
          packet.wellName,
          levelFeet,
          snapshot.flowRateMinutes,
          snapshotTimestamp,
          false
        );
      }
    }
  }

  // Clear pending pull for this well - response has been processed
  // This ensures the main screen stops showing the drain animation and shows final data
  await clearPendingPull(packet.wellName);
}

/**
 * Main sync function - fetches all outgoing responses from Firebase
 * and updates local cache for each well
 */
export async function syncFromProcessedFolder(retryCount: number = 0): Promise<number> {
  if (isSyncing) {
    // A sync is already running - retry after it finishes instead of silently dropping
    // This prevents missed updates when version watcher fires during an active sync
    // Cap retries to prevent infinite recursion
    if (retryCount >= 3) {
      console.log('[BackgroundSync] Max retries reached, skipping sync');
      return 0;
    }
    console.log('[BackgroundSync] Sync already in progress, will retry in 2s (attempt', retryCount + 1, ')');
    return new Promise((resolve) => {
      setTimeout(async () => {
        resolve(await syncFromProcessedFolder(retryCount + 1));
      }, 2000);
    });
  }

  isSyncing = true;
  notifyListeners(true);

  let count = 0;
  try {
    const responses = await fetchAllOutgoingResponses();

    for (const response of responses) {
      await processResponsePacket(response);
      count++;
    }
  } catch (error) {
    console.error("[BackgroundSync] Sync error:", error);
  }

  isSyncing = false;
  notifyListeners(false);

  // Mark that we just synced - listener's initial load can skip re-processing
  justDidSync = true;

  return count;
}

/**
 * Start background sync using Firebase listeners (call on app open/foreground)
 *
 * Uses TWO mechanisms for reliability:
 * 1. Firebase SDK listeners on outgoing/ (real-time push when working)
 * 2. incoming_version watcher (like Excel does) - when version changes, fetch all responses
 *
 * The version watcher is more reliable on mobile where WebSocket connections can drop.
 */
export function startBackgroundSync(): void {
  // Already listening? Don't create duplicate listeners
  if (listenerUnsubscribe || isListening()) {
    console.log('[BackgroundSync] Already listening, skipping');
    return;
  }

  console.log('[BackgroundSync] Starting Firebase listeners');

  // METHOD 1: Subscribe to outgoing responses directly
  // Firebase will call our callback whenever data changes (if WebSocket is connected)
  listenerUnsubscribe = subscribeToOutgoing(
    // onUpdate - called for each response that changes
    async (wellName: string, response: any) => {
      console.log('[BackgroundSync] Response updated via listener:', wellName);
      notifyListeners(true);  // Signal sync starting
      await processResponsePacket(response);
      notifyListeners(false); // Signal sync complete - triggers UI refresh
    },
    // onInitial - called once with all current data
    async (allResponses: Record<string, any>) => {
      // Skip if we just did a REST sync (cold start) - data is already processed
      if (justDidSync) {
        console.log('[BackgroundSync] Skipping initial load - just synced via REST');
        justDidSync = false; // Reset for next time
        return;
      }

      console.log('[BackgroundSync] Initial load from listener, processing', Object.keys(allResponses).length, 'responses');
      isSyncing = true;
      notifyListeners(true);

      for (const key of Object.keys(allResponses)) {
        if (key.startsWith('response_')) {
          await processResponsePacket(allResponses[key]);
        }
      }

      isSyncing = false;
      notifyListeners(false);
    }
  );

  // METHOD 2: Watch incoming_version (like Excel does)
  // This is more reliable - when Cloud Functions process a packet, they increment this version
  // When it changes, we do a fresh REST fetch of all responses
  versionUnsubscribe = watchIncomingVersion(async () => {
    console.log('[BackgroundSync] incoming_version changed - fetching updated responses');
    await syncFromProcessedFolder();
  });
}

/**
 * Stop background sync (call on app background/close)
 * Unsubscribes from Firebase listeners
 */
export function stopBackgroundSync(): void {
  // Clean up old polling timer if it exists (legacy)
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }

  // Unsubscribe from Firebase listeners
  if (listenerUnsubscribe) {
    listenerUnsubscribe();
    listenerUnsubscribe = null;
    console.log('[BackgroundSync] Stopped outgoing listener');
  }

  // Unsubscribe from version watcher
  if (versionUnsubscribe) {
    versionUnsubscribe();
    versionUnsubscribe = null;
    console.log('[BackgroundSync] Stopped version watcher');
  }

  // Also call unsubscribeAll to clean up any other listeners
  unsubscribeAll();
}

/**
 * Manual refresh - force sync now
 */
export async function manualRefresh(): Promise<number> {
  return await syncFromProcessedFolder();
}

/**
 * Check if sync is currently running (listener is active)
 */
export function isSyncRunning(): boolean {
  return listenerUnsubscribe !== null || isListening();
}
