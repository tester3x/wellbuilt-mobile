// src/services/editOpsDiagnostic.ts
//
// READ-ONLY production diagnostic for the durable edit-ops queue
// (@wellbuilt_edit_ops). It emits a sanitized snapshot of the persisted
// operation(s) — plus the pull-history marker and the exact server fate of
// each correction — to the console (and therefore logcat), so an opaque
// release build's persisted state can be inspected WITHOUT `run-as`, WITHOUT
// uninstalling, and WITHOUT any write.
//
// GUARANTEES (covered by editOpsDiagnostic.test.ts):
//   • Never calls AsyncStorage.setItem / removeItem / mergeItem / clear.
//   • Never calls upsertOp / saveOps / stampReceiptCheck / setPullEditStatus.
//   • Never mutates an EditOperation object it reads.
//   • Never touches the delivery scheduler (no start/schedule/deliver).
//   • Never invokes uploadEditPacket / ingestWbmEdit or any write callable.
// Its only side effect is console output. Reads used: AsyncStorage.getItem,
// getEditOperations (loadOps → getItem), getPullHistory (getItem), isOnline,
// getQueuedPackets, and readJsonPath (HTTP GET only).

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { readJsonPath } from './backendAccess';
import { getPullHistory } from './pullHistory';
import { isOnline, getQueuedPackets } from './packetQueue';
import {
  EditOperation,
  getEditOperations,
  isPermanentEditFailure,
  isDependencyBlockedEdit,
  shouldAutoAttemptEdit,
  EDIT_AUTO_BACKOFF_MS,
} from './editDelivery';

// Same literal the queue is stored under. Redeclared (not imported) so this
// diagnostic never widens editDelivery's public surface. Stable storage key.
const EDIT_OPS_KEY = '@wellbuilt_edit_ops';
const TAG = '[EditOpsDiag]';

/** Full SHA-256 hex of a string (evidence checksum). */
async function sha256(s: string): Promise<string> {
  try {
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);
  } catch {
    return 'sha_error';
  }
}

/** Non-reversible short fingerprint — used for identities we must NOT print raw
 *  (editEventId, opId). 12 hex chars = 48 bits, enough to correlate, useless to
 *  reconstruct. */
async function fp(s: string | undefined | null): Promise<string> {
  if (!s) return 'none';
  return (await sha256(s)).slice(0, 12);
}

/** UTF-8 byte length without Buffer (RN has no global Buffer). */
function byteLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** The receipt/server-correlation key — mirrors editDelivery.editCorrelationKey
 *  (private there) WITHOUT importing or mutating anything. */
function correlationKey(op: EditOperation): string {
  if (op.editEventId) return op.editEventId;
  const ts = (op.payload?.originalPacketTimestamp || '').slice(0, 15);
  return `edit_${ts}_${String(op.wellName || '').replace(/\s+/g, '')}`;
}

/** Read-only reproduction of shouldAutoAttemptEdit's inputs (does NOT call any
 *  mutation; the real gate function is imported and called too, for parity). */
function autoAttemptInputs(op: EditOperation, nowMs: number) {
  const terminal = op.state === 'edit_blocked' || op.state === 'edit_rejected' || op.state === 'edited';
  const permanent = isPermanentEditFailure(op.lastError);
  const freshNeverTried = !op.lastAttemptAt && op.attempts === 0;
  const waitIdx = Math.min(op.attempts, EDIT_AUTO_BACKOFF_MS.length - 1);
  const wait = EDIT_AUTO_BACKOFF_MS[waitIdx];
  const base = op.lastAttemptAt ?? op.updatedAt;
  const elapsed = nowMs - base;
  const backoffElapsed = elapsed >= wait;
  return { terminal, permanent, freshNeverTried, waitIdx, wait, base, elapsed, backoffElapsed };
}

/**
 * Reproduce, READ-ONLY, the exact branch processEditOperationsInner would take
 * for one edit_pending op this pass, and return a human label plus the server
 * reads it depends on. No writes, no scheduler, no upsert.
 */
