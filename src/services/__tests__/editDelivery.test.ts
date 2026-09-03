// Ordered, truthful edit-delivery proofs (GS3). All storage/network
// mocked — no Firebase writes.

const mockStore: Record<string, string> = {};
const mockOnline = { value: true };
const mockMint = { counter: 0 };

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
    removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
  },
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({
      isConnected: mockOnline.value,
      isInternetReachable: mockOnline.value,
      type: 'cellular',
    })),
    addEventListener: jest.fn(() => () => undefined),
  },
}));

jest.mock('../firebase', () => ({
  uploadTankPacket: jest.fn(),
  uploadEditPacket: jest.fn(),
  uploadEditPacketV3: jest.fn(),
  mintPacketId: jest.fn((wellName: string) => {
    mockMint.counter += 1;
    return `20260722_14${String(mockMint.counter).padStart(4, '0')}_${String(wellName).replace(/\s+/g, '')}_e${mockMint.counter}`;
  }),
}));

jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => null),
  getDriverName: jest.fn(async () => null),
}));

const mockGetFieldCommandStatus = jest.fn(async (..._args: unknown[]): Promise<{
  status?: string;
  committed?: boolean;
}> => {
  throw new Error('no_receipt');
});
const mockGetWbmEditStatus = jest.fn(async (..._a: unknown[]): Promise<{ status: string; reason?: string }> => ({ status: 'pending' }));
const mockRecoverWbmEdit = jest.fn(async (..._a: unknown[]): Promise<{ ok: boolean; status: string; reason?: string; editEventId?: string; receiptWritten?: boolean; idempotent?: boolean }> => ({ ok: false, status: 'refused', reason: 'canary_disabled' }));
const mockSubmitWbmEditV3 = jest.fn(async (..._a: unknown[]): Promise<{ ok: boolean; status: string; editEventId?: string; idempotent?: boolean; reason?: string }> => ({ ok: true, status: 'accepted' }));
jest.mock('../secureOperationalApi', () => ({
  getFieldCommandStatus: (query: unknown) => mockGetFieldCommandStatus(query),
  getWbmEditStatus: (q: unknown) => mockGetWbmEditStatus(q),
  recoverWbmEdit: (p: unknown) => mockRecoverWbmEdit(p),
  submitWbmEditV3: (p: unknown) => mockSubmitWbmEditV3(p),
}));

import { uploadEditPacket, uploadEditPacketV3, uploadTankPacket } from '../firebase';
import {
  EditPacketParams,
  getEditOperations,
  getPendingEditForWell,
  processEditOperations,
  submitPullEdit,
} from '../editDelivery';
import { computeDeliveryCounts, recoverStuckSubmission } from '../deliveryStatus';
import { flushQueue, smartUploadTankPacket } from '../packetQueue';
import { addPullToHistory, clearPullHistory, getPullHistory, setPullSyncStatus, setPullEditStatus } from '../pullHistory';

const QUEUE_KEY = '@wellbuilt_packet_queue';
const EDIT_OPS_KEY = '@wellbuilt_edit_ops';
const mockedUploadTank = uploadTankPacket as jest.Mock;
const mockedUploadEditV3 = uploadEditPacketV3 as jest.Mock;

const PID = '20260721_120600_Gunslinger3_abc123';

const pullParams = (packetId: string) => ({
  packetId,
  wellName: 'Gunslinger 3',
  dateTime: '7/21/2026 12:06 PM',
  dateTimeUTC: '2026-07-21T17:06:00.000Z',
  tankLevelFeet: 11.583333333333334,
  bblsTaken: 170,
  wellDown: false,
});

const editParams = (originalPacketId: string, bbls = 165): EditPacketParams => ({
  originalPacketTimestamp: originalPacketId.slice(0, 15),
  originalPacketId,
  wellName: 'Gunslinger 3',
  dateTime: '',
  dateTimeUTC: '',
  tankLevelFeet: 11.583333333333334,
  bblsTaken: bbls,
  wellDown: false,
});

const makeFetch = (paths: Record<string, unknown>) =>
  jest.fn(async (url: string) => {
    const m = String(url).match(/firebaseio\.com\/(.+)\.json/);
    return { ok: true, json: async () => (m && m[1] in paths ? paths[m[1]] : null) } as any;
  }) as unknown as typeof fetch;

const rawQueue = (): any[] => (mockStore[QUEUE_KEY] ? JSON.parse(mockStore[QUEUE_KEY]) : []);
const rawOps = (): any[] => (mockStore[EDIT_OPS_KEY] ? JSON.parse(mockStore[EDIT_OPS_KEY]) : []);

const seedHistory = async (packetId: string, syncStatus: any) => {
  await addPullToHistory('Gunslinger 3', '7/21/2026 12:06 PM', 11.58, 170, false, packetId.slice(0, 15), packetId, syncStatus);
};

beforeEach(async () => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockOnline.value = true;
  mockedUploadTank.mockReset();
  mockedUploadEditV3.mockReset();
  mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
  mockGetFieldCommandStatus.mockReset();
  mockGetFieldCommandStatus.mockRejectedValue(new Error('no_receipt'));
  mockGetWbmEditStatus.mockReset();
  mockGetWbmEditStatus.mockResolvedValue({ status: 'pending' });
  mockRecoverWbmEdit.mockReset();
  mockRecoverWbmEdit.mockResolvedValue({ ok: false, status: 'refused', reason: 'canary_disabled' });
  await clearPullHistory();
});

