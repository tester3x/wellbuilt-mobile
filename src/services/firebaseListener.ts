// src/services/firebaseListener.ts
// Firebase Realtime Database listeners - replaces polling with push-based updates
//
// Instead of polling every 5 seconds (downloading ALL data each time),
// we subscribe once and Firebase pushes only CHANGES to us.
// This reduces bandwidth by ~99%.

import {
  ref,
  query,
  orderByChild,
  equalTo,
  onValue,
  onChildChanged,
  onChildAdded,
  off,
  Database,
  Unsubscribe
} from 'firebase/database';
import { getFirebaseDatabase, waitForAuthUser } from './firebaseAuthSession';
import * as SecureStore from 'expo-secure-store';

void waitForAuthUser();

// Active listeners
const activeListeners: Map<string, Unsubscribe> = new Map();

// Callback type for response updates
export type ResponseUpdateCallback = (wellName: string, response: any) => void;

// Callback for waiting for a specific response (replaces 3-second polling)
export type PendingResponseCallback = (response: any) => void;

// Global callback registry
let onResponseUpdate: ResponseUpdateCallback | null = null;
let onInitialLoad: ((responses: Record<string, any>) => void) | null = null;

// Pending response watchers - keyed by response ID pattern
// When a response matching the pattern arrives, the callback is called and removed
const pendingResponseWatchers: Map<string, PendingResponseCallback> = new Map();

/**
 * Check if a response matches any pending watchers and notify them
 */
function checkPendingWatchers(key: string, data: any): void {
  for (const [pattern, callback] of pendingResponseWatchers) {
    if (key.includes(pattern)) {
      console.log('[FirebaseListener] Pending response arrived:', key);
      callback(data);
      pendingResponseWatchers.delete(pattern);
      return; // Only one watcher per pattern
    }
  }
}

/**
 * Initialize Firebase SDK (singleton)
 */


/**
 * Subscribe to ALL outgoing responses with a single listener
 * Firebase will push updates when ANY response changes
 *
 * This replaces the polling in backgroundSync.ts
 */
export function subscribeToOutgoing(
  onUpdate: ResponseUpdateCallback,
  onInitial?: (responses: Record<string, any>) => void
): () => void {
  const db = getFirebaseDatabase();
  let cancelled = false;
  let unsubscribeValue: Unsubscribe | null = null;
  let unsubscribeChildChanged: Unsubscribe | null = null;
  let unsubscribeChildAdded: Unsubscribe | null = null;

  // Store callbacks for internal use
  onResponseUpdate = onUpdate;
  onInitialLoad = onInitial || null;

  let initialLoadComplete = false;

  (async () => {
    const companyId = await SecureStore.getItemAsync('companyId');
    if (cancelled) return;
    if (!companyId) {
      console.error('[FirebaseListener] missing companyId — refusing unscoped outgoing list');
      return;
    }
    const outgoingRef = query(ref(db, 'packets/outgoing'), orderByChild('companyId'), equalTo(companyId));

  // Listen for the initial load and ALL changes
  // onValue fires once with current data, then again on any change
  unsubscribeValue = onValue(outgoingRef, (snapshot) => {
    const data = snapshot.val();

    if (!initialLoadComplete) {
      // First callback - initial load of all data
      initialLoadComplete = true;
      console.log('[FirebaseListener] Initial load complete');

      // Call onInitial with all data - let backgroundSync decide whether to process
      // Don't also call onUpdate for each item - that would cause double processing
      if (data && onInitial) {
        onInitial(data);
      }
    } else {
      // Subsequent callbacks - something changed
      // Firebase doesn't tell us WHAT changed with onValue,
      // so we'll use onChildChanged for granular updates
      console.log('[FirebaseListener] Data changed (via onValue)');
    }
  }, (error) => {
    console.error('[FirebaseListener] Error:', error);
  });

    unsubscribeChildChanged = onChildChanged(outgoingRef, (snapshot) => {
      const key = snapshot.key;
      const data = snapshot.val();

      if (key?.startsWith('response_') && data && data.wellName) {
        console.log('[FirebaseListener] Response updated:', data.wellName);
        checkPendingWatchers(key, data);
        checkWellWatchers(key, data);
        onUpdate(data.wellName, data);
      }
    });

    unsubscribeChildAdded = onChildAdded(outgoingRef, (snapshot) => {
      if (!initialLoadComplete) return;
      const key = snapshot.key;
      const data = snapshot.val();
      if (key?.startsWith('response_') && data && data.wellName) {
        console.log('[FirebaseListener] New response added:', data.wellName);
        checkPendingWatchers(key, data);
        checkWellWatchers(key, data);
        onUpdate(data.wellName, data);
      }
    });

    console.log('[FirebaseListener] Subscribed to packets/outgoing companyId=', companyId);
  })().catch((err) => {
    console.error('[FirebaseListener] Failed to subscribe with company query', err);
  });

  const listenerId = 'outgoing_main';
  activeListeners.set(listenerId, () => {
    cancelled = true;
    unsubscribeValue?.();
    unsubscribeChildChanged?.();
    unsubscribeChildAdded?.();
  });

  return () => {
    const unsub = activeListeners.get(listenerId);
    if (unsub) {
      unsub();
      activeListeners.delete(listenerId);
      console.log('[FirebaseListener] Unsubscribed from packets/outgoing');
    }
  };
}

