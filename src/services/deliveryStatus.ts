// src/services/deliveryStatus.ts
// Truthful delivery reconciliation + attention counts (GS3).
//
// A successful uploadTankPacket() PUT only proves the packet reached
// packets/incoming ("submitted") — the GS3 stale guard consumed five
// successfully-uploaded packets without a trace. Ground truth lives at:
//   packets/processed/<packetId>  → processed successfully  → 'sent'
//   packets/rejected/<packetId>   → quarantined             → 'rejected'
// Both paths are world-readable under the current RTDB rules, so the app
// reconciles them directly by the STABLE packet id. Rejected packets are
// evidence: their reason is preserved and they are never auto-retried.

import { QueuedPacket, SYNC_FAILED_THRESHOLD, getQueuedPackets, onFlushComplete } from './packetQueue';
import { PullHistoryEntry, getPullHistory, setPullSyncStatus } from './pullHistory';

const FIREBASE_DATABASE_URL = 'https://wellbuilt-sync-default-rtdb.firebaseio.com';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';

/** A packet stuck in 'submitted' longer than this needs attention — the
 *  server normally answers in seconds. It stays preserved either way. */
export const SUBMITTED_ATTENTION_MS = 15 * 60 * 1000;

/** Cap per reconcile pass so a big backlog can't hammer the network. */
const RECONCILE_BATCH_LIMIT = 25;

