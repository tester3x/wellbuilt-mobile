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

import { EDIT_FAILED_THRESHOLD, EditOperation, getEditOperations } from './editDelivery';
import {
  QueuedPacket,
  SYNC_FAILED_THRESHOLD,
  flushQueue,
  forgetSubmittedPayload,
  getQueuedPackets,
  getSubmittedPayload,
  onConnectivityChange,
  onFlushComplete,
  queuePacket,
} from './packetQueue';
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
export interface ReconcileResult {
  confirmedSent: number;
  confirmedRejected: number;
  stillUnknown: number;
}

// Listeners fire after every completed reconcile pass so the badge, the
// Sync Status screen, and the Delivered toast update IMMEDIATELY — a row
// must never keep claiming "awaiting server" after processed/<id> exists.
let _reconcileListeners: ((r: ReconcileResult) => void)[] = [];
export function onReconcileResult(listener: (r: ReconcileResult) => void): () => void {
  _reconcileListeners.push(listener);
  return () => { _reconcileListeners = _reconcileListeners.filter(l => l !== listener); };
}

let _reconcileInProgress = false;

export async function reconcileSubmittedPulls(
  fetchFn: typeof fetch = fetch,
): Promise<ReconcileResult> {
  // Overlap guard: focus effects, flush events, reconnects, and the
  // visible-screen poll may all fire together — only one pass runs.
  if (_reconcileInProgress) return { confirmedSent: 0, confirmedRejected: 0, stillUnknown: 0 };
  _reconcileInProgress = true;
  try {
    const result = await reconcileSubmittedPullsInner(fetchFn);
    for (const l of _reconcileListeners) {
      try { l(result); } catch {}
    }
    return result;
  } finally {
    _reconcileInProgress = false;
  }
}

