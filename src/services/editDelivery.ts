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
import { uploadEditPacket, uploadEditPacketV3 } from './firebase';
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
  /** Deterministic CHANGED-ONLY mask (canonical wire names) from finalizeEdit.
   *  Absent on legacy operations → the transport falls back to the assertion
   *  mask. Never a diff computed at upload time; captured once at Save. */
  editedFields?: string[];
  /** Well-Down authority: false only when the driver left the checkbox untouched
   *  (server preserves canonical). Absent → treated as authoritative. */
  wellDownIsAuthoritative?: boolean;
  /** Immutable original snapshot captured at Save (before→after evidence base).
   *  Lifted onto the op; never sent on the wire (server derives before-values). */
  originalSnapshot?: {
    tankLevelFeet: number;
    bblsTaken: number;
    wellDown: boolean;
    dateTimeUTC: string;
  } | null;
  /** Deterministic content fingerprint of the finalized edit (op immutability). */
  payloadDigest?: string | null;
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
  /** Receipt-recheck bookkeeping — SEPARATE from transport `attempts`. A
   *  held-dependent edit (awaiting its original's server receipt) and an
   *  uploaded-but-unconfirmed edit (awaiting confirmation) are not transport
   *  attempts: they upload nothing. `receiptChecks` counts how many automatic
   *  rechecks have found the awaited state still absent; it drives the bounded
   *  recheck cadence (2s → 8s → 20s → 60s cap) so the single deadline timer
   *  advances the dependent edit with NO external wake event, and never spins. */
  receiptChecks?: number;
  lastReceiptCheckAt?: number | null;
  /** Last governed-recovery attempt timestamp (diagnostic). When the governed
   *  status reports this accepted edit as MISSING (accepted-then-lost), a
   *  governed recovery reusing the SAME editEventId + preserved payload is
   *  invoked on the bounded recheck cadence (never a new id, never a duplicate
   *  ingest; idempotent server-side) so the edit self-heals once the canary is
   *  enabled. */
  recoveryAttemptedAt?: number | null;
  /** Which transport carried this op. 'v3' = the durable lane (submitWbmEditV3).
   *  Absent = a legacy op submitted through the old ingest route; on delivery it
   *  is re-driven into the durable lane (idempotent) to recover a lost edit. */
  lane?: 'v3';
  /** Immutable original snapshot captured at Save (before→after evidence base). */
  originalSnapshot?: {
    tankLevelFeet: number;
    bblsTaken: number;
    wellDown: boolean;
    dateTimeUTC: string;
  } | null;
  /** Deterministic digest of the finalized edit (op immutability + local dedupe). */
  payloadDigest?: string | null;
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
    receiptChecks: 0,
    lastReceiptCheckAt: null,
    // Immutable Save-time evidence lifted onto the op (never re-derived on retry).
    originalSnapshot: payload.originalSnapshot ?? null,
    payloadDigest: payload.payloadDigest ?? null,
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

/** An op is in TRANSPORT-RETRY mode (a prior upload FAILED and is awaiting a
 *  backed-off resend) iff it is edit_pending with ≥1 attempt — a *successful*
 *  upload moves it to edit_submitted, so edit_pending+attempts≥1 is always a
 *  failed transport. Every other eligible op (edit_pending awaiting its
 *  original, or edit_submitted awaiting confirmation) is in RECHECK mode: it
 *  uploads nothing, so its cadence is driven by receiptChecks, not attempts. */
function isTransportRetry(op: EditOperation): boolean {
  return op.state === 'edit_pending' && op.attempts >= 1;
}

/** Serial ordering per original: an op must not wake or send while an EARLIER
 *  correction to the SAME original is still in flight (edit_pending/edit_submitted).
 *  Terminal earlier corrections (edited/blocked/rejected) do NOT block it. */
function hasEarlierInFlightSibling(ops: EditOperation[], op: EditOperation): boolean {
  return ops.some(o =>
    o.opId !== op.opId
    && o.originalPacketId === op.originalPacketId
    && (o.createdAt < op.createdAt || (o.createdAt === op.createdAt && o.opId < op.opId))
    && (o.state === 'edit_pending' || o.state === 'edit_submitted'));
}