async function readPath(path: string, fetchFn: typeof fetch): Promise<any | null> {
  try {
    const res = await fetchFn(`${FIREBASE_DATABASE_URL}/${path}.json?auth=${FIREBASE_API_KEY}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body ?? null;
  } catch {
    return null; // offline/transient — try again next pass
  }
}

/**
 * Reconcile every 'submitted' history entry against the server outcome.
 * processed/<id> exists → 'sent' (confirmed time from processedAt when
 * available); else rejected/<id> exists → 'rejected' with the exact stable
 * reason code + readable text; else it stays 'submitted' (the badge flags
 * it after SUBMITTED_ATTENTION_MS). Never deletes anything.
 */
export async function reconcileSubmittedPulls(
  fetchFn: typeof fetch = fetch,
): Promise<{ confirmedSent: number; confirmedRejected: number; stillUnknown: number }> {
  const history = await getPullHistory();
  const submitted = history.filter(e => e.syncStatus === 'submitted').slice(0, RECONCILE_BATCH_LIMIT);
  let confirmedSent = 0;
  let confirmedRejected = 0;
  let stillUnknown = 0;

  for (const entry of submitted) {
    const processed = await readPath(`packets/processed/${entry.packetId}`, fetchFn);
    if (processed) {
      const at = processed.processedAt ? new Date(processed.processedAt).getTime() : Date.now();
      await setPullSyncStatus(entry.packetId, 'sent', { sentConfirmedAt: Number.isFinite(at) ? at : Date.now() });
      confirmedSent++;
      continue;
    }
    const rejected = await readPath(`packets/rejected/${entry.packetId}`, fetchFn);
    if (rejected) {
      const reason = [rejected.reason, rejected.readableReason].filter(Boolean).join(': ') || 'rejected by server';
      await setPullSyncStatus(entry.packetId, 'rejected', { rejectionReason: reason });
      confirmedRejected++;
      continue;
    }
    stillUnknown++;
  }

  if (confirmedSent || confirmedRejected) {
    console.log(`[DeliveryStatus] Reconciled: ${confirmedSent} sent, ${confirmedRejected} rejected, ${stillUnknown} pending outcome`);
  }
  return { confirmedSent, confirmedRejected, stillUnknown };
}

export interface DeliveryCounts {
  /** Locally queued, still within the retry threshold. */
  pending: number;
  /** Locally queued with >= SYNC_FAILED_THRESHOLD transport failures. */
  failed: number;
  /** Submitted to incoming with no server outcome for too long. */
  submittedTooLong: number;
  /** Server-quarantined with a preserved reason. */
  rejected: number;
  /** failed + submittedTooLong + rejected — what the badge must surface. */
  attention: number;
}

/** Pure count computation (unit-testable without storage). */
export function computeDeliveryCounts(
  queue: QueuedPacket[],
  history: PullHistoryEntry[],
  nowMs: number,
): DeliveryCounts {
  const failed = queue.filter(p => (p.retryCount || 0) >= SYNC_FAILED_THRESHOLD).length;
  const pending = queue.length - failed;
  const submittedTooLong = history.filter(
    e => e.syncStatus === 'submitted' && (e.submittedAt ?? e.sentAt) < nowMs - SUBMITTED_ATTENTION_MS,
  ).length;
  const rejected = history.filter(e => e.syncStatus === 'rejected').length;
  return { pending, failed, submittedTooLong, rejected, attention: failed + submittedTooLong + rejected };
}

export async function getDeliveryCounts(nowMs: number = Date.now()): Promise<DeliveryCounts> {
  const [queue, history] = [await getQueuedPackets(), await getPullHistory()];
  return computeDeliveryCounts(queue, history, nowMs);
}

export interface DeliveryItem {
  packetId: string | null;
  queueId: string | null;       // present only while locally queued
  wellName: string;
  dateTime: string;             // driver-entered pull time (display)
  bblsTaken: number | null;
  type: 'pull' | 'edit';
  status: 'pending_sync' | 'submitted' | 'sync_failed' | 'rejected';
  attempts: number;
  lastError: string | null;     // transport error or rejection reason
  lastAttemptAt: number | null;
  /** Manual retry allowed ONLY for locally queued transport failures. */
  canRetry: boolean;
}

/**
 * Joined attention/pending list for the Sync Status screen: every locally
 * queued packet (with live retry metadata) plus every submitted/rejected
 * history entry that is no longer in the queue. Nothing is filtered out —
 * failed and rejected evidence stays visible until resolved.
 */
export async function getDeliveryItems(nowMs: number = Date.now()): Promise<DeliveryItem[]> {
  const queue = await getQueuedPackets();
  const history = await getPullHistory();
  const items: DeliveryItem[] = [];
  const queuedPacketIds = new Set(queue.map(p => p.packetId).filter(Boolean));

  for (const p of queue) {
    const failedThreshold = (p.retryCount || 0) >= SYNC_FAILED_THRESHOLD;
    items.push({
      packetId: p.packetId ?? null,
      queueId: p.id,
      wellName: p.data?.wellName || 'Unknown',
      dateTime: p.data?.dateTime || '',
      bblsTaken: typeof p.data?.bblsTaken === 'number' ? p.data.bblsTaken : null,
      type: p.type,
      status: failedThreshold ? 'sync_failed' : 'pending_sync',
      attempts: p.retryCount || 0,
      lastError: p.lastError ?? null,
      lastAttemptAt: p.lastAttemptAt ?? null,
      canRetry: true, // in the queue ⇒ a local transport-level packet
    });
  }

  for (const e of history) {
    if (queuedPacketIds.has(e.packetId)) continue; // already listed live
    if (e.syncStatus === 'rejected') {
      items.push({
        packetId: e.packetId,
        queueId: null,
        wellName: e.wellName,
        dateTime: e.dateTime,
        bblsTaken: e.bblsTaken,
        type: 'pull',
        status: 'rejected',
        attempts: 0,
        lastError: e.rejectionReason ?? 'rejected by server',
        lastAttemptAt: e.submittedAt ?? null,
        canRetry: false, // server verdict — never auto/manual retried here
      });
    } else if (e.syncStatus === 'submitted') {
      items.push({
        packetId: e.packetId,
        queueId: null,
        wellName: e.wellName,
        dateTime: e.dateTime,
        bblsTaken: e.bblsTaken,
        type: 'pull',
        status: 'submitted',
        attempts: 0,
        lastError:
          (e.submittedAt ?? e.sentAt) < nowMs - SUBMITTED_ATTENTION_MS
            ? 'No server outcome yet — needs attention'
            : null,
        lastAttemptAt: e.submittedAt ?? null,
        canRetry: false, // outcome unknown; retrying could double-record
      });
    }
  }

  // Oldest first — same discipline as the queue itself.
  items.sort((a, b) => (a.lastAttemptAt ?? 0) - (b.lastAttemptAt ?? 0));
  return items;
}

let _reconcilerStarted = false;

/** Wire reconciliation to app lifecycle: once at startup and after every
 *  queue flush (each flush may have newly submitted packets). Idempotent. */
export function startDeliveryReconciler(): void {
  if (_reconcilerStarted) return;
  _reconcilerStarted = true;
  onFlushComplete(() => {
    reconcileSubmittedPulls().catch(() => {});
  });
  // Startup pass — catch outcomes that landed while the app was closed.
  setTimeout(() => {
    reconcileSubmittedPulls().catch(() => {});
  }, 3000);
  console.log('[DeliveryStatus] Reconciler started');
}
