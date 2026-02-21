// src/services/firebaseStatus.ts
// Firebase connectivity status monitoring
// Provides global offline state for branded "System Offline" banner

import NetInfo from "@react-native-community/netinfo";
import { debugLog } from "./debugLog";
import { systemLog } from "./systemLog";

// Firebase database URL for connectivity check
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";
const FIREBASE_API_KEY = "AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI";

// Status change listeners
type StatusListener = (isOnline: boolean, reason?: string) => void;
const statusListeners = new Set<StatusListener>();

// Current status state
let currentStatus: {
  firebaseOnline: boolean;
  networkOnline: boolean;
  lastCheck: number;
  reason?: string;
  offlineSince: number | null; // When we first detected offline (for grace period)
  bannerShown: boolean; // Whether banner has been shown to user
} = {
  firebaseOnline: true, // Assume online until proven otherwise
  networkOnline: true,
  lastCheck: 0,
  offlineSince: null,
  bannerShown: false,
};

// Grace period timer
let graceTimerId: ReturnType<typeof setTimeout> | null = null;

// Minimum time between Firebase checks (10 seconds)
const MIN_CHECK_INTERVAL_MS = 10 * 1000;

// How long before we consider cached status stale (30 seconds)
const STATUS_STALE_MS = 30 * 1000;

// Grace period before showing offline banner (5 seconds)
// Prevents brief network blips from showing the banner
const OFFLINE_GRACE_PERIOD_MS = 5 * 1000;

/**
 * Check Firebase connectivity by pinging the database
 * Returns true if Firebase is reachable, false otherwise
 */