/**
 * Subscribe to a specific well's responses only
 * Useful if you want per-well granular control
 */
export function subscribeToWell(
  wellName: string,
  onUpdate: (response: any) => void
): () => void {
  const db = getFirebaseDatabase();
  const wellNameClean = wellName.replace(/\s+/g, '');
  let cancelled = false;
  let unsubscribe: Unsubscribe | null = null;

  (async () => {
    const companyId = await SecureStore.getItemAsync('companyId');
    if (cancelled || !companyId) return;
    const outgoingRef = query(ref(db, 'packets/outgoing'), orderByChild('companyId'), equalTo(companyId));
    unsubscribe = onChildChanged(outgoingRef, (snapshot) => {
      const key = snapshot.key;
      const data = snapshot.val();
      if (key?.includes(wellNameClean) && data && data.wellName === wellName) {
        onUpdate(data);
      }
    });
  })().catch((err) => console.error('[FirebaseListener] subscribeToWell failed', err));

  const listenerId = `well_${wellNameClean}`;
  activeListeners.set(listenerId, () => {
    cancelled = true;
    unsubscribe?.();
  });

  return () => {
    const unsub = activeListeners.get(listenerId);
    if (unsub) {
      unsub();
      activeListeners.delete(listenerId);
    }
  };
}

/**
 * Unsubscribe from all active listeners
 * Call this when app goes to background
 */
export function unsubscribeAll(): void {
  console.log('[FirebaseListener] Unsubscribing from', activeListeners.size, 'listeners');

  for (const [id, unsub] of activeListeners) {
    unsub();
  }
  activeListeners.clear();

  onResponseUpdate = null;
  onInitialLoad = null;
}

/**
 * Check if we have active listeners
 */
export function isListening(): boolean {
  return activeListeners.size > 0;
}

/**
 * Get count of active listeners (for debugging)
 */
export function getListenerCount(): number {
  return activeListeners.size;
}

/**
 * Wait for a specific response to arrive via the Firebase listener
 * This replaces the 3-second polling loop after submitting a pull
 *
 * @param packetTimestamp - The timestamp from the submitted packet (used to build response ID)
 * @param wellName - The well name (used to build response ID)
 * @param timeoutMs - Maximum time to wait (default 60 seconds)
 * @returns Promise that resolves with the response or null on timeout
 */
export function waitForResponse(
  packetTimestamp: string,
  wellName: string,
  timeoutMs: number = 60000
): Promise<any | null> {
  const wellNameClean = wellName.replace(/\s+/g, '');
  // Response ID format: response_<timestamp>_<wellNameClean>
  const pattern = `response_${packetTimestamp}_${wellNameClean}`;

  return new Promise((resolve) => {
    // Set up timeout
    const timeoutId = setTimeout(() => {
      console.log('[FirebaseListener] Timeout waiting for response:', pattern);
      pendingResponseWatchers.delete(pattern);
      resolve(null);
    }, timeoutMs);

    // Register watcher
    pendingResponseWatchers.set(pattern, (response) => {
      clearTimeout(timeoutId);
      resolve(response);
    });

    console.log('[FirebaseListener] Waiting for response:', pattern);
  });
}

