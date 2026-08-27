// recoveryReconcile.ts — WB-M side of Mechanism A rejected-pull recovery.
//
// When a locally-rejected pull (e.g. STALE_PULL_TIME from an AM/PM typo) has
// been recovered server-side by a corrected replacement CREATE, this brings the
// phone into agreement WITHOUT transmitting the stranded edit:
//
//   1. Read the rejected record's recovery marker (recoveredByPacketId).
//   2. Require packets/processed/<recoveredByPacketId> to EXIST before clearing
//      anything locally — a real authoritative receipt, never a guess.
//   3. Re-point the single local rejected row onto the canonical replacement id
//      with the corrected PM values (exactly one corrected pull — not AM + PM).
//   4. Resolve the dependent edit_blocked/edit_pending op WITHOUT sending it
//      (the corrected values are already canonical → a resend would duplicate).
//   5. forgetSubmittedPayload(rejectedId) so Check & recover can never resubmit
//      the rejected AM packet.
//
// "Needs attention" therefore clears only once the processed replacement exists.
// A read failure (offline / permission) leaves everything untouched.

import { readJsonPath } from './backendAccess';
import { getPullHistory, repointRecoveredPull } from './pullHistory';
import { getEditOperations, reconcileRecoveredEdits } from './editDelivery';
import { forgetSubmittedPayload } from './packetQueue';

export interface RecoveryReconcileResult {
  scanned: number;
  reconciled: number;
}

// Overlap guard: startup, flush, reconnect, login/SSO and the manual Sync Status
// refresh can all fire together — only one pass runs; concurrent callers join it.
let _inFlight: Promise<RecoveryReconcileResult> | null = null;

export async function reconcileRecoveredRejections(
  fetchFn: typeof fetch = fetch,
): Promise<RecoveryReconcileResult> {
  if (_inFlight) return _inFlight;
  _inFlight = reconcileRecoveredRejectionsInner(fetchFn).finally(() => { _inFlight = null; });
  return _inFlight;
}

async function reconcileRecoveredRejectionsInner(
  fetchFn: typeof fetch = fetch,
): Promise<RecoveryReconcileResult> {
  const [history, ops] = [await getPullHistory(), await getEditOperations()];

  // Candidate originals: locally-rejected pulls, plus the originals of edits
  // still blocked/pending on a base that never processed.
  const candidates = new Set<string>();
  for (const e of history) {
    if (e.syncStatus === 'rejected' && e.packetId) candidates.add(e.packetId);
  }
  for (const op of ops) {
    if ((op.state === 'edit_blocked' || op.state === 'edit_pending') && op.originalPacketId) {
      candidates.add(op.originalPacketId);
    }
  }

  let reconciled = 0;

  for (const rejectedId of candidates) {
    // 1. Recovery marker on the rejected record.
    const rejected = await readJsonPath(`packets/rejected/${rejectedId}`, fetchFn);
    if (!rejected.found || !rejected.data) continue; // absent or read-blocked → leave as-is
    const replacementId = (rejected.data as { recoveredByPacketId?: unknown }).recoveredByPacketId;
    if (typeof replacementId !== 'string' || !replacementId) continue; // not recovered yet

    // 2. Authoritative processed receipt REQUIRED before clearing anything.
    const processed = await readJsonPath(`packets/processed/${replacementId}`, fetchFn);
    if (!processed.found || !processed.data) continue;
    const p = processed.data as {
      dateTime?: string; tankLevelFeet?: number; bblsTaken?: number; wellDown?: boolean;
      recoveredFromPacketId?: unknown;
    };

    // Defensive: the processed replacement must point back to THIS rejected id.
    if (typeof p.recoveredFromPacketId === 'string' && p.recoveredFromPacketId !== rejectedId) continue;

    // 3. Re-point the single local row onto the canonical replacement.
    const repointed = await repointRecoveredPull(rejectedId, replacementId, {
      dateTime: typeof p.dateTime === 'string' ? p.dateTime : undefined,
      tankLevelFeet: typeof p.tankLevelFeet === 'number' ? p.tankLevelFeet : undefined,
      bblsTaken: typeof p.bblsTaken === 'number' ? p.bblsTaken : undefined,
      wellDown: typeof p.wellDown === 'boolean' ? p.wellDown : undefined,
    });

    // 4. Reconcile dependent edits against the authoritative processed receipt:
    //    supersede represented ones without sending; re-target later distinct
    //    corrections onto the replacement pull (never discard intent).
    const editOutcome = await reconcileRecoveredEdits(rejectedId, replacementId, {
      tankLevelFeet: typeof p.tankLevelFeet === 'number' ? p.tankLevelFeet : undefined,
      bblsTaken: typeof p.bblsTaken === 'number' ? p.bblsTaken : undefined,
      wellDown: typeof p.wellDown === 'boolean' ? p.wellDown : undefined,
      dateTimeUTC: typeof (p as { dateTimeUTC?: unknown }).dateTimeUTC === 'string'
        ? (p as { dateTimeUTC?: string }).dateTimeUTC : undefined,
    });

    // 5. Forget the retained AM payload so Check & recover cannot resubmit it.
    await forgetSubmittedPayload(rejectedId);

    if (repointed || editOutcome.resolved > 0 || editOutcome.retargeted > 0) reconciled++;
  }

  return { scanned: candidates.size, reconciled };
}