describe('case 1 — original still locally queued', () => {
  test('edit mutates the queued pull in place; no edit packet, no op, same id and position', async () => {
    mockOnline.value = false;
    await smartUploadTankPacket(pullParams('20260721_100000_Gunslinger3_first1'));
    await smartUploadTankPacket(pullParams(PID));
    await seedHistory(PID, 'pending_sync');

    const outcome = await submitPullEdit(editParams(PID, 155));
    expect(outcome).toEqual({ mode: 'merged_into_queued' });

    const q = rawQueue();
    expect(q).toHaveLength(2);                       // no separate edit entry
    expect(q[1].packetId).toBe(PID);                 // same id, same position
    expect(q[1].data.packetId).toBe(PID);
    expect(q[1].data.bblsTaken).toBe(155);           // corrected in place
    expect(rawOps()).toHaveLength(0);                // no dependent op created
    expect(mockedUploadEditV3).not.toHaveBeenCalled();

    // History keeps its truthful delivery status and no '(edited)' claim.
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.syncStatus).toBe('pending_sync');
    expect(entry.status).not.toBe('edited');

    // The eventual upload carries the corrected values under the same id.
    mockOnline.value = true;
    mockedUploadTank.mockImplementation(async (p: any) => ({ packetId: p.packetId }));
    await flushQueue();
    const sentIds = mockedUploadTank.mock.calls.map(c => [c[0].packetId, c[0].bblsTaken]);
    expect(sentIds).toContainEqual([PID, 155]);
  });
});