async function reconcileSubmittedPullsInner(
  fetchFn: typeof fetch,
): Promise<ReconcileResult> {
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
      await forgetSubmittedPayload(entry.packetId); // recovery copy no longer needed
      confirmedSent++;
      continue;
    }
    const rejected = await readPath(`packets/rejected/${entry.packetId}`, fetchFn);
    if (rejected) {
      const reason = [rejected.reason, rejected.readableReason].filter(Boolean).join(': ') || 'rejected by server';
      await setPullSyncStatus(entry.packetId, 'rejected', { rejectionReason: reason });
      await forgetSubmittedPayload(entry.packetId); // verdict reached — evidence lives in history + server
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

/**
 * Pure count computation (unit-testable without storage) — DERIVED from
 * the exact same row list the Sync Status screen renders, so the badge
 * can never disagree with the screen. Field bug this fixes: an edit that
 * failed transport past EDIT_FAILED_THRESHOLD and then SUCCEEDED kept
 * state 'edited' with its attempt count frozen above the threshold; the
 * old count filter ignored state, so every such well contributed a
 * phantom "needs attention" forever while the screen (rightly) hid
 * completed edits — a red "3 need attention" badge over "Nothing needs
 * attention". One canonical selector now powers both surfaces.
 */
export function computeDeliveryCounts(
  queue: QueuedPacket[],
  history: PullHistoryEntry[],
  nowMs: number,
  editOps: EditOperation[] = [],
): DeliveryCounts {
  const items = buildDeliveryItems(queue, history, editOps, nowMs);
  const failed = items.filter(i => i.status === 'sync_failed').length;
  const pending = items.filter(i => i.status === 'pending_sync').length;
  const submittedTooLong = items.filter(i => i.status === 'submitted' && i.needsAttention).length;
  const rejected = items.filter(i => i.status === 'rejected').length;
  return {
    pending,
    failed,
    submittedTooLong,
    rejected,
    // THE invariant: badge count === attention rows visible on the screen.
    attention: items.filter(i => i.needsAttention).length,
  };
}

export async function getDeliveryCounts(nowMs: number = Date.now()): Promise<DeliveryCounts> {
  const [queue, history, editOps] = [await getQueuedPackets(), await getPullHistory(), await getEditOperations()];
  return computeDeliveryCounts(queue, history, nowMs, editOps);
}

/**
 * Safe same-ID recovery for a pull stuck in 'submitted' (GS3 §7). Checks
 * all three server locations IN ORDER before acting:
 *   processed → confirm 'sent';  rejected → confirm 'rejected';
 *   incoming  → still in flight: DO NOTHING (a resubmit would duplicate);
 *   absent from all three → the packet vanished (crash/lost write): re-
 *   queue the RETAINED payload under the SAME stable packetId and flush.
 */
export async function recoverStuckSubmission(
  packetId: string,
  fetchFn: typeof fetch = fetch,
): Promise<'confirmed_sent' | 'confirmed_rejected' | 'still_in_incoming' | 'resubmitted' | 'no_payload'> {
  const processed = await readPath(`packets/processed/${packetId}`, fetchFn);
  if (processed) {
    const at = processed.processedAt ? new Date(processed.processedAt).getTime() : Date.now();
    await setPullSyncStatus(packetId, 'sent', { sentConfirmedAt: Number.isFinite(at) ? at : Date.now() });
    await forgetSubmittedPayload(packetId);
    return 'confirmed_sent';
  }
  const rejected = await readPath(`packets/rejected/${packetId}`, fetchFn);
  if (rejected) {
    const reason = [rejected.reason, rejected.readableReason].filter(Boolean).join(': ') || 'rejected by server';
    await setPullSyncStatus(packetId, 'rejected', { rejectionReason: reason });
    await forgetSubmittedPayload(packetId);
    return 'confirmed_rejected';
  }
  const incoming = await readPath(`packets/incoming/${packetId}`, fetchFn);
  if (incoming) {
    return 'still_in_incoming'; // never duplicate a packet already in flight
  }
  const payload = await getSubmittedPayload(packetId);
  if (!payload) {
    return 'no_payload'; // stays attention-flagged; nothing invented
  }
  await queuePacket('pull', payload); // payload carries the SAME packetId
  await setPullSyncStatus(packetId, 'pending_sync');
  await flushQueue();
  return 'resubmitted';
}

export interface DeliveryItem {
  packetId: string | null;
  queueId: string | null;       // present only while locally queued
  wellName: string;
  dateTime: string;             // driver-entered pull time (display)
  bblsTaken: number | null;
  type: 'pull' | 'edit';
  status:
    | 'pending_sync' | 'submitted' | 'sync_failed' | 'rejected'
    | 'edit_pending' | 'edit_submitted' | 'edit_failed' | 'edit_rejected' | 'edit_blocked';
  attempts: number;
  lastError: string | null;     // transport error or rejection/blocked reason
  lastAttemptAt: number | null;
  /** Which manual action is safe for this item, if any:
   *  'retry'   — locally queued transport failure → retryPacketNow;
   *  'recover' — stuck submitted → recoverStuckSubmission (3-path check);
   *  'retryEdit' — edit transport failure → processEditOperations. */
  action: 'retry' | 'recover' | 'retryEdit' | null;
  /** Canonical actionable flag — the badge counts EXACTLY the rows where
   *  this is true, so the two surfaces can never contradict. */
  needsAttention: boolean;
}

/**
 * THE canonical actionable-status selector (pure, unit-testable): every
 * locally queued packet (with live retry metadata) plus every
 * submitted/rejected history entry that is no longer in the queue, plus
 * every unfinished edit operation. Nothing actionable is filtered out —
 * failed and rejected evidence stays visible until resolved — and
 * nothing completed ('sent' pulls, 'edited' operations) is counted.
 * Both the Sync Status screen AND the badge derive from THIS list.
 */
export function buildDeliveryItems(
  queue: QueuedPacket[],
  history: PullHistoryEntry[],
  editOps: EditOperation[],
  nowMs: number,
): DeliveryItem[] {
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
      action: 'retry', // in the queue ⇒ a local transport-level packet
      needsAttention: failedThreshold,
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
        action: null, // server verdict — never auto/manual retried here
        needsAttention: true,
      });
    } else if (e.syncStatus === 'submitted') {
      const stuck = (e.submittedAt ?? e.sentAt) < nowMs - SUBMITTED_ATTENTION_MS;
      items.push({
        packetId: e.packetId,
        queueId: null,
        wellName: e.wellName,
        dateTime: e.dateTime,
        bblsTaken: e.bblsTaken,
        type: 'pull',
        status: 'submitted',
        attempts: 0,
        lastError: stuck ? 'No server outcome yet — needs attention' : null,
        lastAttemptAt: e.submittedAt ?? null,
        // Stuck submissions get the SAFE recovery (processed → rejected →
        // incoming checks before any same-ID resubmit). Fresh submissions
        // get no action — the reconciler resolves them within seconds.
        action: stuck ? 'recover' : null,
        needsAttention: stuck,
      });
    }
  }

  // Edit operations: dependent, blocked, submitted, failed, and rejected
  // edits are all visible; a confirmed 'edited' operation is COMPLETE —
  // it is neither shown nor counted, whatever its historical attempt
  // count (the frozen-attempts ghost was the badge/screen contradiction).
  for (const op of editOps) {
    if (op.state === 'edited') continue;
    const transportFailed = op.attempts >= EDIT_FAILED_THRESHOLD;
    const status: DeliveryItem['status'] =
      op.state === 'edit_blocked' ? 'edit_blocked'
      : op.state === 'edit_rejected' ? 'edit_rejected'
      : op.state === 'edit_submitted' ? 'edit_submitted'
      : transportFailed ? 'edit_failed'
      : 'edit_pending';
    items.push({
      packetId: op.originalPacketId,
      queueId: null,
      wellName: op.wellName,
      dateTime: op.payload.dateTime || '',
      bblsTaken: op.payload.bblsTaken,
      type: 'edit',
      status,
      attempts: op.attempts,
      lastError: op.rejectionReason ?? op.blockedReason ?? op.lastError,
      lastAttemptAt: op.updatedAt,
      action: op.state === 'edit_pending' && op.attempts > 0 ? 'retryEdit' : null,
      needsAttention:
        status === 'edit_blocked' || status === 'edit_rejected' || status === 'edit_failed',
    });
  }

  // Oldest first — same discipline as the queue itself.
  items.sort((a, b) => (a.lastAttemptAt ?? 0) - (b.lastAttemptAt ?? 0));
  return items;
}

export async function getDeliveryItems(nowMs: number = Date.now()): Promise<DeliveryItem[]> {
  const queue = await getQueuedPackets();
  const history = await getPullHistory();
  const editOps = await getEditOperations();
  return buildDeliveryItems(queue, history, editOps, nowMs);
}

let _reconcilerStarted = false;

/** Wire reconciliation to app lifecycle: once at startup, after every
 *  queue flush (each flush may have newly submitted packets), and
 *  immediately on reconnect. Idempotent. */
export function startDeliveryReconciler(): void {
  if (_reconcilerStarted) return;
  _reconcilerStarted = true;
  onFlushComplete(() => {
    reconcileSubmittedPulls().catch(() => {});
  });
  // Reconnect: outcomes may have settled server-side while we were dark.
  onConnectivityChange((online) => {
    if (online) reconcileSubmittedPulls().catch(() => {});
  });
  // Startup pass — catch outcomes that landed while the app was closed.
  setTimeout(() => {
    reconcileSubmittedPulls().catch(() => {});
  }, 3000);
  console.log('[DeliveryStatus] Reconciler started');
}
