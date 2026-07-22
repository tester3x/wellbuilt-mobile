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
  mintPacketId: jest.fn((wellName: string) => {
    mockMint.counter += 1;
    return `20260722_14${String(mockMint.counter).padStart(4, '0')}_${String(wellName).replace(/\s+/g, '')}_e${mockMint.counter}`;
  }),
}));

jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => null),
  getDriverName: jest.fn(async () => null),
}));

import { uploadEditPacket, uploadTankPacket } from '../firebase';
import {
  EditPacketParams,
  getEditOperations,
  getPendingEditForWell,
  processEditOperations,
  submitPullEdit,
} from '../editDelivery';
import { computeDeliveryCounts, recoverStuckSubmission } from '../deliveryStatus';
import { flushQueue, smartUploadTankPacket } from '../packetQueue';
import { addPullToHistory, clearPullHistory, getPullHistory, setPullSyncStatus } from '../pullHistory';

const QUEUE_KEY = '@wellbuilt_packet_queue';
const EDIT_OPS_KEY = '@wellbuilt_edit_ops';
const mockedUploadTank = uploadTankPacket as jest.Mock;
const mockedUploadEdit = uploadEditPacket as jest.Mock;

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
  mockedUploadEdit.mockReset();
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
    expect(mockedUploadEdit).not.toHaveBeenCalled();

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
    expect(mockedUploadEdit).not.toHaveBeenCalled();
    const ops = rawOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].state).toBe('edit_pending');
    expect(ops[0].opId).toBe(`editop_${PID}`);       // stable op identity
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
    mockedUploadEdit.mockResolvedValueOnce({ wellName: 'Gunslinger 3' });
    const r = await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID, processedAt: '2026-07-22T19:02:17.988Z' },
    }));
    expect(r.submitted).toBe(1);
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);
    expect(mockedUploadEdit.mock.calls[0][0].originalPacketId).toBe(PID);
    expect(rawOps()[0].state).toBe('edit_submitted');
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edit_submitted');
    expect(entry.status).not.toBe('edited');          // still not confirmed
  });

  test('rejected original blocks the edit with attention — never sent, never deleted', async () => {
    await seedHistory(PID, 'submitted');
    await submitPullEdit(editParams(PID));
    const r = await processEditOperations(makeFetch({
      [`packets/rejected/${PID}`]: { reason: 'STALE_PULL_TIME' },
    }));
    expect(r.held).toBe(1);
    expect(mockedUploadEdit).not.toHaveBeenCalled();
    const op = rawOps()[0];
    expect(op.state).toBe('edit_blocked');
    expect(op.blockedReason).toContain('STALE_PULL_TIME');
    expect(op.payload.bblsTaken).toBe(165);           // payload preserved
  });
});

describe('case 3 — original processed: normal upload + confirmation', () => {
  test("'(edited)' appears ONLY after server confirmation", async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEdit.mockResolvedValue({ wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID }, // exists, no editedAt yet
    }));
    expect(rawOps()[0].state).toBe('edit_submitted');
    let entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.status).not.toBe('edited');          // not yet confirmed

    // Server applies the edit → editedAt appears → NOW it's '(edited)'.
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID, editedAt: '2026-07-22T20:00:00.000Z' },
    }));
    entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edited');
    expect(entry.status).toBe('edited');
    expect(rawOps()).toHaveLength(0);                 // confirmed op completes
  });

  test('edit transport retries reuse the same operation and server key', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEdit.mockRejectedValueOnce(new Error('tower down'));
    await submitPullEdit(editParams(PID), makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID },
    }));
    expect(rawOps()[0].attempts).toBe(1);
    const opIdAfterFail = rawOps()[0].opId;
    mockedUploadEdit.mockResolvedValueOnce({ wellName: 'Gunslinger 3' });
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID },
    }));
    expect(rawOps()[0].opId).toBe(opIdAfterFail);     // same operation id
    expect(mockedUploadEdit).toHaveBeenCalledTimes(2);
    // Both attempts carry the SAME originalPacketTimestamp → the server
    // incoming key edit_<origTs>_<well> is identical (idempotent replay).
    expect(mockedUploadEdit.mock.calls[0][0].originalPacketTimestamp)
      .toBe(mockedUploadEdit.mock.calls[1][0].originalPacketTimestamp);
  });

  test('orphan/edit rejection is visible and preserved with the server reason', async () => {
    await seedHistory(PID, 'sent');
    mockedUploadEdit.mockResolvedValue({ wellName: 'Gunslinger 3' });
    await submitPullEdit(editParams(PID), makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(rawOps()[0].state).toBe('edit_submitted');
    const editKey = `edit_${PID.slice(0, 15)}_Gunslinger3`;
    await processEditOperations(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID }, // no editedAt
      [`packets/rejected/${editKey}`]: { reason: 'ORIGINAL_PACKET_NOT_FOUND', readableReason: 'original missing' },
    }));
    const op = rawOps()[0];
    expect(op.state).toBe('edit_rejected');           // preserved, not deleted
    expect(op.rejectionReason).toContain('ORIGINAL_PACKET_NOT_FOUND');
    const entry = (await getPullHistory()).find(e => e.packetId === PID)!;
    expect(entry.editStatus).toBe('edit_rejected');
    expect(entry.status).not.toBe('edited');
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
    expect(mockedUploadEdit).not.toHaveBeenCalled();
  });

  test('pending-edit metadata is truthfully queryable per well', async () => {
    await seedHistory(PID, 'submitted');
    await submitPullEdit(editParams(PID));
    const meta = await getPendingEditForWell('Gunslinger 3');
    expect(meta).toEqual({ opId: `editop_${PID}`, state: 'edit_pending', originalPacketId: PID });
    expect(await getPendingEditForWell('Atlas 1')).toBeNull();
  });

  test('concurrent flush cannot reorder create→edit: the edit waits for PROCESSED, not merely uploaded', async () => {
    // Original queued; driver edits (merged in place). Then simulate the
    // dependent-op scenario: original submitted (uploaded) but NOT yet in
    // processed — a concurrently-flushing edit op must NOT send.
    await seedHistory(PID, 'submitted');
    await submitPullEdit(editParams(PID));
    await processEditOperations(makeFetch({})); // original absent from processed
    expect(mockedUploadEdit).not.toHaveBeenCalled();
    expect(rawOps()[0].state).toBe('edit_pending');
    // Only when processed exists does the edit go — order guaranteed.
    mockedUploadEdit.mockResolvedValueOnce({});
    await processEditOperations(makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }));
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);
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