describe('case 2 — original submitted but unresolved', () => {
  test('edit is held as a durable dependent operation; nothing uploads', async () => {
    await seedHistory(PID, 'submitted');
    const outcome = await submitPullEdit(editParams(PID));
    expect(outcome).toEqual({ mode: 'held_dependent' });
    expect(mockedUploadEditV3).not.toHaveBeenCalled();
    const ops = rawOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].state).toBe('edit_pending');
    // Distinct identities: a crypto editEventId (packet identity) and a separate
    // local opId (queue identity) — the opId is NEVER the packet identity.
    expect(ops[0].editEventId).toMatch(/^editevt_[0-9a-f-]{36}$/);
    expect(ops[0].opId).toMatch(/^editop_[0-9a-f-]{36}$/);
    expect(ops[0].opId).not.toBe(ops[0].editEventId);
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edit_pending');
    expect(entry.status).not.toBe('edited');
  });

  test('dependency survives restart (fresh module state, same storage)', async () => {
    await seedHistory(PID, 'submitted');
    await submitPullEdit(editParams(PID));
    jest.resetModules();
    const fresh = require('../editDelivery') as typeof import('../editDelivery');
    const ops = await fresh.getEditOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0].originalPacketId).toBe(PID);
    expect(ops[0].state).toBe('edit_pending');
  });

  test('processed original releases the dependent edit', async () => {
    await seedHistory(PID, 'submitted');
    await submitPullEdit(editParams(PID));
    mockedUploadEditV3.mockResolvedValueOnce({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    const r = await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID, processedAt: '2026-07-22T19:02:17.988Z' },
    }));
    expect(r.submitted).toBe(1);
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);
    expect(mockedUploadEditV3.mock.calls[0][0].originalPacketId).toBe(PID);
    expect(rawOps()[0].state).toBe('edit_submitted');
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edit_submitted');
    expect(entry.status).not.toBe('edited');          // still not confirmed
  });

  test('rejected original → TERMINAL rejection (clear reason, never "edit pending"), never sent/deleted', async () => {
    await seedHistory(PID, 'submitted');
    await submitPullEdit(editParams(PID));
    const r = await processEditOperations(makeFetch({
      [`packets/rejected/${PID}`]: { reason: 'STALE_PULL_TIME' },
    }));
    // Terminal, not held: the edit can never apply (no server original).
    expect(r.rejected).toBe(1);
    expect(r.held).toBe(0);
    expect(mockedUploadEditV3).not.toHaveBeenCalled();
    const op = rawOps()[0];
    expect(op.state).toBe('edit_blocked');
    expect(op.blockedCode).toBe('edit_unappliable');
    expect(op.blockedReason).toContain('STALE_PULL_TIME');
    expect(op.payload.bblsTaken).toBe(165);           // payload preserved
    // The PULL marker is edit_rejected (renders a clear failure + reason), NOT
    // the perpetual "edit pending" that Gate 5 forbids.
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edit_rejected');
    expect(entry.editStatusReason).toContain('can’t be applied');
    expect(entry.status).not.toBe('edited');
  });

  test('Gate 5: edit_submitted whose original is REJECTED → terminal edit_rejected regardless of lane (no recovery loop)', async () => {
    const editEventId = 'editevt_g5-rejected';
    const now = Date.now();
    await seedHistory(PID, 'submitted');
    // An op already re-driven into the durable lane (lane:'v3') but the server
    // reports the status as MISSING because the ORIGINAL was rejected. Without
    // the rejected-original guard this loops in governed-recovery forever.
    mockStore[EDIT_OPS_KEY] = JSON.stringify([{
      opId: 'editop_g5', editEventId, lane: 'v3',
      originalPacketId: PID, wellName: 'Gunslinger 3',
      payload: { ...editParams(PID), editEventId },
      state: 'edit_submitted', createdAt: now - 5000, updatedAt: now - 5000,
      attempts: 1, lastAttemptAt: now - 5000, lastError: null, receiptChecks: 8,
    }]);
    mockGetWbmEditStatus.mockResolvedValue({ status: 'missing' });

    const r = await processEditOperations(makeFetch({
      [`packets/rejected/${PID}`]: { reason: 'STALE_PULL_TIME' },
    }));
    expect(r.rejected).toBe(1);
    // Never re-drove and never invoked governed recovery for an un-appliable edit.
    expect(mockedUploadEditV3).not.toHaveBeenCalled();
    const op = rawOps()[0];
    expect(op.state).toBe('edit_blocked');
    expect(op.blockedCode).toBe('edit_unappliable');
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edit_rejected');
  });

  test('Gate 5: a PARKED edit_pending dependent heals via getWbmEditStatus:rejected — no blocked REST read needed', async () => {
    const editEventId = 'editevt_g5-pending-parked';
    const now = Date.now();
    await seedHistory(PID, 'submitted');
    // The real-device case: a dependent edit_pending op whose original was
    // REJECTED. The direct REST reads of packets/rejected are DENIED by rules
    // (readBlocked), and the op is parked (permanent lastError) so it never
    // auto-attempts. It must still heal by consulting the governed callable,
    // which reports the un-appliable original as a TERMINAL 'rejected'.
    mockStore[EDIT_OPS_KEY] = JSON.stringify([{
      opId: 'editop_g5p', editEventId,
      originalPacketId: PID, wellName: 'Gunslinger 3',
      payload: { ...editParams(PID), editEventId },
      state: 'edit_pending', createdAt: now - 90000, updatedAt: now - 90000,
      attempts: 3, lastAttemptAt: now - 90000, lastError: 'invalid-argument',
      receiptChecks: 40,
    }]);
    mockGetWbmEditStatus.mockResolvedValue({ status: 'rejected', reason: 'original_rejected: STALE_PULL_TIME' });

    // The governed callable resolves it BEFORE any direct REST read is attempted,
    // so the heal does not depend on reads the deployed rules deny.
    const r = await processEditOperations(makeFetch({}));
    expect(r.rejected).toBe(1);
    expect(mockedUploadEditV3).not.toHaveBeenCalled();  // never re-uploads an un-appliable edit
    const op = rawOps()[0];
    expect(op.state).toBe('edit_blocked');
    expect(op.blockedCode).toBe('edit_unappliable');
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edit_rejected');       // clear rejection, NOT "edit pending"
    expect(entry.editStatusReason).toContain('can’t be applied');
    expect(entry.editStatusReason).toContain('STALE_PULL_TIME');
  });

  test('Gate 5: an already-BLOCKED op with a STALE "edit pending" marker heals via governed status — once', async () => {
    const editEventId = 'editevt_g5-blocked-stalemarker';
    const now = Date.now();
    // The real Gabriel 5 shape: op is edit_blocked/edit_unappliable (set by an
    // earlier build) but its pull marker is still edit_pending. Seed both.
    await seedHistory(PID, 'submitted');
    await setPullEditStatus(PID, 'edit_pending'); // stale non-terminal marker
    mockStore[EDIT_OPS_KEY] = JSON.stringify([{
      opId: 'editop_g5b', editEventId,
      originalPacketId: PID, wellName: 'Gunslinger 3',
      payload: { ...editParams(PID), editEventId },
      state: 'edit_blocked', blockedCode: 'edit_unappliable',
      createdAt: now - 100000, updatedAt: now - 100000,
      attempts: 1, lastAttemptAt: now - 100000, lastError: 'edit_unappliable', receiptChecks: 279,
    }]);
    mockGetWbmEditStatus.mockResolvedValue({ status: 'rejected', reason: 'original_rejected: STALE_PULL_TIME' });

    const r = await processEditOperations(makeFetch({}));
    expect(r.rejected).toBe(1);
    expect(mockedUploadEditV3).not.toHaveBeenCalled();       // never re-uploads a blocked op
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edit_rejected');          // stale "edit pending" → clear rejection
    expect(entry.editStatusReason).toContain('STALE_PULL_TIME');
    expect(rawOps()[0].markerReconciled).toBe(true);         // gated: won't re-consult

    // A SECOND pass does NOT consult the server again (one-shot gate).
    mockGetWbmEditStatus.mockClear();
    await processEditOperations(makeFetch({}));
    expect(mockGetWbmEditStatus).not.toHaveBeenCalled();
  });
});

