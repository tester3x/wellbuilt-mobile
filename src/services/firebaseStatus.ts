// src/services/firebaseStatus.ts
// Firebase connectivity status monitoring
// Provides global offline state for branded "System Offline" banner

import NetInfo from "@react-native-community/netinfo";
import {
  ConnectionDiagnosis,
  ConnectionKind,
  diagnoseHttpStatus,
  diagnoseNetInfo,
  diagnoseThrown,
  formatDiagnosis,
} from "./connectionDiagnosis";
import { debugLog } from "./debugLog";
import { systemLog } from "./systemLog";

// Firebase database URL for connectivity check (no API-key auth)
const FIREBASE_DATABASE_URL = "https://wellbuilt-sync-default-rtdb.firebaseio.com";

// Status change listeners
type StatusListener = (isOnline: boolean, reason?: string, kind?: ConnectionKind) => void;
const statusListeners = new Set<StatusListener>();

// Current status state
let currentStatus: {
  firebaseOnline: boolean;
  networkOnline: boolean;
  lastCheck: number;
  reason?: string;
  kind: ConnectionKind;
  code?: string;
  offlineSince: number | null; // When we first detected offline (for grace period)
  bannerShown: boolean; // Whether banner has been shown to user
} = {
  firebaseOnline: true, // Assume online until proven otherwise
  networkOnline: true,
  lastCheck: 0,
  kind: 'ok',
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
function applyDiagnosis(online: boolean, d: ConnectionDiagnosis, userReason?: string): void {
  currentStatus.kind = d.kind;
  currentStatus.code = d.code;
  currentStatus.reason = userReason ?? (online ? undefined : formatDiagnosis(d));
  currentStatus.lastCheck = Date.now();
}

export async function checkFirebaseConnectivity(): Promise<boolean> {
  // Check network first
  const netState = await NetInfo.fetch();
  const netDiag = diagnoseNetInfo(netState);
  currentStatus.networkOnline = netDiag == null;

  if (netDiag) {
    currentStatus.firebaseOnline = false;
    applyDiagnosis(false, netDiag, netDiag.code === 'netinfo_disconnected'
      ? 'No network connection'
      : 'Internet not reachable');
    notifyListeners(false, currentStatus.reason, netDiag.kind);
    return false;
  }

  // Don't hammer Firebase - rate limit checks
  const timeSinceLastCheck = Date.now() - currentStatus.lastCheck;
  if (timeSinceLastCheck < MIN_CHECK_INTERVAL_MS) {
    return currentStatus.firebaseOnline;
  }

  let sessionDiagnosis: ConnectionDiagnosis | null = null;
  try {
    // Real reachability ping — never throw-as-offline, never use the API key as RTDB auth.
    // .info/connected answers without data-path rules. 401/403 still means the host is up.
    let url = `${FIREBASE_DATABASE_URL}/.info/connected.json`;
    try {
      const { getValidIdToken } = await import("./firebaseAuthSession");
      const token = await getValidIdToken();
      url += `?auth=${encodeURIComponent(token)}`;
    } catch (err) {
      sessionDiagnosis = diagnoseThrown(err);
      // No session is not a host outage — still ping unauthenticated.
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401 || response.status === 403) {
      const httpDiag = diagnoseHttpStatus(response.status);
      // Host is reachable. Surface auth/permission — do NOT label as offline.
      currentStatus.firebaseOnline = true;
      currentStatus.networkOnline = true;
      applyDiagnosis(true, sessionDiagnosis ?? httpDiag);
      debugLog(`[FirebaseStatus] ${formatDiagnosis(sessionDiagnosis ?? httpDiag)} (host reachable)`, 'warn');
      notifyListeners(true, currentStatus.reason, (sessionDiagnosis ?? httpDiag).kind);
      return true;
    }

    const isReachable = response.status !== 0 && response.status < 500;
    currentStatus.firebaseOnline = isReachable;
    if (isReachable) {
      // Session missing/expired with a live host: report auth, stay "online"
      // for transport but expose the kind so login/sync UI can distinguish.
      if (sessionDiagnosis && sessionDiagnosis.kind === 'auth_session') {
        applyDiagnosis(true, sessionDiagnosis);
        notifyListeners(true, currentStatus.reason, sessionDiagnosis.kind);
        return true;
      }
      applyDiagnosis(true, { kind: 'ok', code: 'ok', retryable: false });
      notifyListeners(true, undefined, 'ok');
      return true;
    }
    const httpDiag = diagnoseHttpStatus(response.status);
    applyDiagnosis(false, httpDiag, `Firebase error: ${response.status}`);
    notifyListeners(false, currentStatus.reason, httpDiag.kind);
    return false;
  } catch (error: any) {
    const d = diagnoseThrown(error);
    debugLog(`[FirebaseStatus] Connectivity check failed: ${formatDiagnosis(d)}`, 'warn');
    currentStatus.firebaseOnline = false;
    applyDiagnosis(false, d, d.kind === 'timeout' ? 'Connection timed out' : 'Cannot reach WellBuilt server');
    notifyListeners(false, currentStatus.reason, d.kind);
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
  kind: ConnectionKind;
  code?: string;
} {
  const isStale = Date.now() - currentStatus.lastCheck > STATUS_STALE_MS;
  const transportOnline = currentStatus.firebaseOnline && currentStatus.networkOnline;
  return {
    isOnline: transportOnline,
    reason: currentStatus.reason,
    isStale,
    kind: currentStatus.kind,
    code: currentStatus.code,
  };
}

/**
 * Subscribe to Firebase status changes
 * Returns unsubscribe function
 */
export function onFirebaseStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener);
  // Immediately notify of current status
  listener(
    currentStatus.firebaseOnline && currentStatus.networkOnline,
    currentStatus.reason,
    currentStatus.kind,
  );
  return () => statusListeners.delete(listener);
}

/**
 * Notify all listeners of status change
 * Uses grace period - only notifies offline after OFFLINE_GRACE_PERIOD_MS
 */
function notifyListeners(isOnline: boolean, reason?: string, kind: ConnectionKind = currentStatus.kind): void {
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
    const keepKind = kind === 'auth_session' || kind === 'permission';
    if (!keepKind) {
      currentStatus.kind = 'ok';
      currentStatus.code = 'ok';
    }
    statusListeners.forEach(listener => listener(true, keepKind ? reason : undefined, keepKind ? kind : 'ok'));
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

          statusListeners.forEach(listener => listener(false, reason, kind));
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
      applyDiagnosis(false, { kind: 'no_network', code: 'netinfo_disconnected', retryable: true }, 'No network connection');
      notifyListeners(false, currentStatus.reason, 'no_network');
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
