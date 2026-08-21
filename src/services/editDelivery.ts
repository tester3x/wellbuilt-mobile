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
import { readJsonPath } from './backendAccess';
import { diagnoseThrown, formatDiagnosis } from './connectionDiagnosis';
import { uploadEditPacket } from './firebase';
import { confirmNewSecureEdit } from './editMarkers';
import {
  isOnline,
  mutateQueuedPullInPlace,
  getQueuedPackets,
  onConnectivityChange,
  onFlushComplete,
} from './packetQueue';
import { getPullHistory, setPullEditStatus } from './pullHistory';

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
  /** Stable operation identity — one per original pull, reused verbatim on
   *  every retry (the server incoming key edit_<origTs>_<well> is equally
   *  deterministic, so replays are idempotent). */
  opId: string;
  originalPacketId: string;
  wellName: string;
  payload: EditPacketParams;
  state: EditOpState;
  blockedReason?: string;
  rejectionReason?: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
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

function newOp(payload: EditPacketParams, state: EditOpState, blockedReason?: string): EditOperation {
  const now = Date.now();
  return {
    opId: `editop_${payload.originalPacketId}`,
    originalPacketId: payload.originalPacketId,
    wellName: payload.wellName,
    payload,
    state,
    ...(blockedReason ? { blockedReason } : {}),
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    lastError: null,
  };
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

  // 2. Original submitted/pending without server outcome → dependent hold.
  if (entry?.syncStatus === 'submitted' || entry?.syncStatus === 'pending_sync' || entry?.syncStatus === 'sync_failed') {
    await upsertOp(newOp(payload, 'edit_pending'));
    await setPullEditStatus(originalId, 'edit_pending');
    return { mode: 'held_dependent' };
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

let _processing = false;

/**
 * Drive every stored operation toward resolution. Order-safe by
 * construction: an edit_pending op only uploads once its original's stable
 * id EXISTS in packets/processed (checked server-side right now, so a
 * concurrent create-flush can never be overtaken — the edit waits for the
 * created pull to be processed, not merely uploaded). Confirmation flips
 * '(edited)'; rejection preserves the reason. Nothing is ever deleted
 * except fully confirmed ops.
 */
export async function processEditOperations(
  fetchFn: typeof fetch = fetch,
): Promise<{ submitted: number; confirmed: number; rejected: number; held: number }> {
  if (_processing) return { submitted: 0, confirmed: 0, rejected: 0, held: 0 };
  _processing = true;
  try {
    const result = await processEditOperationsInner(fetchFn);
    for (const l of _editListeners) {
      try { l(result); } catch {}
    }
    return result;
  } finally {
    _processing = false;
  }
}

async function processEditOperationsInner(
  fetchFn: typeof fetch,
): Promise<{ submitted: number; confirmed: number; rejected: number; held: number }> {
  const ops = await loadOps();
  let submitted = 0;
  let confirmed = 0;
  let rejected = 0;
  let held = 0;
  if (ops.length === 0) return { submitted, confirmed, rejected, held };
  const online = await isOnline();

  for (const op of ops) {
    if (op.state === 'edit_blocked' || op.state === 'edit_rejected' || op.state === 'edited') {
      if (op.state === 'edit_blocked') held++;
      continue;
    }

    if (op.state === 'edit_pending') {
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
      // Original is processed → release the dependent edit.
      // Idempotent: the server incoming key is deterministic per original.
      try {
        const uploadResult = await uploadEditPacket(op.payload);
        if (confirmNewSecureEdit(uploadResult)) {
          await markConfirmed(op);
          confirmed++;
        } else {
          op.state = 'edit_submitted';
          op.updatedAt = Date.now();
          op.lastError = null;
          await upsertOp(op);
          await setPullEditStatus(op.originalPacketId, 'edit_submitted');
          submitted++;
        }
      } catch (err: any) {
        op.attempts += 1;
        op.lastError = formatDiagnosis(diagnoseThrown(err), String(err?.message || err || 'unknown'));
        op.updatedAt = Date.now();
        await upsertOp(op);
        if (op.attempts >= EDIT_FAILED_THRESHOLD) {
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
      if (confirmNewSecureEdit(processedOrig.data)) {
        await markConfirmed(op);
        confirmed++;
        continue;
      }
      const wellClean = op.wellName.replace(/\s+/g, '');
      const editKey = `edit_${op.payload.originalPacketTimestamp}_${wellClean}`;
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
  return { submitted, confirmed, rejected, held };
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
