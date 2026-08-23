// src/services/backgroundSync.ts
// Background sync for Firebase responses
//
// NOW USING FIREBASE LISTENERS instead of polling!
// Instead of downloading ALL data every 5 seconds, we subscribe once
// and Firebase pushes only CHANGES to us. ~99% bandwidth reduction.

import { subscribeToOutgoing, unsubscribeAll, isListening, watchIncomingVersion } from "./firebaseListener";
import { saveLevelSnapshot, getLevelSnapshotSync, clearPendingPull } from "./wellHistory";
import {
  isDownLevelToken,
  parseLevelToFeet,
  resolveSnapshotLevelFeet,
} from "./downSnapshot";
import { createCoalescedRunner, VERSION_COMPLETION_RETRY_MS } from "./syncCoalesce";
import {
  loadAppliedIncomingVersion,
  markIncomingVersionApplied,
  peekAppliedIncomingVersion,
} from "./incomingVersion";

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
let versionRetryTimer: ReturnType<typeof setTimeout> | null = null;

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
  lastPullDriverId?: string; // Driver hash of who did the last pull
  lastPullDriverName?: string; // Driver name of who did the last pull
  lastPullPacketId?: string; // PacketId of the last pull (for pull history dedup)
}

// Parse feet/inches string to decimal feet (6' and 6'0" both valid; Down → 0)
const parseFeet = (raw: string): number => parseLevelToFeet(raw) ?? 0;