/** Record one automatic recheck that found the awaited state still absent, and
 *  persist it. Advances the bounded recheck cadence (never a transport attempt),
 *  so the very next scheduled deadline is strictly in the future — the anti-spin
 *  guarantee for held-dependent and awaiting-confirmation edits. */
async function stampReceiptCheck(op: EditOperation, nowMs: number): Promise<void> {
  op.receiptChecks = (op.receiptChecks ?? 0) + 1;
  op.lastReceiptCheckAt = nowMs;
  op.updatedAt = nowMs;
  await upsertOp(op);
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
      // Genuinely not on the server yet → dependent hold. Arm the active-only
      // scheduler so its single deadline timer rechecks the original's receipt
      // automatically (2s→8s→20s→60s) and delivers the edit the moment the
      // CREATE lands — WITHOUT waiting for any flush/connectivity/foreground/auth
      // event. (Those events still trigger an immediate extra pass when they do
      // occur.)
      await upsertOp(newOp(payload, 'edit_pending'));
      await setPullEditStatus(originalId, 'edit_pending');
      void scheduleEditDelivery();
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
  // If it landed edit_submitted (awaiting confirmation) or transiently failed,
  // arm the scheduler so confirmation/retry rechecks proceed automatically.
  void scheduleEditDelivery();
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

/**
 * Governed recovery for an accepted-but-MISSING edit (server accepted it as
 * pending, then lost it before applying). Reuses the op's EXISTING editEventId
 * and preserved payload — never mints a new id, never re-ingests. The server
 * refuses unless the canary kill switch allow-lists this exact editEventId, and
 * is idempotent (claimed/applied ⇒ existing status), so this may be re-attempted
 * safely on the bounded recheck cadence until the canary is enabled. Returns
 * 'applied' only on a proven terminal receipt; otherwise 'pending'.
 */
async function tryGovernedEditRecovery(op: EditOperation, nowMs: number): Promise<'applied' | 'pending'> {
  if (!op.editEventId) return 'pending';
  op.recoveryAttemptedAt = nowMs;
  op.updatedAt = nowMs;
  await upsertOp(op);
  try {
    const { buildWbmEditCommand } = await import('./wbmEditCommand');
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const packet = buildWbmEditCommand({
      originalPacketTimestamp: op.payload.originalPacketTimestamp,
      originalPacketId: op.originalPacketId,
      wellName: op.wellName,
      dateTime: op.payload.dateTime,
      dateTimeUTC: op.payload.dateTimeUTC,
      tankLevelFeet: op.payload.tankLevelFeet,
      bblsTaken: op.payload.bblsTaken,
      wellDown: op.payload.wellDown,
      timezone,
      editEventId: op.editEventId,
      correctionCreatedAtUTC: new Date(op.createdAt).toISOString(),
    });
    const { recoverWbmEdit } = await import('./secureOperationalApi');
    const res = await recoverWbmEdit(packet);
    return res.status === 'applied' ? 'applied' : 'pending';
  } catch {
    // Recovery unavailable (undeployed / canary off / transient) — stay pending;
    // the bounded recheck cadence retries, and status recheck confirms 'applied'.
    return 'pending';
  }
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
        const readBlocked = !!processed.diagnosis
          && (processed.diagnosis.kind === 'auth_session' || processed.diagnosis.kind === 'permission');
        if (!readBlocked) {
          // The confirmation read itself was permitted (genuine not_found or a
          // transient/other diagnosis). Distinguish a server rejection from a
          // not-yet-landed original.
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
          // Original not resolved yet — keep waiting, keep the edit. Advance the
          // bounded recheck cadence so the single deadline timer re-checks this
          // dependent edit automatically (2s → 8s → 20s → 60s cap) with NO
          // external wake event, and reschedules to a strictly-future deadline.
          await stampReceiptCheck(op, nowMs);
          held++;
          continue;
        }
        // READ-BLOCKED (auth_session / permission): we CANNOT read the original's
        // receipt, but we already proved (the local-queue guard above) that the
        // original is no longer queued locally — i.e. it was UPLOADED and accepted
        // by the governed ingest callable. A permission gap on the *read* is not
        // the *edit's* fate: stranding it here left "(edit pending)" forever.
        // Do NOT stamp a permanent 'permission' failure and do NOT hold — fall
        // through to deliver via the governed, idempotent edit callable, which
        // validates the original server-side. Ordering is preserved by the
        // local-queue guard; duplicate retries collapse on op.editEventId; a
        // not-yet-materialized original is retried (never permanently rejected)
        // in the catch below.
      }
      // MIGRATION — applies whether the confirmation read SUCCEEDED or was
      // permission/auth-blocked. A VC26-persisted op that has never attempted
      // delivery (attempts === 0) may carry a STALE read-diagnosis lastError the
      // prior build stamped here (e.g. 'errors.permission'/'errors.authSession').
      // That marker predates any delivery, so it cannot be a governed rejection —
      // clear it BEFORE the shouldAutoAttemptEdit gate so isPermanentEditFailure()
      // does not wrongly skip the repaired delivery. A delivered-then-rejected op
      // (attempts >= 1) keeps its verdict untouched. (The read-success path skips
      // the block above, so the clear MUST live out here, not inside it.)
      if (op.attempts === 0 && op.lastError) op.lastError = null;
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
        // THE ordinary edit transport is now the durable lane (submitWbmEditV3).
        // Acceptance means the op is durably stored; the server worker applies it
        // and verifies the trail before `applied`. Never the legacy ingest route.
        const uploadResult = await uploadEditPacketV3({
          ...op.payload,
          editEventId: op.editEventId,
          correctionCreatedAtUTC: new Date(op.createdAt).toISOString(),
          editedFieldsOverride: op.payload.editedFields,
          wellDownIsAuthoritative: op.payload.wellDownIsAuthoritative,
        });
        op.lane = 'v3';
        if (uploadResult.status === 'applied') {
          await markConfirmed(op);
          confirmed++;
        } else if (uploadResult.status === 'rejected') {
          op.state = 'edit_rejected';
          op.rejectionReason = uploadResult.reason || 'rejected by server';
          op.updatedAt = nowMs;
          await upsertOp(op); // evidence preserved — never deleted
          await setPullEditStatus(op.originalPacketId, 'edit_rejected', op.rejectionReason);
          rejected++;
        } else {
          // accepted | applying | retry_wait → durably queued; confirm via status.
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
        // A not-yet-materialized original (uploaded, but processIncomingPull has
        // not landed packets/processed/<original> yet) must be RETRIED, never
        // permanently rejected: it lands within seconds and the persisted
        // editEventId keeps the retry idempotent. This matters on the read-blocked
        // delivery path, where we could not pre-confirm the original by reading.
        const errMsg = String(err?.message || err || '');
        if (/missing[_ ]?original|original[_ ]?not[_ ]?found/i.test(errMsg)) {
          op.lastError = null; // not a permanent-failure marker; stays edit_pending
          await stampReceiptCheck(op, nowMs); // bounded recheck cadence, then retry
          await upsertOp(op);
          held++;
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

    // edit_submitted → confirm via the GOVERNED status, or recover an
    // accepted-but-missing edit. Never re-uploads through ingest: a second
    // submit of an already-accepted edit would be a duplicate.
    if (op.state === 'edit_submitted') {
      if (!online) { held++; continue; }

      // Preferred path: the authoritative governed edit-status callable. It is
      // the confirmation source — NOT a direct packets/processed/{editEventId}
      // read (that path is auth-blocked and, for a v2 edit, wrong).
      if (op.editEventId) {
        try {
          const { getWbmEditStatus } = await import('./secureOperationalApi');
          const verdict = await getWbmEditStatus({
            editEventId: op.editEventId,
            originalPacketId: op.originalPacketId,
          });
          if (verdict.status === 'applied') { await markConfirmed(op); confirmed++; continue; }
          if (verdict.status === 'rejected') {
            op.state = 'edit_rejected';
            op.rejectionReason = verdict.reason || 'rejected by server';
            op.updatedAt = Date.now();
            await upsertOp(op); // evidence PRESERVED — never deleted
            await setPullEditStatus(op.originalPacketId, 'edit_rejected', op.rejectionReason);
            rejected++;
            continue;
          }
          if (verdict.status === 'missing') {
            // Accepted by the OLD ingest route, then LOST server-side (zero trace).
            // Re-drive into the DURABLE LANE (submitWbmEditV3), idempotent on the
            // same editEventId + preserved payload — never a new id. This recovers
            // a lost edit permanently: the durable worker applies it and verifies
            // the trail before it reports `applied`.
            if (op.lane !== 'v3') {
              try {
                const res = await uploadEditPacketV3({
                  ...op.payload,
                  editEventId: op.editEventId,
                  correctionCreatedAtUTC: new Date(op.createdAt).toISOString(),
                  editedFieldsOverride: op.payload.editedFields,
                  wellDownIsAuthoritative: op.payload.wellDownIsAuthoritative,
                });
                op.lane = 'v3';
                op.recoveryAttemptedAt = nowMs;
                if (res.status === 'applied') { await markConfirmed(op); confirmed++; continue; }
                if (res.status === 'rejected') {
                  op.state = 'edit_rejected';
                  op.rejectionReason = res.reason || 'rejected by server';
                  op.updatedAt = Date.now();
                  await upsertOp(op);
                  await setPullEditStatus(op.originalPacketId, 'edit_rejected', op.rejectionReason);
                  rejected++;
                  continue;
                }
                await upsertOp(op); // accepted/applying/retry_wait → confirm next recheck
                await stampReceiptCheck(op, nowMs);
                held++;
                continue;
              } catch (e) {
                // A PERMANENT submit-validation failure (e.g. the original pull is
                // missing/rejected, cross-driver/company, malformed) can never
                // succeed on retry — mark the edit blocked with an honest reason
                // instead of re-driving forever. Transient/undeployed errors fall
                // through to the governed-recovery / recheck path below.
                const em = String((e as { message?: string })?.message || e || '');
                if (/edit_invalid|missing_original|original_missing|cross_driver|cross_company|forged_well|permission-denied|not_owner/i.test(em)) {
                  op.state = 'edit_blocked';
                  op.blockedReason = /missing_original|original_missing/i.test(em)
                    ? 'This edit can’t be applied — its original pull was rejected/never accepted by the server.'
                    : `This edit can’t be applied (${em.replace(/^[a-z-]+:/i, '') || 'not permitted'}).`;
                  op.blockedCode = 'edit_unappliable';
                  op.lastError = op.blockedReason;
                  op.updatedAt = Date.now();
                  await upsertOp(op); // evidence preserved — never deleted, never looped
                  // Render as a clear, permanent failure WITH the reason (never
                  // "edit pending"): edit_rejected shows editStatusReason + a
                  // rejected badge, and stops the recheck cadence.
                  await setPullEditStatus(op.originalPacketId, 'edit_rejected', op.blockedReason);
                  rejected++;
                  continue;
                }
                // v3 undeployed / transient → fall back to the governed recovery.
              }
            }
            const recovered = await tryGovernedEditRecovery(op, nowMs);
            if (recovered === 'applied') { await markConfirmed(op); confirmed++; continue; }
            await stampReceiptCheck(op, nowMs); // refused (canary off) / pending → recheck
            held++;
            continue;
          }
          // pending → bounded recheck, no duplicate upload.
          await stampReceiptCheck(op, nowMs);
          held++;
          continue;
        } catch (err) {
          const d = diagnoseThrown(err);
          if (d.kind === 'auth_session' || d.kind === 'permission') {
            // A real auth/permission failure is NOT awaiting-server silence:
            // record it and recheck on cadence (never treat as confirmed).
            op.lastError = formatDiagnosis(d);
            await stampReceiptCheck(op, nowMs);
            held++;
            continue;
          }
          // dependency_blocked (callable undeployed) or a transient failure →
          // fall through to the historical confirmation reads so behavior stays
          // safe BEFORE the server canary is deployed.
        }
      }

      // Fallback / legacy confirmation reads (no editEventId, or governed status
      // unavailable). Never re-uploads.
      const processedOrig = await readPath(`packets/processed/${op.originalPacketId}`, fetchFn);
      if (confirmAppliedEdit(processedOrig.data, op) || confirmNewSecureEdit(processedOrig.data)) {
        await markConfirmed(op);
        confirmed++;
        continue;
      }
      const editKey = editCorrelationKey(op);
      const processedEdit = await readPath(`packets/processed/${editKey}`, fetchFn);
      if (confirmNewSecureEdit(processedEdit.data)) {
        await markConfirmed(op);
        confirmed++;
        continue;
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
      }
      // Awaiting confirmation — advance the bounded recheck cadence; NEVER
      // resubmit an already-accepted edit (duplicate).
      await stampReceiptCheck(op, nowMs);
      held++;
      continue;
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

// ─────────────────────── active-only delivery scheduler ───────────────────────
// A SINGLE self-rescheduling deadline timer (never continuous polling). It fires
// only at the earliest pending edit's next backoff deadline, does nothing when
// the queue is empty, and runs only while foregrounded + online + authed.
let _started = false;
let _schedulerEnabled = false;
let _deliveryTimer: ReturnType<typeof setTimeout> | null = null;
let _fg = true, _online = true, _authed = true;
let _deliveryFetch: typeof fetch | null = null;
export function setDeliveryFetch(fn: typeof fetch | null): void { _deliveryFetch = fn; }
const clearDeliveryTimer = (): void => { if (_deliveryTimer) { clearTimeout(_deliveryTimer); _deliveryTimer = null; } };

/** True while an op should still be auto-retried at some future deadline. */
function retriesEventually(op: EditOperation): boolean {
  return op.state !== 'edit_blocked' && op.state !== 'edit_rejected' && op.state !== 'edited' && !isPermanentEditFailure(op.lastError);
}

/** This op's next automatic deadline (ms epoch). Two cadences, both bounded and
 *  capped at 60s, both drawn from EDIT_AUTO_BACKOFF_MS:
 *   • TRANSPORT-RETRY (a failed upload, edit_pending + attempts≥1): from the
 *     last attempt, backoff[min(attempts,4)] → 2s,8s,20s,60s.
 *   • RECHECK (held-dependent awaiting the original, OR uploaded awaiting
 *     confirmation): from the last recheck, backoff[min(receiptChecks+1,4)]
 *     → 2s,8s,20s,60s. ALWAYS nonzero, so a held-dependent edit is never
 *     rescheduled at 0ms, and each recheck advances receiptChecks so the next
 *     deadline is strictly in the future (no spin). */
function opDeadline(op: EditOperation, nowMs: number): number {
  if (isTransportRetry(op)) {
    const base = op.lastAttemptAt ?? op.updatedAt ?? nowMs;
    return base + EDIT_AUTO_BACKOFF_MS[Math.min(op.attempts, EDIT_AUTO_BACKOFF_MS.length - 1)];
  }
  const base = op.lastReceiptCheckAt ?? op.updatedAt ?? nowMs;
  const idx = Math.min((op.receiptChecks ?? 0) + 1, EDIT_AUTO_BACKOFF_MS.length - 1);
  return base + EDIT_AUTO_BACKOFF_MS[idx]; // idx≥1 ⇒ ≥2s, never 0
}

/** Earliest next-attempt deadline (ms epoch) across eligible ops, or null if
 *  nothing is eligible (→ zero wakeups). An op with an EARLIER in-flight sibling
 *  correction to the same original contributes NO deadline of its own — the
 *  earlier sibling's activity drives the wake, and this op is re-included the
 *  moment that sibling goes terminal (serial ordering, no sibling-polling). */
export async function nextEditDeadline(nowMs: number): Promise<number | null> {
  const ops = await loadOps();
  let min = Infinity;
  for (const op of ops) {
    if (!retriesEventually(op)) continue;
    if (hasEarlierInFlightSibling(ops, op)) continue;
    min = Math.min(min, opDeadline(op, nowMs));
  }
  return min === Infinity ? null : min;
}

/** Schedule the SINGLE next-deadline timer. Active-only + queue-gated: no timer
 *  unless enabled, foregrounded, online, authed, AND ≥1 op is pending. */
export async function scheduleEditDelivery(): Promise<void> {
  clearDeliveryTimer();
  if (!_schedulerEnabled || !_fg || !_online || !_authed) return;
  const dl = await nextEditDeadline(Date.now());
  if (dl == null) return; // empty queue → zero wakeups
  const delay = Math.max(0, dl - Date.now());
  _deliveryTimer = setTimeout(() => { void deliverAndSchedule(); }, delay);
  // Background scheduler must never keep the process (or a Jest worker) alive on
  // its own. unref is a no-op on RN's numeric timers and a clean exit on Node.
  (_deliveryTimer as { unref?: () => void } | null)?.unref?.();
}

/** One processing pass, then schedule ONLY the next required deadline. The
 *  _inFlight guard in processEditOperations prevents overlapping processors.
 *
 *  The pass ADVANCES every held op's cadence (a transport attempt bumps
 *  `attempts`; an awaiting-original / awaiting-confirmation recheck bumps
 *  `receiptChecks`), so scheduleEditDelivery's next deadline is always strictly
 *  in the future for any op that remains eligible, and null once all ops are
 *  terminal. Rescheduling is therefore UNCONDITIONAL and cannot spin: a
 *  held-dependent edit re-checks itself automatically (2s→8s→20s→60s) with no
 *  flush/connectivity/foreground/auth event required. */
async function deliverAndSchedule(): Promise<void> {
  _deliveryTimer = null;
  if (_schedulerEnabled && _online && _authed) {
    await (_deliveryFetch ? processEditOperations(_deliveryFetch) : processEditOperations()).catch(() => null);
  }
  await scheduleEditDelivery();
}

export function setDeliveryForeground(fg: boolean): void {
  _fg = fg;
  if (!fg) { clearDeliveryTimer(); return; } // background → cancel
  void deliverAndSchedule();                  // foreground → process overdue + reschedule
}
export function setDeliveryOnline(online: boolean): void {
  _online = online;
  if (!online) { clearDeliveryTimer(); return; } // offline → cancel/wait
  void deliverAndSchedule();                      // reconnect → immediate retry
}
export function setDeliveryAuthed(authed: boolean): void {
  _authed = authed;
  if (!authed) { clearDeliveryTimer(); return; }
  void deliverAndSchedule();
}
/** Test-only reset (and a clean shutdown hook). */
export function stopEditDelivery(): void {
  clearDeliveryTimer();
  _started = false; _schedulerEnabled = false; _fg = true; _online = true; _authed = true; _deliveryFetch = null;
}

/** Lifecycle wiring: an immediate pass at startup (dependencies survive
 *  restart), a pass after every queue flush (originals may just have processed),
 *  connectivity/foreground/auth transitions, and the active-only deadline timer
 *  for bounded automatic retry — no continuous polling. */
export function startEditDelivery(): void {
  if (_started) return;
  _started = true;
  _schedulerEnabled = true;
  onFlushComplete(() => { void deliverAndSchedule(); });
  onConnectivityChange((online) => { setDeliveryOnline(online); });
  // Foreground gating is driven by the app root wiring AppState →
  // setDeliveryForeground(state === 'active'). Kept out of this module so the
  // scheduler stays pure/testable and never imports react-native directly.
  void scheduleEditDelivery(); // schedule-only; an overdue/first op fires via its deadline (no concurrent pass)
  console.log('[EditDelivery] Started (active-only scheduler)');
}