async function reproduceHoldReason(
  op: EditOperation,
  allOps: EditOperation[],
  nowMs: number,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  if (op.state === 'edit_blocked') { out.branch = 'SKIP:edit_blocked (held, never sent)'; return out; }
  if (op.state === 'edit_rejected') { out.branch = 'SKIP:edit_rejected (terminal, evidence kept)'; return out; }
  if (op.state === 'edited') { out.branch = 'SKIP:edited (confirmed/terminal)'; return out; }

  if (op.state === 'edit_submitted') {
    out.branch = 'edit_submitted → confirmation recheck (never re-uploads)';
    const proc = await readJsonPath(`packets/processed/${op.originalPacketId}`, fetchFn);
    out.processedOriginalFound = proc.found;
    const key = correlationKey(op);
    const procEdit = await readJsonPath(`packets/processed/${key}`, fetchFn);
    const rejEdit = await readJsonPath(`packets/rejected/${key}`, fetchFn);
    out.processedEditFound = procEdit.found;
    out.rejectedEditFound = rejEdit.found;
    return out;
  }

  // edit_pending path — replicate each gate in order.
  const isEarlier = (o: EditOperation) =>
    o.createdAt < op.createdAt || (o.createdAt === op.createdAt && o.opId < op.opId);
  const earlierInFlight = allOps.some(o =>
    o.opId !== op.opId
    && o.originalPacketId === op.originalPacketId
    && isEarlier(o)
    && (o.state === 'edit_pending' || o.state === 'edit_submitted'));
  out.earlierInFlightSibling = earlierInFlight;
  if (earlierInFlight) { out.branch = 'HOLD:earlier in-flight sibling for same original'; return out; }

  const queue = await getQueuedPackets();
  const stillQueued = queue.some((p: any) => p.type === 'pull' && p.packetId === op.originalPacketId);
  out.originalStillLocallyQueued = stillQueued;
  if (stillQueued) { out.branch = 'HOLD:original still locally queued (in-place merge owns it)'; return out; }

  const online = await isOnline();
  out.online = online;
  if (!online) { out.branch = 'HOLD:offline'; return out; }

  const processed = await readJsonPath(`packets/processed/${op.originalPacketId}`, fetchFn);
  out.processedOriginalFound = processed.found;
  out.processedOriginalDiagnosis = processed.diagnosis ? processed.diagnosis.kind : null;

  if (!processed.found) {
    const readBlocked = !!processed.diagnosis
      && (processed.diagnosis.kind === 'auth_session' || processed.diagnosis.kind === 'permission');
    out.readBlocked = readBlocked;
    if (!readBlocked) {
      const rej = await readJsonPath(`packets/rejected/${op.originalPacketId}`, fetchFn);
      out.rejectedOriginalFound = rej.found;
      if (rej.found) { out.branch = 'BLOCK:original rejected by server → edit_blocked'; return out; }
      out.branch = 'HOLD:original not yet on server (recheck cadence)';
      return out;
    }
    // read-blocked → falls through to delivery (like read-success)
  }

  // Migration clear + shouldAutoAttemptEdit gate (this is where VC27/VC28 act).
  const inputs = autoAttemptInputs(op, nowMs);
  out.autoAttemptInputs = inputs;
  const migrationWouldClear = op.attempts === 0 && !!op.lastError;
  out.migrationWouldClearLastError = migrationWouldClear;
  // Post-migration effective lastError the gate would see:
  const effLastError = migrationWouldClear ? null : op.lastError;
  const gateRaw = shouldAutoAttemptEdit(op, nowMs);
  const gatePostMigration = shouldAutoAttemptEdit(
    { ...op, lastError: effLastError } as EditOperation,
    nowMs,
  );
  out.shouldAutoAttemptEdit_asStored = gateRaw;
  out.shouldAutoAttemptEdit_postMigration = gatePostMigration;
  if (!gatePostMigration) {
    out.branch = 'HOLD:shouldAutoAttemptEdit=false (permanent lastError or backoff not elapsed)';
    return out;
  }
  out.branch = 'DELIVER:would call uploadEditPacket/ingestWbmEdit this pass';
  return out;
}

let _ran = false;

/** Test-only: allow multiple snapshots across cases. Not used in production. */
export function __resetEditOpsDiagnosticForTest(): void { _ran = false; }

/**
 * Emit the full read-only snapshot. Safe to await at startup BEFORE
 * startEditDelivery(); swallows every error so it can never break boot.
 */
