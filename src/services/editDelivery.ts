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
import { uploadEditPacket } from './firebase';
import {
  isOnline,
  mutateQueuedPullInPlace,
  getQueuedPackets,
  onFlushComplete,
} from './packetQueue';
import { getPullHistory, setPullEditStatus } from './pullHistory';

const EDIT_OPS_KEY = '@wellbuilt_edit_ops';
const FIREBASE_DATABASE_URL = 'https://wellbuilt-sync-default-rtdb.firebaseio.com';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';

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

async function readPath(path: string, fetchFn: typeof fetch): Promise<any | null> {
  try {
    const res = await fetchFn(`${FIREBASE_DATABASE_URL}/${path}.json?auth=${FIREBASE_API_KEY}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) ?? null;
  } catch {
    return null;
  }
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
    return await processEditOperationsInner(fetchFn);
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
      if (!processed) {
        const rejectedOriginal = await readPath(`packets/rejected/${op.originalPacketId}`, fetchFn);
        if (rejectedOriginal) {
          op.state = 'edit_blocked';
          op.blockedReason = `Original pull was rejected by the server (${rejectedOriginal.reason || 'unknown'}) — edit held for review.`;
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
      try {
        await uploadEditPacket(op.payload);
        op.state = 'edit_submitted';
        op.updatedAt = Date.now();
        await upsertOp(op);
        await setPullEditStatus(op.originalPacketId, 'edit_submitted');
        submitted++;
      } catch (err: any) {
        op.attempts += 1;
        op.lastError = String(err?.message || err || 'unknown');
        op.updatedAt = Date.now();
        await upsertOp(op);
        if (op.attempts >= EDIT_FAILED_THRESHOLD) {
          await setPullEditStatus(op.originalPacketId, 'edit_failed', op.lastError);
        }
      }
      continue;
    }

    // edit_submitted → confirm or detect rejection.
    if (op.state === 'edit_submitted') {
      if (!online) { held++; continue; }
      const processedOrig = await readPath(`packets/processed/${op.originalPacketId}`, fetchFn);
      if (processedOrig && (processedOrig.editedAt || processedOrig.wasEdited || processedOrig.editedByPacketId)) {
        op.state = 'edited';
        op.updatedAt = Date.now();
        await upsertOp(op);
        await setPullEditStatus(op.originalPacketId, 'edited');
        confirmed++;
        // Fully confirmed — the op has served its purpose.
        await saveOps((await loadOps()).filter(o => o.opId !== op.opId));
        continue;
      }
      const wellClean = op.wellName.replace(/\s+/g, '');
      const editKey = `edit_${op.payload.originalPacketTimestamp}_${wellClean}`;
      const rejectedEdit = await readPath(`packets/rejected/${editKey}`, fetchFn);
      if (rejectedEdit) {
        op.state = 'edit_rejected';
        op.rejectionReason = [rejectedEdit.reason, rejectedEdit.readableReason].filter(Boolean).join(': ') || 'rejected by server';
        op.updatedAt = Date.now();
        await upsertOp(op); // evidence PRESERVED — never deleted
        await setPullEditStatus(op.originalPacketId, 'edit_rejected', op.rejectionReason);
        rejected++;
        continue;
      }
      held++; // still awaiting the server
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
  setTimeout(() => {
    processEditOperations().catch(() => {});
  }, 5000);
  console.log('[EditDelivery] Started');
}
