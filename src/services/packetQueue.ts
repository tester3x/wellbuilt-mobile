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
import { uploadTankPacket, uploadEditPacket } from "./firebase";

const QUEUE_STORAGE_KEY = "@wellbuilt_packet_queue";

export interface QueuedPacket {
  id: string;
  type: "pull" | "edit";
  data: any;
  createdAt: number;
  retryCount: number;
}

// Get all queued packets
export async function getQueuedPackets(): Promise<QueuedPacket[]> {
  try {
    const stored = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
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

  queue.push({
    id,
    type,
    data,
    createdAt: Date.now(),
    retryCount: 0,
  });

  await saveQueue(queue);
  console.log(`[PacketQueue] Queued ${type} packet:`, id);

  return id;
}

// Remove a packet from the queue (after successful send)
async function removeFromQueue(id: string): Promise<void> {
  const queue = await getQueuedPackets();
  const filtered = queue.filter(p => p.id !== id);
  await saveQueue(filtered);
  console.log("[PacketQueue] Removed:", id);
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

// Send a single queued packet
async function sendQueuedPacket(packet: QueuedPacket): Promise<boolean> {
  try {
    if (packet.type === "pull") {
      await uploadTankPacket(packet.data);
    } else if (packet.type === "edit") {
      await uploadEditPacket(packet.data);
    }
    return true;
  } catch (error) {
    console.log("[PacketQueue] Send failed:", packet.id, error);
    return false;
  }
}

// Flush the queue - send all pending packets
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
  const wellNames: string[] = [];
  const stillQueued: QueuedPacket[] = [];

  // Process in order (oldest first)
  queue.sort((a, b) => a.createdAt - b.createdAt);

  for (const packet of queue) {
    const success = await sendQueuedPacket(packet);

    if (success) {
      sent++;
      if (packet.data?.wellName) wellNames.push(packet.data.wellName);
      console.log("[PacketQueue] Sent:", packet.id);
    } else {
      failed++;
      packet.retryCount++;

      // Keep retrying up to 5 times, or for 24 hours
      const age = Date.now() - packet.createdAt;
      if (packet.retryCount < 5 && age < 24 * 60 * 60 * 1000) {
        stillQueued.push(packet);
      } else {
        console.log("[PacketQueue] Giving up on:", packet.id);
      }
    }
  }

  await saveQueue(stillQueued);

  console.log(`[PacketQueue] Flush complete: ${sent} sent, ${failed} failed, ${stillQueued.length} still queued`);

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
  wellName: string;
  dateTime: string;
  dateTimeUTC: string;
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown?: boolean;
  predictedLevelInches?: number; // What driver saw on pull form card - for performance tracking
}): Promise<UploadResult> {
  const online = await isOnline();

  if (online) {
    try {
      const result = await uploadTankPacket(params);
      return {
        success: true,
        queued: false,
        packetId: result.packetId,
        packetTimestamp: result.packetTimestamp,
        wellName: result.wellName,
      };
    } catch (error: any) {
      // Network error during send - queue it
      console.log(`[PacketQueue] Upload FAILED for ${params.wellName}: ${error.message} (${error.name})`);
      const queueId = await queuePacket("pull", params);
      return {
        success: false,
        queued: true,
        error: `Upload failed: ${error.message || error.name || 'unknown'}`,
      };
    }
  } else {
    // Offline - queue immediately
    const queueId = await queuePacket("pull", params);
    return {
      success: false,
      queued: true,
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
