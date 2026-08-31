// src/services/editDelivery.ts
// Ordered, truthful pull-edit delivery (GS3).
//
// An edit must never race or orphan its original pull. Decision ladder at
// save time (submitPullEdit):
//   1. Original still LOCALLY QUEUED  → no edit packet at all: the queued
//      pull's payload is mutated in place (same stable id, same position).
//   2. Original SUBMITTED, unresolved → the edit becomes a DEPENDENT
//      operation, durably stored; it uploads only after the original's id
//      appears in packets/processed. Survives restart and offline.
//   3. Original PROCESSED ('sent')    → upload now under the operation's
//      stable op identity; '(edited)' appears only on server confirmation.
//   4. Original REJECTED              → the edit is HELD for attention
//      (never sent, never deleted).
//   5. Legacy queued_* identity       → held for attention, never guessed.
//
// One operation per original pull: editing again before delivery replaces
// the operation's payload (latest driver intent), never its identity —
// mirroring the server's edit_<origTs>_<well> incoming key, which is also
// deterministic per original.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { readJsonPath } from './backendAccess';
import { diagnoseThrown, formatDiagnosis } from './connectionDiagnosis';
import { uploadEditPacket } from './firebase';
import { confirmAppliedEdit, confirmNewSecureEdit } from './editMarkers';
import {
  isOnline,
  mutateQueuedPullInPlace,
  getQueuedPackets,
  onConnectivityChange,
  onFlushComplete,
} from './packetQueue';
import { getPullHistory, setPullEditStatus, setPullSyncStatus } from './pullHistory';

const EDIT_OPS_KEY = '@wellbuilt_edit_ops';

export const EDIT_FAILED_THRESHOLD = 5;

export interface EditPacketParams {
  originalPacketTimestamp: string;
  originalPacketId: string;
  wellName: string;
  dateTime: string;
  dateTimeUTC: string;
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown: boolean;
  /** This correction's unique event identity, carried to the transport command
   *  as the idempotency key. Optional for backward compatibility with legacy
   *  operations (which fall back to the historical deterministic key). */
  editEventId?: string;
}

export type EditOpState =
  | 'edit_pending'    // waiting for the original to be processed
  | 'edit_blocked'    // original rejected / legacy identity — attention
  | 'edit_submitted'  // uploaded; awaiting server confirmation
  | 'edited'          // server confirmed
  | 'edit_rejected';  // server quarantined the edit; reason preserved
// (transport failures keep state edit_pending/edit_submitted with
//  attempts/lastError; history shows edit_failed past the threshold)

export interface EditOperation {
  /** Durable local queue-record identity. For v2 corrections this equals the
   *  op's own editEventId (unique per correction). Legacy operations keep their
   *  historical `editop_<originalPacketId>` value and are NEVER reminted. */
  opId: string;
  /** Unique identity of ONE correction event: minted once when the correction
   *  is first submitted, persisted before transport, reused verbatim on every
   *  retry, and DISTINCT for a later correction to the same original. Absent on
   *  legacy operations (they correlate by the historical deterministic key).
   *  Two distinct corrections to one original therefore coexist as two records. */
  editEventId?: string;
  originalPacketId: string;
  wellName: string;
  payload: EditPacketParams;
  state: EditOpState;
  blockedReason?: string;
  /** Stable, non-raw reason marker for a blocked edit. 'edit_unsupported' means
   *  parked awaiting the backend edit capability (dependency_blocked) — distinct
   *  from an original-rejected/legacy block. Never a raw coding string. */
  blockedCode?: string;
  rejectionReason?: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastAttemptAt?: number | null;
  lastError: string | null;
}

export type SubmitEditOutcome =
  | { mode: 'merged_into_queued' }          // case 1 — no edit packet exists
  | { mode: 'held_dependent' }              // case 2 — waiting on original
  | { mode: 'uploading'; submitted: boolean } // case 3
  | { mode: 'blocked'; reason: string };    // cases 4/5 — attention