export async function logEditOpsDiagnostic(fetchFn: typeof fetch = fetch): Promise<void> {
  if (_ran) return; // one snapshot per process
  _ran = true;
  const nowMs = Date.now();
  try {
    console.log(`${TAG} ===== BEGIN read-only edit-ops snapshot @${new Date(nowMs).toISOString()} =====`);

    // 1. Raw record presence / checksum / byte length / decode status.
    let raw: string | null = null;
    try { raw = await AsyncStorage.getItem(EDIT_OPS_KEY); } catch (e: any) {
      console.log(`${TAG} RAW getItem threw:`, String(e?.message || e));
    }
    console.log(`${TAG} EDIT_OPS_KEY exists:`, raw != null);
    if (raw != null) {
      console.log(`${TAG} raw.byteLen:`, byteLen(raw), 'raw.sha256:', await sha256(raw));
      let decoded: unknown = undefined;
      let decodeOk = false;
      try { decoded = JSON.parse(raw); decodeOk = true; } catch (e: any) {
        console.log(`${TAG} JSON.parse FAILED (swallowed by loadOps → []):`, String(e?.message || e));
      }
      console.log(`${TAG} decodeOk:`, decodeOk, 'isArray:', Array.isArray(decoded),
        'count:', Array.isArray(decoded) ? decoded.length : 'n/a');
    }

    // 2. Parsed ops (via the real read path).
    const ops = await getEditOperations();
    console.log(`${TAG} getEditOperations count:`, ops.length);

    // 3. Pull-history marker (separate storage object).
    const history = await getPullHistory();
    const markedEntries = history.filter((e: any) => e.editStatus && e.editStatus !== 'edited');
    console.log(`${TAG} pullHistory entries:`, history.length,
      'with pending edit marker:', markedEntries.length);
    for (const e of markedEntries) {
      console.log(`${TAG} MARKER packetId=${e.packetId} id=${e.id} editStatus=${e.editStatus}`
        + ` reason=${JSON.stringify(e.editStatusReason || null)}`
        + ` top=${e.tankLevelFeet ?? '?'} bbls=${e.bblsTaken ?? '?'}`);
    }

    // 4. Per-op detail + server fate + reproduced hold reason.
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const permanent = isPermanentEditFailure(op.lastError);
      const depBlocked = isDependencyBlockedEdit(op.lastError);
      const key = correlationKey(op);
      console.log(`${TAG} --- OP[${i}] ---`);
      console.log(`${TAG} op.originalPacketId=${op.originalPacketId} well=${op.wellName}`);
      console.log(`${TAG} op.state=${op.state} attempts=${op.attempts} receiptChecks=${op.receiptChecks ?? 0}`);
      console.log(`${TAG} op.lastError=${JSON.stringify(op.lastError)} isPermanent=${permanent} isDependencyBlocked=${depBlocked}`);
      console.log(`${TAG} op.blockedReason=${JSON.stringify(op.blockedReason || null)} op.blockedCode=${JSON.stringify(op.blockedCode || null)} op.rejectionReason=${JSON.stringify(op.rejectionReason || null)}`);
      console.log(`${TAG} op.opId.fp=${await fp(op.opId)} op.editEventId.fp=${await fp(op.editEventId)} correlationKey.fp=${await fp(key)}`);
      console.log(`${TAG} op.createdAt=${op.createdAt} updatedAt=${op.updatedAt} lastAttemptAt=${op.lastAttemptAt ?? null} lastReceiptCheckAt=${op.lastReceiptCheckAt ?? null}`);
      const p = op.payload || ({} as any);
      console.log(`${TAG} payload.present=${!!op.payload} payload.tankLevelFeet=${p.tankLevelFeet} payload.bblsTaken=${p.bblsTaken} payload.wellDown=${p.wellDown} payload.dateTime=${JSON.stringify(p.dateTime)} payload.dateTimeUTC=${JSON.stringify(p.dateTimeUTC)} payload.origTs=${JSON.stringify(p.originalPacketTimestamp)}`);
      try {
        console.log(`${TAG} payload.sha256=${await sha256(JSON.stringify(op.payload ?? null))}`);
      } catch {}

      // marker ↔ op identity correlation
      const markerForOp = markedEntries.find((e: any) => e.packetId === op.originalPacketId || e.id === op.originalPacketId);
      console.log(`${TAG} op<->marker sameOriginal=${!!markerForOp}${markerForOp ? ` markerStatus=${markerForOp.editStatus}` : ''}`);

      // Server fate of THIS correction's event (read-only). The correlation key
      // IS the editEventId — never printed raw; only its fingerprint.
      const keyFp = await fp(key);
      try {
        const procEdit = await readJsonPath(`packets/processed/${key}`, fetchFn);
        const rejEdit = await readJsonPath(`packets/rejected/${key}`, fetchFn);
        console.log(`${TAG} server editReceipt key.fp=${keyFp} processed.found=${procEdit.found} rejected.found=${rejEdit.found} procDiag=${procEdit.diagnosis?.kind ?? null}`);
      } catch (e: any) {
        console.log(`${TAG} server editReceipt lookup threw:`, String(e?.message || e));
      }

      // getFieldCommandStatus is a known capability gap — record that, don't call
      // it (it throws unsupported_field_command by design).
      console.log(`${TAG} getFieldCommandStatus=UNAVAILABLE (client stub throws unsupported_field_command)`);

      // Reproduced this-pass branch.
      try {
        const reason = await reproduceHoldReason(op, ops, nowMs, fetchFn);
        console.log(`${TAG} REPRO ${JSON.stringify(reason)}`);
      } catch (e: any) {
        console.log(`${TAG} REPRO threw:`, String(e?.message || e));
      }
    }

    console.log(`${TAG} ===== END read-only edit-ops snapshot =====`);
  } catch (e: any) {
    // Never let the diagnostic break startup.
    try { console.log(`${TAG} FATAL (swallowed):`, String(e?.message || e)); } catch {}
  }
}