// Check if well is down
const isWellDown = (raw: string): boolean => isDownLevelToken(raw);

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

  const existing = getLevelSnapshotSync(packet.wellName);
  const levelFeet = resolveSnapshotLevelFeet({
    isDown: wellIsDown,
    currentLevel: packet.currentLevel,
    lastPullBottomLevel: packet.lastPullBottomLevel,
    previousLevelFeet: existing?.levelFeet,
    previousBottomFeet: existing?.lastPullBottomLevelFeet,
  });

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

  if (wellIsDown || levelFeet > 0) {
    await saveLevelSnapshot(packet.wellName, levelFeet, timestampForCalc, wellIsDown, packet.lastPullDateTime, lastPullBbls, packet.lastPullTopLevel, packet.lastPullBottomLevel, flowRate, flowRateMinutes, packet.lastPullDateTimeUTC, forceUpdate, windowBblsDay, overnightBblsDay);

    // Schedule alert based on flow rate from snapshot (active wells only)
    const snapshot = getLevelSnapshotSync(packet.wellName);
    if (!wellIsDown && snapshot && snapshot.flowRateMinutes && snapshot.flowRateMinutes > 0) {
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

  // Cross-app pull history: if this response's last pull was by the current driver
  // (e.g. from WB T), keep WB M Pull History in sync alongside the main-screen
  // snapshot. New pulls get added; EDIT responses (isEdit) reconcile an existing
  // entry by packetId — addPullToHistoryIfNew skips existing packetIds, so without
  // this an edit (e.g. WB T History edit) updated the main screen but left the Pull
  // History card stale (proof case 20260622_192528_Gab1_ivnuo2: main 150, history 160).
  if (packet.lastPullDriverId && packet.lastPullPacketId) {
    try {
      const { getDriverId } = await import("./driverAuth");
      const myDriverId = await getDriverId();
      if (myDriverId && packet.lastPullDriverId === myDriverId) {
        const { addPullToHistoryIfNew, updatePullHistoryEntryByPacketId } = await import("./pullHistory");
        const topFeet = parseFeet(packet.lastPullTopLevel || '');
        const packetTimestamp = packet.lastPullPacketId.match(/^(\d{8}_\d{6})/)?.[1] || '';

        if (forceUpdate) {
          // EDIT response — correct the existing entry in place (original pull
          // dateTime/sentAt preserved; only bbls/top/wellDown + edited status change).
          console.log("[pullHistory.updateFromResponseEdit.attempt]", packet.lastPullPacketId, "bbls=", lastPullBbls);
          const found = await updatePullHistoryEntryByPacketId(packet.lastPullPacketId, {
            bblsTaken: lastPullBbls,
            tankLevelFeet: topFeet,
            wellDown: wellIsDown,
          });
          if (found) {
            console.log("[pullHistory.updateFromResponseEdit.success]", packet.lastPullPacketId, "bbls=", lastPullBbls);
          } else {
            // Not in local history yet — add it carrying the current (edited) value.
            await addPullToHistoryIfNew(packet.wellName, packet.lastPullDateTime || '', topFeet, lastPullBbls || 0, wellIsDown, packetTimestamp, packet.lastPullPacketId);
          }
        } else {
          await addPullToHistoryIfNew(
            packet.wellName,
            packet.lastPullDateTime || '',
            topFeet,
            lastPullBbls || 0,
            false,
            packetTimestamp,
            packet.lastPullPacketId
          );
        }
      }
    } catch (err) {
      console.error("[BackgroundSync] Cross-app pull history error:", err);
    }
  } else if (packet.isEdit === true && !packet.lastPullPacketId) {
    console.warn("[pullHistory.updateFromResponseEdit.missingPacketId] wellName=", packet.wellName);
  }

  // Clear pending pull for this well - response has been processed
  // This ensures the main screen stops showing the drain animation and shows final data
  await clearPendingPull(packet.wellName);
}

/**
 * Main sync function - fetches all outgoing responses from Firebase
 * and updates local cache for each well
 */
const runOutgoingStatusSync = createCoalescedRunner(async (): Promise<number> => {
  isSyncing = true;
  notifyListeners(true);

  let count = 0;
  try {
    const { fetchDriverOutgoingStatus, fetchIncomingVersion } = await import('./firebase');
    const { markLevelUnavailable } = await import('./wellHistory');
    const result = await fetchDriverOutgoingStatus();
    if (!result) {
      console.log('[BackgroundSync] Outgoing status unavailable — keeping local cache');
    } else {
      for (const response of result.responses) {
        await processResponsePacket(response);
        count++;
      }
      for (const wellName of result.unavailableWells) {
        await markLevelUnavailable(wellName);
      }
      const version = await fetchIncomingVersion();
      if (version != null) {
        await markIncomingVersionApplied(version);
      }
    }
  } catch (error) {
    console.error("[BackgroundSync] Sync error:", error);
  }

  isSyncing = false;
  notifyListeners(false);
  justDidSync = true;
  return count;
});

export async function syncFromProcessedFolder(_retryCount: number = 0): Promise<number> {
  return runOutgoingStatusSync();
}

/** Foreground wake: one coalesced authenticated status fetch. */
export async function syncOnForeground(): Promise<number> {
  await loadAppliedIncomingVersion();
  return runOutgoingStatusSync();
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
function scheduleVersionCompletionRetry(): void {
  if (versionRetryTimer) return;
  const delay = VERSION_COMPLETION_RETRY_MS[0];
  versionRetryTimer = setTimeout(() => {
    versionRetryTimer = null;
    void runOutgoingStatusSync();
  }, delay);
  if (typeof (versionRetryTimer as NodeJS.Timeout).unref === 'function') {
    (versionRetryTimer as NodeJS.Timeout).unref();
  }
}

export function startBackgroundSync(): void {
  // Already listening? Don't create duplicate listeners. Foreground fetch
  // is a separate coalesced call — attaching must not skip that fetch.
  if (listenerUnsubscribe || isListening()) {
    console.log('[BackgroundSync] Already listening, skipping re-attach');
    return;
  }

  console.log('[BackgroundSync] Starting Firebase listeners');
  void loadAppliedIncomingVersion();

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

  // METHOD 2: Watch incoming_version. First snapshot after reattach compares
  // against the last successfully applied version — a missed increment syncs.
  versionUnsubscribe = watchIncomingVersion((version) => {
    console.log('[BackgroundSync] incoming_version changed - fetching updated responses', version);
    void runOutgoingStatusSync().then(() => {
      scheduleVersionCompletionRetry();
    });
  }, peekAppliedIncomingVersion);
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

  if (versionRetryTimer) {
    clearTimeout(versionRetryTimer);
    versionRetryTimer = null;
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
