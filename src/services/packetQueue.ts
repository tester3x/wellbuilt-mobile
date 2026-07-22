// src/services/packetQueue.ts
// Offline packet queue - stores packets when no network, sends when connection returns
//
// How it works:
// 1. When uploading a packet, check Firebase connectivity first
// 2. If offline, save to queue (AsyncStorage)
// 3. On app foreground or network restore, flush the queue
// 4. Packets are sent in order with retry logic

import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { uploadTankPacket, uploadEditPacket, mintPacketId } from "./firebase";
import { setPullSyncStatus } from "./pullHistory";

const QUEUE_STORAGE_KEY = "@wellbuilt_packet_queue";

// GS3 durability rules: a queued packet is NEVER silently discarded.
// After SYNC_FAILED_THRESHOLD failed attempts its Pull History entry is
// marked sync_failed (attention required) but the packet stays queued and
// keeps retrying on a capped backoff until it is confirmed sent or a
// future user-facing recovery action handles it intentionally.
export const SYNC_FAILED_THRESHOLD = 5;
const BACKOFF_BASE_MS = 30 * 1000;
const BACKOFF_CAP_MS = 30 * 60 * 1000;

export function computeBackoffMs(retryCount: number): number {
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, Math.max(0, retryCount - 1)), BACKOFF_CAP_MS);
}

export interface QueuedPacket {
  id: string;
  type: "pull" | "edit";
  data: any;
  createdAt: number;
  retryCount: number;
  /** Stable server identity for pulls — identical in data.packetId, Pull
   *  History, and Firebase. Null for edit packets (their identity is the
   *  original pull's id; see smartUploadEditPacket). */
  packetId?: string | null;
  firstQueuedAt?: number;
  lastAttemptAt?: number | null;
  nextAttemptAt?: number | null;
  lastError?: string | null;
}

/**
 * Get all queued packets. Migrates legacy entries in place, ONCE:
 * a pull entry without a stable packetId is assigned one (persisted
 * immediately, into both the entry and its payload) and never regenerated
 * on later loads/retries. Payloads, timestamps, retry metadata, and
 * ordering are preserved; nothing else in AsyncStorage is touched.
 */
export async function getQueuedPackets(): Promise<QueuedPacket[]> {
  try {
    const stored = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
    const queue: QueuedPacket[] = stored ? JSON.parse(stored) : [];
    let migrated = false;
    for (const p of queue) {
      if (p.type === "pull" && !p.packetId) {
        const id = p.data?.packetId || mintPacketId(p.data?.wellName || "Unknown");
        p.packetId = id;
        p.data = { ...(p.data || {}), packetId: id };
        migrated = true;
      }
      if (p.firstQueuedAt === undefined) { p.firstQueuedAt = p.createdAt; migrated = true; }
      if (p.retryCount === undefined) { p.retryCount = 0; migrated = true; }
    }
    if (migrated) {
      await saveQueue(queue);
      console.log("[PacketQueue] Migrated legacy queue entries to stable identity");
    }
    return queue;
  } catch {
    return [];
  }
}