export async function checkFirebaseConnectivity(): Promise<boolean> {
  // Check network first
  const netState = await NetInfo.fetch();
  currentStatus.networkOnline = netState.isConnected === true && netState.isInternetReachable !== false;

  if (!currentStatus.networkOnline) {
    currentStatus.firebaseOnline = false;
    currentStatus.reason = "No network connection";
    currentStatus.lastCheck = Date.now();
    notifyListeners(false, currentStatus.reason);
    return false;
  }

  // Don't hammer Firebase - rate limit checks
  const timeSinceLastCheck = Date.now() - currentStatus.lastCheck;
  if (timeSinceLastCheck < MIN_CHECK_INTERVAL_MS) {
    return currentStatus.firebaseOnline;
  }

  try {
    // Use same URL format as main firebase.ts - check a lightweight path
    // The /status path should be readable without special auth rules
    const url = `${FIREBASE_DATABASE_URL}/status.json?auth=${FIREBASE_API_KEY}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // 200 = success, 401/403 = auth issue but Firebase IS reachable
    // Only consider actual network failures as "offline"
    const isReachable = response.status !== 0 && response.status < 500;

    currentStatus.firebaseOnline = isReachable;
    currentStatus.reason = isReachable ? undefined : `Firebase error: ${response.status}`;
    currentStatus.lastCheck = Date.now();

    // Log auth errors for debugging but don't show to user as "offline"
    if (response.status === 401 || response.status === 403) {
      debugLog(`[FirebaseStatus] Auth warning (${response.status}) but Firebase is reachable`, 'warn');
    }

    notifyListeners(currentStatus.firebaseOnline, currentStatus.reason);
    return currentStatus.firebaseOnline;
  } catch (error: any) {
    debugLog(`[FirebaseStatus] Connectivity check failed: ${error.message}`, 'warn');
    currentStatus.firebaseOnline = false;
    currentStatus.reason = error.name === "AbortError" ? "Connection timed out" : "Cannot reach WellBuilt server";
    currentStatus.lastCheck = Date.now();

    notifyListeners(false, currentStatus.reason);
    return false;
  }
}

/**
 * Get current Firebase status (cached)
 * Use checkFirebaseConnectivity() for fresh check
 */
export function getFirebaseStatus(): {
  isOnline: boolean;
  reason?: string;
  isStale: boolean;
} {
  const isStale = Date.now() - currentStatus.lastCheck > STATUS_STALE_MS;
  return {
    isOnline: currentStatus.firebaseOnline && currentStatus.networkOnline,
    reason: currentStatus.reason,
    isStale,
  };
}

/**
 * Subscribe to Firebase status changes
 * Returns unsubscribe function
 */
export function onFirebaseStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener);
  // Immediately notify of current status
  listener(currentStatus.firebaseOnline && currentStatus.networkOnline, currentStatus.reason);
  return () => statusListeners.delete(listener);
}

/**
 * Notify all listeners of status change
 * Uses grace period - only notifies offline after OFFLINE_GRACE_PERIOD_MS
 */
function notifyListeners(isOnline: boolean, reason?: string): void {
  if (isOnline) {
    // Coming back online - notify immediately
    if (graceTimerId) {
      clearTimeout(graceTimerId);
      graceTimerId = null;
    }

    if (currentStatus.offlineSince) {
      const offlineDuration = Date.now() - currentStatus.offlineSince;
      const durationSec = Math.round(offlineDuration / 1000);
      debugLog(`[FirebaseStatus] ONLINE restored after ${durationSec}s`, 'info');

      // Only log to Firebase if banner was shown (user-visible outage)
      if (currentStatus.bannerShown) {
        systemLog('Connection restored', 'info', `Was offline for ${durationSec}s`);
      }
    }

    currentStatus.offlineSince = null;
    currentStatus.bannerShown = false;
    statusListeners.forEach(listener => listener(true, undefined));
  } else {
    // Going offline - start grace period
    if (!currentStatus.offlineSince) {
      currentStatus.offlineSince = Date.now();
      debugLog(`[FirebaseStatus] Offline detected: ${reason}`, 'warn');
    }

    // Only notify listeners (show banner) after grace period
    if (!currentStatus.bannerShown && !graceTimerId) {
      graceTimerId = setTimeout(() => {
        graceTimerId = null;
        // Still offline after grace period?
        if (currentStatus.offlineSince && !currentStatus.firebaseOnline) {
          currentStatus.bannerShown = true;
          const offlineDuration = Math.round((Date.now() - currentStatus.offlineSince) / 1000);
          debugLog(`[FirebaseStatus] OFFLINE banner shown after ${offlineDuration}s grace period. Reason: ${reason}`, 'warn');

          // Log to Firebase for admin visibility
          systemLog('System offline', 'warn', reason || 'Unknown reason');

          statusListeners.forEach(listener => listener(false, reason));
        }
      }, OFFLINE_GRACE_PERIOD_MS);
    }
  }
}

// Network change listener
let unsubscribeNetInfo: (() => void) | null = null;

/**
 * Start monitoring Firebase status
 * Listens for network changes and checks Firebase connectivity
 */
export function startFirebaseStatusMonitor(): void {
  if (unsubscribeNetInfo) return; // Already monitoring

  debugLog("[FirebaseStatus] Starting monitor", 'info');

  // Initial check
  checkFirebaseConnectivity();

  // Listen for network changes
  unsubscribeNetInfo = NetInfo.addEventListener(async (state) => {
    const wasOnline = currentStatus.networkOnline;
    currentStatus.networkOnline = state.isConnected === true && state.isInternetReachable !== false;

    if (currentStatus.networkOnline && !wasOnline) {
      // Network restored - check Firebase
      debugLog("[FirebaseStatus] Network restored, checking Firebase...", 'info');
      await checkFirebaseConnectivity();
    } else if (!currentStatus.networkOnline) {
      // Network lost
      debugLog("[FirebaseStatus] Network lost", 'warn');
      currentStatus.firebaseOnline = false;
      currentStatus.reason = "No network connection";
      notifyListeners(false, currentStatus.reason);
    }
  });
}

/**
 * Stop monitoring Firebase status
 */
export function stopFirebaseStatusMonitor(): void {
  if (unsubscribeNetInfo) {
    unsubscribeNetInfo();
    unsubscribeNetInfo = null;
    debugLog("[FirebaseStatus] Monitor stopped", 'info');
  }
}

/**
 * Force a fresh Firebase status check
 * Use when you need to verify connectivity before an important operation
 */
export async function refreshFirebaseStatus(): Promise<boolean> {
  // Reset last check to force a fresh check
  currentStatus.lastCheck = 0;
  return await checkFirebaseConnectivity();
}