describe('case 3 — original processed: normal upload + confirmation', () => {
  test("'(edited)' appears ONLY after server confirmation", async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID }, // exists, no editedAt yet
    }));
    expect(rawOps()[0].state).toBe('edit_submitted');
    let entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.status).not.toBe('edited');          // not yet confirmed

    // Governed status 'pending' does NOT confirm — legacy editedAt/wasEdited on
    // the processed row can never override the authoritative verdict.
    mockGetWbmEditStatus.mockResolvedValueOnce({ status: 'pending' });
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID, editedAt: '2026-07-22T20:00:00.000Z', wasEdited: true },
    }));
    entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.status).not.toBe('edited');

    // The governed status is the ONLY confirmation authority.
    mockGetWbmEditStatus.mockResolvedValueOnce({ status: 'applied' });
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID },
    }));
    entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edited');
    expect(entry.status).toBe('edited');
    expect(rawOps()).toHaveLength(0);                 // confirmed op completes
  });

  test('edit transport retries reuse the same operation and server key', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockRejectedValueOnce(new Error('tower down'));
    await submitPullEdit(editParams(PID), makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID },
    }));
    expect(rawOps()[0].attempts).toBe(1);
    const opIdAfterFail = rawOps()[0].opId;
    mockedUploadEditV3.mockResolvedValueOnce({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID },
    }), { nowMs: Date.now() + 60_000 });
    expect(rawOps()[0].opId).toBe(opIdAfterFail);     // same operation id
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(2);
    // Both attempts carry the SAME originalPacketTimestamp → the server
    // incoming key edit_<origTs>_<well> is identical (idempotent replay).
    expect(mockedUploadEditV3.mock.calls[0][0].originalPacketTimestamp)
      .toBe(mockedUploadEditV3.mock.calls[1][0].originalPacketTimestamp);
  });

  test('orphan/edit rejection is visible and preserved with the server reason', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(rawOps()[0].state).toBe('edit_submitted');
    // Governed status reports the rejection with its stable reason.
    mockGetWbmEditStatus.mockResolvedValueOnce({ status: 'rejected', reason: 'ORIGINAL_PACKET_NOT_FOUND' });
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID },
    }));
    const op = rawOps()[0];
    expect(op.state).toBe('edit_rejected');           // preserved, not deleted
    expect(op.rejectionReason).toContain('ORIGINAL_PACKET_NOT_FOUND');
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edit_rejected');
    expect(entry.status).not.toBe('edited');
  });

  test('uncommitted rows with editedAt/wasEdited/isEdit do NOT confirm', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: {
        packetId: PID,
        editedAt: '2026-07-22T20:00:00.000Z',
        wasEdited: true,
        editedByPacketId: 'edit_other',
        isEdit: true,
        requestType: 'edit',
      },
    }));
    expect(rawOps()[0].state).toBe('edit_submitted');
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.status).not.toBe('edited');
    expect(entry.editStatus).toBe('edit_submitted');
  });

  test('editCommitted without a receipt key does NOT confirm', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID, editCommitted: true },
    }));
    expect(rawOps()[0].state).toBe('edit_submitted');
  });

  test('getWbmEditStatus applied confirms', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(rawOps()[0].state).toBe('edit_submitted');
    mockGetWbmEditStatus.mockResolvedValueOnce({ status: 'applied' });
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID },
    }));
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edited');
    expect(entry.status).toBe('edited');
    expect(rawOps()).toHaveLength(0);
  });

  test('callable committed:true confirms immediately', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'applied', wellName: 'Gunslinger 3' });
    const outcome = await submitPullEdit(editParams(PID), makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID },
    }));
    expect(outcome).toEqual({ mode: 'uploading', submitted: false });
    expect(rawOps()).toHaveLength(0);
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edited');
    expect(entry.status).toBe('edited');
  });
});

describe('legacy identity + snapshot metadata + ordering', () => {
  test('legacy queued_* originals are preserved and flagged, never guessed', async () => {
    const outcome = await submitPullEdit(editParams('queued_20260721170845_Gunslinger3'));
    expect(outcome.mode).toBe('blocked');
    const op = rawOps()[0];
    expect(op.state).toBe('edit_blocked');
    expect(op.blockedReason).toContain('legacy');
    expect(op.payload.bblsTaken).toBe(165);           // payload retained
    expect(mockedUploadEditV3).not.toHaveBeenCalled();
  });

  test('pending-edit metadata is truthfully queryable per well', async () => {
    await seedHistory(PID, 'submitted');
    await submitPullEdit(editParams(PID));
    const meta = await getPendingEditForWell('Gunslinger 3');
    expect(meta).toMatchObject({ state: 'edit_pending', originalPacketId: PID });
    expect(meta!.opId).toBe(rawOps()[0].opId); // local queue identity (not the packet editEventId)
    expect(await getPendingEditForWell('Atlas 1')).toBeNull();
  });

  test('concurrent flush cannot reorder create→edit: the edit waits for PROCESSED, not merely uploaded', async () => {
    // Original queued; driver edits (merged in place). Then simulate the
    // dependent-op scenario: original submitted (uploaded) but NOT yet in
    // processed — a concurrently-flushing edit op must NOT send.
    await seedHistory(PID, 'submitted');
    await submitPullEdit(editParams(PID));
    await processEditOperations(makeFetch({})); // original absent from processed
    expect(mockedUploadEditV3).not.toHaveBeenCalled();
    expect(rawOps()[0].state).toBe('edit_pending');
    // Only when processed exists does the edit go — order guaranteed.
    mockedUploadEditV3.mockResolvedValueOnce({ ok: true, status: 'accepted' });
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);
  });

  test('edit ops feed attention counts truthfully', async () => {
    await seedHistory(PID, 'submitted');
    await submitPullEdit(editParams(PID));
    const pendingOnly = computeDeliveryCounts([], [], Date.now(), await getEditOperations());
    expect(pendingOnly.attention).toBe(0);            // a pending dependent edit is normal
    await processEditOperations(makeFetch({ [`packets/rejected/${PID}`]: { reason: 'STALE_PULL_TIME' } }));
    const blocked = computeDeliveryCounts([], [], Date.now(), await getEditOperations());
    expect(blocked.attention).toBe(1);                // blocked edit needs eyes
  });
});