// Save queue to storage
async function saveQueue(queue: QueuedPacket[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

// Add a packet to the queue
export async function queuePacket(
  type: "pull" | "edit",
  data: any
): Promise<string> {
  const queue = await getQueuedPackets();

  const id = `queued_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Pulls carry their stable identity in the payload; guarantee it here so
  // no queued pull can ever exist without one.
  let packetId: string | null = null;
  if (type === "pull") {
    packetId = data?.packetId || mintPacketId(data?.wellName || "Unknown");
    data = { ...(data || {}), packetId };
  }

  const now = Date.now();
  queue.push({
    id,
    type,
    data,
    createdAt: now,
    retryCount: 0,
    packetId,
    firstQueuedAt: now,
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastError: null,
  });

  await saveQueue(queue);
  console.log(`[PacketQueue] Queued ${type} packet:`, id, packetId ?? "");

  return id;
}

// Remove a packet from the queue (after CONFIRMED successful send).
// Re-reads storage so it composes safely with per-packet persistence.
async function removeFromQueue(id: string): Promise<void> {
  const stored = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
  const queue: QueuedPacket[] = stored ? JSON.parse(stored) : [];
  const filtered = queue.filter(p => p.id !== id);
  await saveQueue(filtered);
  console.log("[PacketQueue] Removed:", id);
}

// Persist updated retry metadata for ONE packet immediately (crash-safe:
// a crash later in the flush loop cannot lose this attempt's bookkeeping).
async function persistAttemptFailure(id: string, error: string, nowMs: number): Promise<void> {
  const stored = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
  const queue: QueuedPacket[] = stored ? JSON.parse(stored) : [];
  const entry = queue.find(p => p.id === id);
  if (!entry) return;
  entry.retryCount = (entry.retryCount || 0) + 1;
  entry.lastAttemptAt = nowMs;
  entry.nextAttemptAt = nowMs + computeBackoffMs(entry.retryCount);
  entry.lastError = error;
  await saveQueue(queue);
}

// Check if we have network connectivity
// Simple approach: if device has network, assume Firebase is reachable and try the upload.
// If upload fails, the smart upload functions catch the error and queue the packet.
// No need for a separate Firebase ping — just try it and handle failure gracefully.
export async function isOnline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    const online = state.isConnected === true && state.isInternetReachable !== false;
    console.log(`[PacketQueue] isOnline: ${online ? 'YES' : 'NO'} (type=${state.type}, connected=${state.isConnected}, reachable=${state.isInternetReachable})`);
    return online;
  } catch (err: any) {
    console.log(`[PacketQueue] isOnline: EXCEPTION ${err.message}`);
    return false;
  }
}

// Send a single queued packet. The payload carries its stable packetId, so
// a replay is idempotent — uploadTankPacket honors the supplied id and the
// server sees the SAME identity on every attempt.
async function sendQueuedPacket(packet: QueuedPacket): Promise<{ ok: boolean; error?: string }> {
  try {
    if (packet.type === "pull") {
      await uploadTankPacket(packet.data);
    } else if (packet.type === "edit") {
      await uploadEditPacket(packet.data);
    }
    return { ok: true };
  } catch (error: any) {
    console.log("[PacketQueue] Send failed:", packet.id, error);
    return { ok: false, error: String(error?.message || error || "unknown") };
  }
}

// Flush the queue - send all pending packets.
// Durability contract (GS3):
//  - offline flush exits BEFORE any attempt — it never consumes a retry;
//  - each success removes ONLY that packet and persists before the next;
//  - each failure persists its retry metadata immediately;
//  - packets are NEVER dropped for age or retry count — at
//    SYNC_FAILED_THRESHOLD the history entry is marked sync_failed and the
//    packet stays queued on capped backoff.
export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  const online = await isOnline();
  if (!online) {
    console.log("[PacketQueue] Still offline, skipping flush");
    return { sent: 0, failed: 0 };
  }

  const queue = await getQueuedPackets();
  if (queue.length === 0) {
    return { sent: 0, failed: 0 };
  }

  console.log(`[PacketQueue] Flushing ${queue.length} queued packets...`);

  let sent = 0;
  let failed = 0;
  let deferred = 0;
  const wellNames: string[] = [];

  // Process in order (oldest first)
  queue.sort((a, b) => (a.firstQueuedAt ?? a.createdAt) - (b.firstQueuedAt ?? b.createdAt));

  for (const packet of queue) {
    const nowMs = Date.now();
    if (packet.nextAttemptAt && packet.nextAttemptAt > nowMs) {
      deferred++;
      continue; // backing off — not an attempt, not a failure
    }

    const result = await sendQueuedPacket(packet);

    if (result.ok) {
      sent++;
      if (packet.data?.wellName) wellNames.push(packet.data.wellName);
      // Persist THIS removal before touching the next packet — a crash
      // here can neither resurrect this packet nor lose the removal.
      await removeFromQueue(packet.id);
      if (packet.type === "pull" && packet.packetId) {
        try { await setPullSyncStatus(packet.packetId, "sent", Date.now()); } catch {}
      }
      console.log("[PacketQueue] Sent:", packet.id, packet.packetId ?? "");
    } else {
      failed++;
      await persistAttemptFailure(packet.id, result.error || "unknown", nowMs);
      const attempts = (packet.retryCount || 0) + 1;
      if (attempts >= SYNC_FAILED_THRESHOLD && packet.type === "pull" && packet.packetId) {
        // Attention required — but the packet REMAINS queued and retrying.
        try { await setPullSyncStatus(packet.packetId, "sync_failed"); } catch {}
      }
    }
  }

  console.log(`[PacketQueue] Flush complete: ${sent} sent, ${failed} failed, ${deferred} deferred (backoff)`);

  // Notify listeners with flush results
  if (sent > 0) {
    const result: FlushResult = { sent, failed, wellNames: [...new Set(wellNames)] };
    for (const listener of _flushListeners) {
      try { listener(result); } catch {}
    }
  }

  return { sent, failed };
}

// Get queue count (for UI display)
export async function getQueueCount(): Promise<number> {
  const queue = await getQueuedPackets();
  return queue.length;
}

// Clear the queue (for testing/reset)
export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
  console.log("[PacketQueue] Queue cleared");
}

// ── Sync completion + connectivity listeners ──────────────────────────────

export interface FlushResult {
  sent: number;
  failed: number;
  wellNames: string[];
}

let _flushListeners: Array<(result: FlushResult) => void> = [];
let _connectivityListeners: Array<(online: boolean) => void> = [];
let _currentOnlineState = true;

/** Subscribe to flush completion events. Returns unsubscribe function. */
export function onFlushComplete(listener: (result: FlushResult) => void): () => void {
  _flushListeners.push(listener);
  return () => { _flushListeners = _flushListeners.filter(l => l !== listener); };
}

/** Subscribe to online/offline state changes. Returns unsubscribe function. */
export function onConnectivityChange(listener: (online: boolean) => void): () => void {
  _connectivityListeners.push(listener);
  return () => { _connectivityListeners = _connectivityListeners.filter(l => l !== listener); };
}

/** Get current connectivity state synchronously. */
export function isOnlineSync(): boolean {
  return _currentOnlineState;
}

// Subscribe to network changes and auto-flush when back online
let unsubscribeNetInfo: (() => void) | null = null;

export function startNetworkMonitor(): void {
  if (unsubscribeNetInfo) return; // Already monitoring

  // Listen for network state changes — flush queue when connection is restored
  unsubscribeNetInfo = NetInfo.addEventListener(async (state) => {
    const nowOnline = state.isConnected === true && state.isInternetReachable !== false;
    const wasOffline = !_currentOnlineState;

    if (_currentOnlineState !== nowOnline) {
      _currentOnlineState = nowOnline;
      console.log(`[PacketQueue] Connectivity: ${nowOnline ? 'ONLINE' : 'OFFLINE'}`);
      for (const listener of _connectivityListeners) {
        try { listener(nowOnline); } catch {}
      }
    }

    if (nowOnline && wasOffline) {
      console.log("[PacketQueue] Network restored, flushing queue...");
      await flushQueue();
    }
  });

  // Initial state check
  NetInfo.fetch().then((state) => {
    _currentOnlineState = state.isConnected === true && state.isInternetReachable !== false;
  });

  console.log("[PacketQueue] Network monitor started");
}

export function stopNetworkMonitor(): void {
  if (unsubscribeNetInfo) {
    unsubscribeNetInfo();
    unsubscribeNetInfo = null;
  }
  console.log("[PacketQueue] Network monitor stopped");
}

// --- Smart upload functions that queue when offline ---

export interface UploadResult {
  success: boolean;
  queued: boolean;
  packetId?: string;
  packetTimestamp?: string;
  wellName?: string;
  error?: string;
}

/**
 * Smart upload - sends immediately if online, queues if offline
 * Returns immediately with queued status if offline
 */
export async function smartUploadTankPacket(params: {
  /** Stable identity from mintPacketId — one id across upload, queue,
   *  replay, Pull History, and Firebase. Minted here if absent. */
  packetId?: string;
  wellName: string;
  dateTime: string;
  dateTimeUTC: string;
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown?: boolean;
  predictedLevelInches?: number; // What driver saw on pull form card - for performance tracking
}): Promise<UploadResult> {
  // Guarantee the stable identity BEFORE any branch, so online success,
  // failure-queue, and offline-queue all carry the exact same id.
  const stableParams = { ...params, packetId: params.packetId || mintPacketId(params.wellName) };
  const packetId = stableParams.packetId;
  const packetTimestamp = packetId.slice(0, 15);
  const online = await isOnline();

  if (online) {
    try {
      const result = await uploadTankPacket(stableParams);
      return {
        success: true,
        queued: false,
        packetId: result.packetId,
        packetTimestamp: result.packetTimestamp,
        wellName: result.wellName,
      };
    } catch (error: any) {
      // Network error during send - queue it (same identity; the eventual
      // replay is idempotent even if this PUT actually landed server-side)
      console.log(`[PacketQueue] Upload FAILED for ${params.wellName}: ${error.message} (${error.name})`);
      await queuePacket("pull", stableParams);
      return {
        success: false,
        queued: true,
        packetId,
        packetTimestamp,
        wellName: params.wellName,
        error: `Upload failed: ${error.message || error.name || 'unknown'}`,
      };
    }
  } else {
    // Offline - queue immediately
    await queuePacket("pull", stableParams);
    return {
      success: false,
      queued: true,
      packetId,
      packetTimestamp,
      wellName: params.wellName,
      error: "Queued for later (offline)",
    };
  }
}

/**
 * Smart edit upload - sends immediately if online, queues if offline
 */
export async function smartUploadEditPacket(params: {
  originalPacketTimestamp: string;
  originalPacketId: string;
  wellName: string;
  dateTime: string;
  dateTimeUTC: string;
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown: boolean;
}): Promise<UploadResult> {
  const online = await isOnline();

  if (online) {
    try {
      const result = await uploadEditPacket(params);
      return {
        success: true,
        queued: false,
        wellName: result.wellName,
      };
    } catch (error: any) {
      console.log(`[PacketQueue] Edit FAILED for ${params.wellName}: ${error.message} (${error.name})`);
      const queueId = await queuePacket("edit", params);
      return {
        success: false,
        queued: true,
        error: `Edit failed: ${error.message || error.name || 'unknown'}`,
      };
    }
  } else {
    const queueId = await queuePacket("edit", params);
    return {
      success: false,
      queued: true,
      error: "Queued for later (offline)",
    };
  }
}