/**
 * Cancel waiting for a specific response
 * Call this if user navigates away or cancels
 * Idempotent - only logs if watcher actually existed
 */
export function cancelWaitForResponse(packetTimestamp: string, wellName: string): void {
  const wellNameClean = wellName.replace(/\s+/g, '');
  const pattern = `response_${packetTimestamp}_${wellNameClean}`;
  // Only log if we actually had a watcher to cancel
  if (pendingResponseWatchers.has(pattern)) {
    pendingResponseWatchers.delete(pattern);
    console.log('[FirebaseListener] Cancelled wait for:', pattern);
  }
}

// Well response change watchers - for edits where we watch any change to a well's response
const wellResponseWatchers: Map<string, PendingResponseCallback> = new Map();

/**
 * Check if a changed response matches any well-based watchers
 * Used for edit responses where we don't know the exact timestamp
 */
function checkWellWatchers(key: string, data: any): void {
  if (!data?.wellName) return;

  const wellNameClean = data.wellName.replace(/\s+/g, '');
  const watcherKey = `well_${wellNameClean}`;

  const callback = wellResponseWatchers.get(watcherKey);
  if (callback) {
    console.log('[FirebaseListener] Well response changed:', data.wellName);
    callback(data);
    wellResponseWatchers.delete(watcherKey);
  }
}

/**
 * Wait for ANY change to a well's response (not a specific timestamp)
 * Used for edit packets where the Cloud Function updates the existing response in place.
 *
 * @param wellName - The well name to watch
 * @param timeoutMs - Maximum time to wait (default 30 seconds)
 * @returns Promise that resolves with the response or null on timeout
 */
export function waitForWellResponseChange(
  wellName: string,
  timeoutMs: number = 30000
): Promise<any | null> {
  const wellNameClean = wellName.replace(/\s+/g, '');
  const watcherKey = `well_${wellNameClean}`;

  return new Promise((resolve) => {
    // Set up timeout
    const timeoutId = setTimeout(() => {
      console.log('[FirebaseListener] Timeout waiting for well response:', wellName);
      wellResponseWatchers.delete(watcherKey);
      resolve(null);
    }, timeoutMs);

    // Register watcher
    wellResponseWatchers.set(watcherKey, (response) => {
      clearTimeout(timeoutId);
      resolve(response);
    });

    console.log('[FirebaseListener] Waiting for any response change for:', wellName);
  });
}

/**
 * Cancel waiting for a well's response change
 * Call this if user navigates away or cancels
 */
export function cancelWaitForWellResponseChange(wellName: string): void {
  const wellNameClean = wellName.replace(/\s+/g, '');
  const watcherKey = `well_${wellNameClean}`;
  if (wellResponseWatchers.has(watcherKey)) {
    wellResponseWatchers.delete(watcherKey);
    console.log('[FirebaseListener] Cancelled wait for well:', wellName);
  }
}

/**
 * Watch incoming_version for changes - just like Excel does
 * When it changes, the callback is fired so app can fetch updated responses
 */
export function watchIncomingVersion(onChange: () => void): () => void {
  const db = getFirebaseDatabase();
  const versionRef = ref(db, 'packets/incoming_version');

  let lastVersion: number | null = null;
  // Use unique ID to allow multiple watchers without conflicts
  const listenerId = `incoming_version_${Date.now()}`;

  console.log('[FirebaseListener] Setting up incoming_version watcher:', listenerId);

  const unsubscribe = onValue(versionRef, (snapshot) => {
    const currentVersion = snapshot.val();
    console.log('[FirebaseListener] onValue fired - current:', currentVersion, 'last:', lastVersion);

    if (lastVersion !== null && currentVersion !== lastVersion) {
      console.log('[FirebaseListener] incoming_version changed:', lastVersion, '->', currentVersion);
      onChange();
    }

    lastVersion = currentVersion;
  }, (error) => {
    console.error('[FirebaseListener] Error watching incoming_version:', error);
  });

  activeListeners.set(listenerId, unsubscribe);

  console.log('[FirebaseListener] Watching incoming_version');

  return () => {
    unsubscribe();
    activeListeners.delete(listenerId);
    console.log('[FirebaseListener] Stopped watching incoming_version:', listenerId);
  };
}