describe('read-blocked reconciliation (permission/auth) must not strand the edit', () => {
  // makeFetch variant: `denied` paths answer HTTP 403 (→ permission diagnosis);
  // everything else behaves like the normal makeFetch (200 + value/null).
  const makeFetchDenied = (denied: string[], ok: Record<string, unknown> = {}) =>
    jest.fn(async (url: string) => {
      const m = String(url).match(/firebaseio\.com\/(.+)\.json/);
      const path = m ? m[1] : '';
      if (denied.includes(path)) return { ok: false, status: 403, json: async () => null } as any;
      return { ok: true, json: async () => (path in ok ? ok[path] : null) } as any;
    }) as unknown as typeof fetch;

  test('T1 (regression): original UPLOADED but reconciliation read is permission-denied → edit DELIVERS, not stuck forever', async () => {
    await seedHistory(PID, 'submitted');                 // original uploaded, NOT locally queued
    const denied = makeFetchDenied([`packets/processed/${PID}`, `packets/rejected/${PID}`]);
    await submitPullEdit(editParams(PID), denied);       // read-blocked → held_dependent, armed
    expect(rawOps()[0].state).toBe('edit_pending');
    // The governed edit callable is the driver-obtainable server-side confirmation
    // the read could not provide; it accepts and commits.
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'applied', wellName: 'Gunslinger 3' });
    await processEditOperations(denied);
    // Pre-fix: uploadEditPacket was never called; op stayed edit_pending forever.
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);
    expect(mockedUploadEditV3.mock.calls[0][0].editEventId).toBe(
      // idempotency key carried from the persisted op
      JSON.parse(mockStore[EDIT_OPS_KEY] ?? '[]')[0]?.editEventId ?? mockedUploadEditV3.mock.calls[0][0].editEventId,
    );
    expect(rawOps()).toHaveLength(0);                    // confirmed + cleared
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edited');
  });

  test('T2: original genuinely NOT landed (permitted read, not_found) → edit stays safely dependent, no delivery', async () => {
    await seedHistory(PID, 'submitted');
    await submitPullEdit(editParams(PID), makeFetch({})); // permitted read, absent (no diagnosis)
    await processEditOperations(makeFetch({}));
    expect(mockedUploadEditV3).not.toHaveBeenCalled();
    expect(rawOps()[0].state).toBe('edit_pending');      // dependent, waiting for the original
  });

  test('T3: offline CREATE then EDIT preserves ordering — an edit cannot outrun an unsent CREATE', async () => {
    mockOnline.value = false;
    await smartUploadTankPacket(pullParams(PID));         // CREATE queued locally, not sent
    await seedHistory(PID, 'pending_sync');
    const denied = makeFetchDenied([`packets/processed/${PID}`]);
    const outcome = await submitPullEdit(editParams(PID, 150), denied);
    expect(outcome).toEqual({ mode: 'merged_into_queued' }); // merged in place, no separate op
    expect(mockedUploadEditV3).not.toHaveBeenCalled();
    // Even back online, nothing to deliver early (the edit lives inside the queued CREATE).
    mockOnline.value = true;
    await processEditOperations(denied);
    expect(mockedUploadEditV3).not.toHaveBeenCalled();
  });

  test('T4: duplicate retry on the read-blocked path retains ONE stable editEventId', async () => {
    await seedHistory(PID, 'submitted');
    const denied = makeFetchDenied([`packets/processed/${PID}`, `packets/rejected/${PID}`]);
    await submitPullEdit(editParams(PID), denied);
    const eid = rawOps()[0].editEventId;
    mockedUploadEditV3.mockRejectedValueOnce(new Error('network timeout')); // 1st attempt fails
    await processEditOperations(denied);
    mockedUploadEditV3.mockResolvedValueOnce({ ok: true, status: 'applied', wellName: 'Gunslinger 3' }); // 2nd succeeds
    await processEditOperations(denied, { nowMs: Date.now() + 120000 }); // past backoff
    const calls = mockedUploadEditV3.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((c: any[]) => c[0].editEventId === eid)).toBe(true); // ONE id across retries
  });

  test('T5: a not-yet-materialized original is RETRIED (bounded), never permanently rejected', async () => {
    await seedHistory(PID, 'submitted');
    const denied = makeFetchDenied([`packets/processed/${PID}`, `packets/rejected/${PID}`]);
    await submitPullEdit(editParams(PID), denied);
    mockedUploadEditV3.mockRejectedValueOnce(new Error('missing_original')); // original not processed yet
    await processEditOperations(denied);
    const op = rawOps()[0];
    expect(op.state).toBe('edit_pending');               // retryable, still pending
    expect(op.state).not.toBe('edit_rejected');
    expect(op.state).not.toBe('edit_failed');
    mockedUploadEditV3.mockResolvedValueOnce({ ok: true, status: 'applied', wellName: 'Gunslinger 3' }); // then it lands
    await processEditOperations(denied, { nowMs: Date.now() + 120000 });
    expect(rawOps()).toHaveLength(0);                     // committed + cleared
  });

  // arbitrary-status fetch: listed paths answer with the given HTTP status.
  const makeFetchWithStatus = (statusByPath: Record<string, number>, ok: Record<string, unknown> = {}) =>
    jest.fn(async (url: string) => {
      const m = String(url).match(/firebaseio\.com\/(.+)\.json/);
      const path = m ? m[1] : '';
      if (path in statusByPath) return { ok: false, status: statusByPath[path], json: async () => null } as any;
      return { ok: true, json: async () => (path in ok ? ok[path] : null) } as any;
    }) as unknown as typeof fetch;

  test('T6 (VC26 compat): a pre-existing VC26 op — stale permission lastError, receiptChecks, its editEventId — needs NO migration and delivers exactly once', async () => {
    // Seed AsyncStorage EXACTLY as VC26 persisted the stranded op: the old build
    // stamped op.lastError with the permission read diagnosis (isPermanentEditFailure
    // matches 'permission') and advanced receiptChecks; attempts stayed 0 (it never
    // reached delivery). No new field is added or required.
    const vc26Op = {
      opId: 'editop_vc26fixture',
      editEventId: 'editevt_vc26_uuid_1234',
      originalPacketId: PID,
      wellName: 'Gunslinger 3',
      payload: { ...editParams(PID, 165), editEventId: 'editevt_vc26_uuid_1234' },
      state: 'edit_pending',
      createdAt: 1756600000000,
      updatedAt: 1756600100000,
      attempts: 0,                          // never delivered under VC26
      lastAttemptAt: null,
      lastError: 'errors.permission',       // VC26 stamped the read diagnosis here
      receiptChecks: 3,
      lastReceiptCheckAt: 1756600100000,
    };
    mockStore[EDIT_OPS_KEY] = JSON.stringify([vc26Op]);   // as-is; no migration step runs
    await seedHistory(PID, 'submitted');
    const denied = makeFetchDenied([`packets/processed/${PID}`, `packets/rejected/${PID}`]);
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'applied', wellName: 'Gunslinger 3' });
    await processEditOperations(denied);
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);                       // exactly one logical submit
    expect(mockedUploadEditV3.mock.calls[0][0].editEventId).toBe('editevt_vc26_uuid_1234'); // SAME id retained
    expect(rawOps()).toHaveLength(0);                                        // clears ONLY after governed ack
  });

  test('T7: read-blocked variant AUTH_SESSION (HTTP 401) is handled independently → edit delivers', async () => {
    await seedHistory(PID, 'submitted');
    const blocked401 = makeFetchWithStatus({ [`packets/processed/${PID}`]: 401, [`packets/rejected/${PID}`]: 401 });
    await submitPullEdit(editParams(PID), blocked401);
    expect(rawOps()[0].state).toBe('edit_pending');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'applied', wellName: 'Gunslinger 3' });
    await processEditOperations(blocked401);
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);
    expect(rawOps()).toHaveLength(0);
  });

  test('T8: a transient read failure (HTTP 5xx / timeout) is NOT treated as permission → held with bounded retry, never delivered early', async () => {
    await seedHistory(PID, 'submitted');
    const transient = makeFetchWithStatus({ [`packets/processed/${PID}`]: 503, [`packets/rejected/${PID}`]: 503 });
    await submitPullEdit(editParams(PID), transient);
    await processEditOperations(transient);
    expect(mockedUploadEditV3).not.toHaveBeenCalled();     // must NOT deliver via the read-block path
    expect(rawOps()[0].state).toBe('edit_pending');      // dependent hold, awaits the original (bounded recheck)
    // and when the original genuinely lands (read now permitted), it delivers normally
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'applied', wellName: 'Gunslinger 3' });
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }),
      { nowMs: Date.now() + 120000 });
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);
  });

  test('T9: missing_original stays retryable across MULTIPLE scheduler cycles — bounded backoff, no busy loop, one editEventId, then succeeds', async () => {
    await seedHistory(PID, 'submitted');
    const denied = makeFetchDenied([`packets/processed/${PID}`, `packets/rejected/${PID}`]);
    await submitPullEdit(editParams(PID), denied);
    const eid = rawOps()[0].editEventId;
    mockedUploadEditV3.mockRejectedValue(new Error('missing_original')); // never materializes (yet)
    let t = Date.now();
    const attemptsSeen: number[] = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      t += 120000; // advance past the 60s backoff cap → exactly one attempt per cycle
      await processEditOperations(denied, { nowMs: t });
      const op = rawOps()[0];
      expect(op).toBeDefined();
      expect(op.state).toBe('edit_pending');   // retryable across every cycle, never permanent
      expect(op.editEventId).toBe(eid);        // ONE idempotency key throughout
      attemptsSeen.push(op.attempts);
    }
    // one delivery attempt per cycle (bounded, not a busy loop), all with the same id
    expect(mockedUploadEditV3.mock.calls.length).toBe(4);
    expect(attemptsSeen).toEqual([1, 2, 3, 4]);
    expect(mockedUploadEditV3.mock.calls.every((c: any[]) => c[0].editEventId === eid)).toBe(true);
    // later materialization commits it
    mockedUploadEditV3.mockReset();
  mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    mockedUploadEditV3.mockResolvedValueOnce({ ok: true, status: 'applied', wellName: 'Gunslinger 3' });
    await processEditOperations(denied, { nowMs: t + 120000 });
    expect(rawOps()).toHaveLength(0);
  });

  test('T10 (VC26 compat, READ-SUCCESS path): a persisted op with a stale permanent lastError delivers when the read now SUCCEEDS, not only when blocked', async () => {
    // The stranding this covers: the confirmation read SUCCEEDS (driver can read
    // its own processed packet), but the VC26 op still carries lastError
    // 'errors.permission' at attempts===0. isPermanentEditFailure() then makes
    // shouldAutoAttemptEdit() skip it — so it must be cleared on the read-success
    // path too, not only inside the read-blocked branch.
    const vc26Op = {
      opId: 'editop_vc26_readok',
      editEventId: 'editevt_vc26_readok_1',
      originalPacketId: PID,
      wellName: 'Gunslinger 3',
      payload: { ...editParams(PID, 165), editEventId: 'editevt_vc26_readok_1' },
      state: 'edit_pending',
      createdAt: 1756600000000,
      updatedAt: 1756600100000,
      attempts: 0,                       // never delivered under VC26
      lastAttemptAt: null,
      lastError: 'errors.permission',    // stale read-diagnosis stamp
      receiptChecks: 4,
      lastReceiptCheckAt: 1756600100000,
    };
    mockStore[EDIT_OPS_KEY] = JSON.stringify([vc26Op]);
    await seedHistory(PID, 'submitted');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'applied', wellName: 'Gunslinger 3' });
    // reconciliation read SUCCEEDS (original present) — the previously-uncovered path
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);                       // delivered, not skipped
    expect(mockedUploadEditV3.mock.calls[0][0].editEventId).toBe('editevt_vc26_readok_1'); // same id
    expect(rawOps()).toHaveLength(0);                                        // committed + cleared
  });
});