async function loadOps(): Promise<EditOperation[]> {
  try {
    const stored = await AsyncStorage.getItem(EDIT_OPS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

async function saveOps(ops: EditOperation[]): Promise<void> {
  await AsyncStorage.setItem(EDIT_OPS_KEY, JSON.stringify(ops));
}

async function upsertOp(op: EditOperation): Promise<void> {
  const ops = await loadOps();
  const idx = ops.findIndex(o => o.opId === op.opId);
  if (idx >= 0) ops[idx] = op;
  else ops.push(op);
  await saveOps(ops);
}

export async function getEditOperations(): Promise<EditOperation[]> {
  return loadOps();
}

/**
 * Mint one unique correction identity: a crypto-secure V4 UUID (expo-crypto,
 * RFC4122), prefixed so it is clearly an edit-event id, firebase-key-safe, and
 * within the backend's 8–128 char bound. No Math.random, no time/value/well
 * derivation — two corrections to the SAME original are always distinct. This
 * is the literal `editEventId` the governed backend requires and the key its
 * durable receipt is correlated by.
 */
export function mintEditEventId(): string {
  return `editevt_${Crypto.randomUUID()}`;
}

/**
 * Mint the durable LOCAL queue identity for one correction: a full-entropy
 * crypto V4 UUID (never truncated), `editop_`-prefixed as the local queue
 * marker. Distinct from the packet's editEventId (never the packet identity),
 * and not derived from the original packet id — the op carries originalPacketId
 * as its own field for correlation. Full entropy guarantees two corrections to
 * one original are two distinct durable operations even if some other id's
 * leading characters happen to coincide.
 */
function mintOpId(): string {
  return `editop_${Crypto.randomUUID()}`;
}

/** The receipt/server-correlation key for an operation: a v2 op correlates by
 *  its unique editEventId; a genuinely-legacy stored op (no editEventId) falls
 *  back to the historical deterministic key so it keeps resolving old receipts
 *  without a remint. New operations always carry an editEventId. */
function editCorrelationKey(op: EditOperation): string {
  if (op.editEventId) return op.editEventId;
  const ts = (op.payload.originalPacketTimestamp || '').slice(0, 15);
  return `edit_${ts}_${op.wellName.replace(/\s+/g, '')}`;
}

function newOp(payload: EditPacketParams, state: EditOpState, blockedReason?: string): EditOperation {
  const now = Date.now();
  // Each call is one freshly-submitted correction → mint one new packet identity
  // (editEventId) AND a distinct local queue identity (opId). A later correction
  // to the same original appends a distinct record rather than overwriting the
  // earlier one; local operation identity is never the packet identity.
  const editEventId = mintEditEventId();
  return {
    opId: mintOpId(),
    editEventId,
    originalPacketId: payload.originalPacketId,
    wellName: payload.wellName,
    payload,
    state,
    ...(blockedReason ? { blockedReason } : {}),
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
  };
}

export const EDIT_AUTO_BACKOFF_MS = [0, 2000, 8000, 20000, 60000] as const;

export function isPermanentEditFailure(lastError: string | null): boolean {
  if (!lastError) return false;
  // unsupported_field_command(:edit) is a backend capability gap — the endpoint
  // cannot accept edits, so a retry can NEVER succeed. It must stop auto-retrying
  // (park) rather than loop and accrue attempts. It is "permanent" for the
  // purpose of halting retries (not a driver error — see dependency_blocked).
  return /permission|malformed|invalid-argument|missing_original|cross_driver|cross_company|forged_well|idempotency_key_mismatch|unsupported_field_command|dependency_blocked|edit_unsupported/i.test(lastError);
}

/** True when the edit is parked awaiting a backend capability (ingestWbmEdit),
 *  as opposed to a driver-fixable or transient failure. */
export function isDependencyBlockedEdit(lastError: string | null): boolean {
  if (!lastError) return false;
  return /dependency_blocked|edit_unsupported|unsupported_field_command/i.test(lastError);
}

export function shouldAutoAttemptEdit(op: EditOperation, nowMs: number): boolean {
  if (op.state === 'edit_blocked' || op.state === 'edit_rejected' || op.state === 'edited') return false;
  if (isPermanentEditFailure(op.lastError)) return false;
  if (!op.lastAttemptAt && op.attempts === 0) return true;
  const wait = EDIT_AUTO_BACKOFF_MS[Math.min(op.attempts, EDIT_AUTO_BACKOFF_MS.length - 1)];
  return nowMs - (op.lastAttemptAt ?? op.updatedAt) >= wait;
}

/**
 * Entry point from the Record screen's edit mode. Decides the safe path
 * per the ladder above; the caller updates local display values itself
 * but must NOT mark '(edited)' — that happens only on confirmation.
 */
export async function submitPullEdit(
  payload: EditPacketParams,
  fetchFn: typeof fetch = fetch,
): Promise<SubmitEditOutcome> {
  const originalId = payload.originalPacketId;

  // 5. Legacy invented identity — never guess what it maps to.
  if (!originalId || originalId.startsWith('queued_')) {
    const reason = 'Original pull has a legacy local identity — needs manual review before the edit can be delivered.';
    await upsertOp(newOp(payload, 'edit_blocked', reason));
    await setPullEditStatus(originalId, 'edit_pending', reason);
    return { mode: 'blocked', reason };
  }

  // 1. Original still locally queued → mutate the queued payload in place.
  const merged = await mutateQueuedPullInPlace(originalId, {
    tankLevelFeet: payload.tankLevelFeet,
    bblsTaken: payload.bblsTaken,
    wellDown: payload.wellDown,
    dateTime: payload.dateTime,
    dateTimeUTC: payload.dateTimeUTC,
  });
  if (merged) {
    // No server edit exists; the pull's own pending_sync/sync_failed
    // delivery status stays authoritative and '(edited)' must not appear.
    return { mode: 'merged_into_queued' };
  }

  // Resolve the original's delivery state from local truth.
  const history = await getPullHistory();
  const entry = history.find(e => e.packetId === originalId || e.id === originalId);

  // 4. Original rejected → hold for attention; never send, never delete.
  if (entry?.syncStatus === 'rejected') {
    const reason = `Original pull was rejected by the server (${entry.rejectionReason || 'no reason recorded'}) — edit held for review.`;
    await upsertOp(newOp(payload, 'edit_blocked', reason));
    await setPullEditStatus(originalId, 'edit_pending', reason);
    return { mode: 'blocked', reason };
  }

  // 2. Original submitted/pending by LOCAL status. Thor 1 (8/30/2026): the local
  //    delivery status can be stale — the server may already have processed the
  //    original CREATE (its confirmation reconcile hadn't run, e.g. because the
  //    incoming_version watcher is saturated). Rather than passively hold the
  //    edit until a later foreground/flush/auth event, reconcile the original
  //    against the server RIGHT NOW: if packets/processed/<original> exists, the
  //    create is landed → promote it to 'sent' and deliver the edit immediately.
  if (entry?.syncStatus === 'submitted' || entry?.syncStatus === 'pending_sync' || entry?.syncStatus === 'sync_failed') {
    const processedOrig = await readPath(`packets/processed/${originalId}`, fetchFn);
    if (!processedOrig.data) {
      // Genuinely not on the server yet → dependent hold (the flush-complete /
      // connectivity / auth passes will deliver it once the original lands).
      await upsertOp(newOp(payload, 'edit_pending'));
      await setPullEditStatus(originalId, 'edit_pending');
      return { mode: 'held_dependent' };
    }
    // Reconciled: the original is on the server. Fall through to immediate delivery.
    await setPullSyncStatus(originalId, 'sent');
  }

  // 3. Original processed (confirmed 'sent', a cross-app/legacy entry, or
  // unknown-but-server-side). Store the op first (durability), then try to
  // deliver right away; transport failure leaves it stored for retry.
  await upsertOp(newOp(payload, 'edit_pending'));
  await setPullEditStatus(originalId, 'edit_pending');
  const result = await processEditOperations(fetchFn);
  const op = (await loadOps()).find(o => o.originalPacketId === originalId);
  return { mode: 'uploading', submitted: op?.state === 'edit_submitted' || result.submitted > 0 };
}

async function readPath(path: string, fetchFn: typeof fetch): Promise<{
  data: any | null;
  diagnosis: ReturnType<typeof diagnoseThrown> | null;
}> {
  const result = await readJsonPath(path, fetchFn);
  return { data: result.found ? result.data : null, diagnosis: result.diagnosis };
}

let _editListeners: ((r: { submitted: number; confirmed: number; rejected: number; held: number }) => void)[] = [];
export function onEditDeliveryResult(
  listener: (r: { submitted: number; confirmed: number; rejected: number; held: number }) => void,
): () => void {
  _editListeners.push(listener);
  return () => { _editListeners = _editListeners.filter(l => l !== listener); };
}

async function markConfirmed(op: EditOperation): Promise<void> {
  op.state = 'edited';
  op.updatedAt = Date.now();
  await upsertOp(op);
  await setPullEditStatus(op.originalPacketId, 'edited');
  await saveOps((await loadOps()).filter(o => o.opId !== op.opId));
}

let _inFlight: Promise<{ submitted: number; confirmed: number; rejected: number; held: number; attemptedOpIds: string[] }> | null = null;

export type ProcessEditOptions = { forceOpId?: string; nowMs?: number };

/**
 * Drive stored operations toward resolution. Concurrent callers join one
 * in-flight pass. Sequential auto-retries honor backoff. forceOpId bypasses
 * backoff for that operation only and still counts as one attempt.
 */
export async function processEditOperations(
  fetchFn: typeof fetch = fetch,
  opts: ProcessEditOptions = {},
): Promise<{ submitted: number; confirmed: number; rejected: number; held: number; attemptedOpIds: string[] }> {
  if (_inFlight && !opts.forceOpId) return _inFlight;
  if (_inFlight && opts.forceOpId) {
    const joined = await _inFlight;
    if (joined.attemptedOpIds.includes(`editop_${opts.forceOpId}`) || joined.attemptedOpIds.includes(opts.forceOpId)) {
      return joined;
    }
  }
  const run = (async () => {
    const result = await processEditOperationsInner(fetchFn, opts);
    for (const l of _editListeners) {
      try { l(result); } catch {}
    }
    return result;
  })();
  if (!opts.forceOpId) {
    _inFlight = run.finally(() => { _inFlight = null; });
    return _inFlight;
  }
  return run;
}

async function processEditOperationsInner(
  fetchFn: typeof fetch,
  opts: ProcessEditOptions = {},
): Promise<{ submitted: number; confirmed: number; rejected: number; held: number; attemptedOpIds: string[] }> {
  const ops = await loadOps();
  let submitted = 0;
  let confirmed = 0;
  let rejected = 0;
  let held = 0;
  const attemptedOpIds: string[] = [];
  if (ops.length === 0) return { submitted, confirmed, rejected, held, attemptedOpIds };
  const online = await isOnline();
  const nowMs = opts.nowMs ?? Date.now();
  const forceOpId = opts.forceOpId;

  for (const op of ops) {
    if (forceOpId && op.opId !== forceOpId && op.originalPacketId !== forceOpId) continue;
    if (op.state === 'edit_blocked' || op.state === 'edit_rejected' || op.state === 'edited') {
      if (op.state === 'edit_blocked') held++;
      continue;
    }

    if (op.state === 'edit_pending') {
      // Serial per original: never SEND a later correction while an earlier
      // correction to the SAME original is still transiently in flight
      // (edit_pending awaiting delivery, or edit_submitted awaiting confirmation).
      // Terminal states (edit_blocked / edit_rejected / edited) do NOT block the
      // queue — a parked earlier correction lets the next one proceed. Ordered by
      // durable local creation time; neither correction is ever dropped.
      const isEarlier = (o: EditOperation) =>
        o.createdAt < op.createdAt || (o.createdAt === op.createdAt && o.opId < op.opId);
      const earlierInFlight = ops.some(o =>
        o.opId !== op.opId
        && o.originalPacketId === op.originalPacketId
        && isEarlier(o)
        && (o.state === 'edit_pending' || o.state === 'edit_submitted'));
      if (earlierInFlight) { held++; continue; }

      // Re-check the original's fate every pass.
      const queue = await getQueuedPackets();
      if (queue.some(p => p.type === 'pull' && p.packetId === op.originalPacketId)) {
        held++; // original still local — the in-place merge path owns it
        continue;
      }
      if (!online) { held++; continue; }
      const processed = await readPath(`packets/processed/${op.originalPacketId}`, fetchFn);
      if (!processed.data) {
        if (processed.diagnosis && (processed.diagnosis.kind === 'auth_session' || processed.diagnosis.kind === 'permission')) {
          op.lastError = formatDiagnosis(processed.diagnosis);
          op.updatedAt = Date.now();
          await upsertOp(op);
          held++;
          continue;
        }
        const rejectedOriginal = await readPath(`packets/rejected/${op.originalPacketId}`, fetchFn);
        if (rejectedOriginal.data) {
          op.state = 'edit_blocked';
          op.blockedReason = `Original pull was rejected by the server (${rejectedOriginal.data.reason || 'unknown'}) — edit held for review.`;
          op.updatedAt = Date.now();
          await upsertOp(op);
          await setPullEditStatus(op.originalPacketId, 'edit_pending', op.blockedReason);
          held++;
          continue;
        }
        held++; // original not resolved yet — keep waiting, keep the edit
        continue;
      }
      if (!forceOpId && !shouldAutoAttemptEdit(op, nowMs)) {
        held++;
        continue;
      }
      // Original is processed → release the dependent edit.
      // Idempotent: the server incoming key is deterministic per original.
      attemptedOpIds.push(op.opId);
      op.attempts += 1;
      op.lastAttemptAt = nowMs;
      op.updatedAt = nowMs;
      try {
        // Carry THIS correction's persisted editEventId as the command's
        // idempotency identity so retries are idempotent per-correction and a
        // later correction to the same original is a distinct command. The
        // correction's event time is derived from the op's persisted createdAt,
        // so it is stamped ONCE and preserved verbatim across every retry and
        // app restart (never a fresh device "now").
        const uploadResult = await uploadEditPacket({
          ...op.payload,
          editEventId: op.editEventId,
          correctionCreatedAtUTC: new Date(op.createdAt).toISOString(),
        });
        if (confirmNewSecureEdit(uploadResult)) {
          await markConfirmed(op);
          confirmed++;
        } else {
          op.state = 'edit_submitted';
          op.lastError = null;
          await upsertOp(op);
          await setPullEditStatus(op.originalPacketId, 'edit_submitted');
          submitted++;
        }
      } catch (err: any) {
        const diagnosis = diagnoseThrown(err);
        // Backend capability gap (pull edit not yet supported): PARK under the
        // existing identity — no retry, no raw coding string, no driver
        // attention — until the governed edit capability exists. Never delete
        // or remint the edit.
        if (diagnosis.kind === 'dependency_blocked') {
          op.state = 'edit_blocked';
          op.blockedReason = 'Edit saved — it will send once the server supports pull edits.';
          op.blockedCode = 'edit_unsupported';
          op.lastError = op.blockedReason;
          await upsertOp(op);
          await setPullEditStatus(op.originalPacketId, 'edit_pending', op.blockedReason);
          continue;
        }
        op.lastError = formatDiagnosis(diagnosis, diagnosis.retryable ? undefined : String(err?.message || err || ''));
        await upsertOp(op);
        if (!diagnosis.retryable || op.attempts >= EDIT_FAILED_THRESHOLD) {
          await setPullEditStatus(op.originalPacketId, 'edit_failed', op.lastError);
        }
      }
      continue;
    }

    // edit_submitted → confirm or detect rejection. Never re-uploads:
    // a second submit of an already-accepted edit would be a duplicate.
    if (op.state === 'edit_submitted') {
      if (!online) { held++; continue; }
      const processedOrig = await readPath(`packets/processed/${op.originalPacketId}`, fetchFn);
      // New secure edits confirm ONLY via confirmNewSecureEdit proofs.
      // Legacy editedAt / wasEdited / editedByPacketId / isEdit do not confirm.
      if (confirmAppliedEdit(processedOrig.data, op) || confirmNewSecureEdit(processedOrig.data)) {
        await markConfirmed(op);
        confirmed++;
        continue;
      }
      // Correlate ONLY this correction's own receipt/records (v2: its unique
      // editEventId; legacy: the historical deterministic key). A receipt for a
      // different correction can never terminate this operation.
      const editKey = editCorrelationKey(op);
      const processedEdit = await readPath(`packets/processed/${editKey}`, fetchFn);
      if (confirmNewSecureEdit(processedEdit.data)) {
        await markConfirmed(op);
        confirmed++;
        continue;
      }
      try {
        const { getFieldCommandStatus } = await import('./secureOperationalApi');
        const receipt = await getFieldCommandStatus({
          packetId: op.originalPacketId,
          idempotencyKey: editKey,
        });
        if (confirmNewSecureEdit(receipt)) {
          await markConfirmed(op);
          confirmed++;
          continue;
        }
      } catch (err) {
        const d = diagnoseThrown(err);
        if (d.kind === 'auth_session' || d.kind === 'permission') {
          op.lastError = formatDiagnosis(d);
          op.updatedAt = Date.now();
          await upsertOp(op);
          held++;
          continue;
        }
        /* other receipt lookup failures are not confirmation */
      }
      const rejectedEdit = await readPath(`packets/rejected/${editKey}`, fetchFn);
      if (rejectedEdit.data) {
        op.state = 'edit_rejected';
        op.rejectionReason = [rejectedEdit.data.reason, rejectedEdit.data.readableReason].filter(Boolean).join(': ') || 'rejected by server';
        op.updatedAt = Date.now();
        await upsertOp(op); // evidence PRESERVED — never deleted
        await setPullEditStatus(op.originalPacketId, 'edit_rejected', op.rejectionReason);
        rejected++;
        continue;
      }
      if (processedOrig.diagnosis && (processedOrig.diagnosis.kind === 'auth_session' || processedOrig.diagnosis.kind === 'permission')) {
        op.lastError = formatDiagnosis(processedOrig.diagnosis);
        op.updatedAt = Date.now();
        await upsertOp(op);
      }
      // Still in packets/incoming → in flight. Do NOT resubmit.
      const incoming = await readPath(`packets/incoming/${editKey}`, fetchFn);
      if (incoming.data) {
        held++;
        continue;
      }
      held++; // still awaiting the server — no duplicate upload
    }
  }
  return { submitted, confirmed, rejected, held, attemptedOpIds };
}

/** Pending-edit metadata for a well — the snapshot may already display the
 *  driver's corrected values; THIS is the explicit, queryable record that
 *  a correction is not yet server-confirmed. */
export async function getPendingEditForWell(
  wellName: string,
): Promise<{ opId: string; state: EditOpState; originalPacketId: string } | null> {
  const ops = await loadOps();
  const op = ops.find(o => o.wellName === wellName && o.state !== 'edited');
  return op ? { opId: op.opId, state: op.state, originalPacketId: op.originalPacketId } : null;
}

let _started = false;

/** Lifecycle wiring: a pass at startup (dependencies survive restart) and
 *  after every queue flush (originals may just have been processed). */
export function startEditDelivery(): void {
  if (_started) return;
  _started = true;
  onFlushComplete(() => {
    processEditOperations().catch(() => {});
  });
  onConnectivityChange((online) => {
    if (online) processEditOperations().catch(() => {});
  });
  setTimeout(() => {
    processEditOperations().catch(() => {});
  }, 5000);
  console.log('[EditDelivery] Started');
}