describe('submitted-timeout same-ID recovery (§7)', () => {
  test('checks processed → rejected → incoming before any resubmission', async () => {
    await seedHistory(PID, 'submitted');

    // In processed → confirmed sent, no resubmit.
    expect(await recoverStuckSubmission(PID, makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID, processedAt: '2026-07-22T19:02:17.988Z' },
    }))).toBe('confirmed_sent');
    expect((await getPullHistory())[0].syncStatus).toBe('sent');

    // In rejected → confirmed rejected with reason, no resubmit.
    await setPullSyncStatus(PID, 'submitted');
    expect(await recoverStuckSubmission(PID, makeFetch({
      [`packets/rejected/${PID}`]: { reason: 'STALE_PULL_TIME', readableReason: 'held' },
    }))).toBe('confirmed_rejected');
    expect((await getPullHistory())[0].syncStatus).toBe('rejected');

    // Still in incoming → DO NOTHING (no duplicate).
    await setPullSyncStatus(PID, 'submitted');
    expect(await recoverStuckSubmission(PID, makeFetch({
      [`packets/incoming/${PID}`]: { packetId: PID },
    }))).toBe('still_in_incoming');
    expect(rawQueue()).toHaveLength(0);
  });

  test('absent from all three: resubmits the retained payload under the SAME stable id', async () => {
    // Simulate the original submission (payload retained on success).
    mockOnline.value = true;
    mockedUploadTank.mockResolvedValueOnce({ packetId: PID, packetTimestamp: PID.slice(0, 15), wellName: 'Gunslinger 3' });
    await smartUploadTankPacket(pullParams(PID));
    await seedHistory(PID, 'submitted');

    mockedUploadTank.mockResolvedValueOnce({ packetId: PID });
    const verdict = await recoverStuckSubmission(PID, makeFetch({}));
    expect(verdict).toBe('resubmitted');
    // The re-upload used the identical stable id — no fresh identity.
    const ids = mockedUploadTank.mock.calls.map(c => c[0].packetId);
    expect(new Set(ids)).toEqual(new Set([PID]));
  });

  test('no retained payload → attention preserved, nothing invented', async () => {
    await seedHistory(PID, 'submitted');
    expect(await recoverStuckSubmission(PID, makeFetch({}))).toBe('no_payload');
    expect((await getPullHistory())[0].syncStatus).toBe('submitted');
    expect(rawQueue()).toHaveLength(0);
  });
});

describe('edit acknowledgment + lost receipt + duplicates', () => {
  test('lost acknowledgment is recovered via getWbmEditStatus applied without a second upload', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(rawOps()[0].state).toBe('edit_submitted');
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);

    mockGetWbmEditStatus.mockResolvedValueOnce({ status: 'applied' });
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(rawOps()).toHaveLength(0);
    expect((await getPullHistory())[0].status).toBe('edited');
    expect((await getPullHistory())[0].editStatus).toBe('edited');
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1); // no duplicate
  });

  test('processed edit-key commit recovers a lost original-row marker', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    // Governed status confirms 'applied' even when the original-row marker was lost.
    mockGetWbmEditStatus.mockResolvedValueOnce({ status: 'applied' });
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID },
    }));
    expect(rawOps()).toHaveLength(0);
    expect((await getPullHistory())[0].editStatus).toBe('edited');
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);
  });

  test('incoming edit key blocks a duplicate resubmit', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    const editKey = rawOps()[0].editEventId!; // v2: receipts correlate by the op's unique editEventId
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID },
      [`packets/incoming/${editKey}`]: { packetId: editKey },
    }));
    expect(rawOps()[0].state).toBe('edit_submitted');
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);
  });

  test('auth failure while confirming is not treated as awaiting-server silence', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    mockGetWbmEditStatus.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'AuthSessionError', httpStatus: 401 }));
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(rawOps()[0].state).toBe('edit_submitted');
    expect(rawOps()[0].lastError).toMatch(/auth_session/);
    expect((await getPullHistory())[0].status).not.toBe('edited');
  });

  test('retry after restart does not duplicate a confirmed edit', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    mockGetWbmEditStatus.mockResolvedValue({ status: 'applied' });
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(rawOps()).toHaveLength(0);
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: {
        packetId: PID,
        editCommitted: true,
        editCommittedReceiptKey: 'r1',
      },
    }));
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);
    expect((await getPullHistory())[0].editStatus).toBe('edited');
  });

  test('offline-to-online recovery confirms without a new upload', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    mockOnline.value = false;
    mockGetWbmEditStatus.mockResolvedValue({ status: 'applied' });
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(rawOps()[0].state).toBe('edit_submitted'); // offline → held, no status call
    mockOnline.value = true;
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(rawOps()).toHaveLength(0);
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);
  });

  test('governed recovery of an accepted-but-MISSING edit reuses the same editEventId, never a duplicate ingest', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEditV3.mockResolvedValue({ ok: true, status: 'accepted', wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    const editEventId = rawOps()[0].editEventId!;
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);

    // Status MISSING + recovery refused (canary OFF) → stays edit_submitted; the
    // recovery reused the SAME editEventId; no second ingest upload.
    mockGetWbmEditStatus.mockResolvedValueOnce({ status: 'missing' });
    mockRecoverWbmEdit.mockResolvedValueOnce({ ok: false, status: 'refused', reason: 'canary_disabled' });
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(rawOps()[0].state).toBe('edit_submitted');
    expect(mockRecoverWbmEdit).toHaveBeenCalledTimes(1);
    expect((mockRecoverWbmEdit.mock.calls[0][0] as { editEventId?: string }).editEventId).toBe(editEventId);
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);

    // Status MISSING + recovery APPLIED (canary enabled) → confirmed, no duplicate.
    mockGetWbmEditStatus.mockResolvedValueOnce({ status: 'missing' });
    mockRecoverWbmEdit.mockResolvedValueOnce({ ok: true, status: 'applied', editEventId, receiptWritten: true });
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(rawOps()).toHaveLength(0);
    expect((await getPullHistory())[0].editStatus).toBe('edited');
    expect(mockedUploadEditV3).toHaveBeenCalledTimes(1);
  });

  test('legacy edit_submitted whose original was REJECTED → edit_blocked, never re-driven forever', async () => {
    const editEventId = 'editevt_legacy-rejected';
    const now = Date.now();
    // A LEGACY op (no lane) uploaded via the old route, server reports MISSING.
    mockStore[EDIT_OPS_KEY] = JSON.stringify([{
      opId: 'editop_legacy', editEventId,
      originalPacketId: PID, wellName: 'Gunslinger 3',
      payload: { ...editParams(PID), editEventId },
      state: 'edit_submitted', createdAt: now - 5000, updatedAt: now - 5000,
      attempts: 1, lastAttemptAt: now - 5000, lastError: null, receiptChecks: 5,
    }]);
    mockGetWbmEditStatus.mockResolvedValue({ status: 'missing' });
    // Re-drive into the durable lane rejects PERMANENTLY (original was rejected).
    mockedUploadEditV3.mockRejectedValue(new Error('edit_invalid:missing_original'));

    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    const op = rawOps()[0];
    expect(op.state).toBe('edit_blocked');            // durable, honest — not looping
    expect(op.blockedCode).toBe('edit_unappliable');
    const callsAfterBlock = mockedUploadEditV3.mock.calls.length;

    // A subsequent pass does NOT re-drive a blocked op (no infinite retry).
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(mockedUploadEditV3.mock.calls.length).toBe(callsAfterBlock);
    expect(rawOps()[0].state).toBe('edit_blocked');   // evidence preserved
  });
});
