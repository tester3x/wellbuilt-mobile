// WB-M rejected-pull recovery reconciliation proofs (Mechanism A, Gabriel 5).
// All storage/network mocked — no Firebase writes, no edit transmission.

const mockStore: Record<string, string> = {};
const mockOnline = { value: true };

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
    fetch: jest.fn(async () => ({ isConnected: mockOnline.value, isInternetReachable: mockOnline.value, type: 'cellular' })),
    addEventListener: jest.fn(() => () => undefined),
  },
}));

jest.mock('../firebase', () => ({
  uploadTankPacket: jest.fn(),
  uploadEditPacket: jest.fn(),
  mintPacketId: jest.fn((w: string) => `20260827_000000_${String(w).replace(/\s+/g, '')}_x`),
}));

jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => null),
  getDriverName: jest.fn(async () => null),
}));

import { uploadEditPacket } from '../firebase';
import { reconcileRecoveredRejections } from '../recoveryReconcile';
import {
  addPullToHistory, clearPullHistory, getPullHistory, setPullSyncStatus,
} from '../pullHistory';
import { getEditOperations } from '../editDelivery';
import { rememberSubmittedPayload, getSubmittedPayload } from '../packetQueue';
import { computeDeliveryCounts } from '../deliveryStatus';

const EDIT_OPS_KEY = '@wellbuilt_edit_ops';
const mockedUploadEdit = uploadEditPacket as jest.Mock;

const REJECTED = '20260827_062211_Gabriel5_lbuegt';
const REPLACEMENT = '20260827_140000_Gabriel5_rcv001';
const WELL = 'Gabriel 5';

const makeFetch = (paths: Record<string, unknown>) =>
  jest.fn(async (url: string) => {
    const m = String(url).match(/firebaseio\.com\/(.+)\.json/);
    return { ok: true, status: 200, json: async () => (m && m[1] in paths ? paths[m[1]] : null) } as unknown as Response;
  }) as unknown as typeof fetch;

// Server state AFTER Phase-1 recovery: rejected record annotated recovered, and
// the canonical PM replacement processed with provenance back to the rejected id.
const recoveredServer = () => ({
  [`packets/rejected/${REJECTED}`]: {
    packetId: REJECTED, reason: 'STALE_PULL_TIME',
    recoveredByPacketId: REPLACEMENT, recoveryStatus: 'recovered',
    packet: { wellName: WELL, bblsTaken: 60, dateTimeUTC: '2026-08-26T12:39:00.000Z' },
  },
  [`packets/processed/${REPLACEMENT}`]: {
    packetId: REPLACEMENT, wellName: WELL,
    dateTime: '8/26/2026 7:39 PM', dateTimeUTC: '2026-08-27T00:39:00.000Z',
    tankLevelFeet: 7, bblsTaken: 60, wellDown: false,
    recoveredFromPacketId: REJECTED,
  },
});

// Seed: the local AM row rejected, a dependent blocked edit op, retained payload.
const seedStrandedState = async () => {
  await addPullToHistory(WELL, '8/26/2026 7:39 AM', 7, 60, false, REJECTED.slice(0, 15), REJECTED, 'rejected');
  await setPullSyncStatus(REJECTED, 'rejected', { rejectionReason: 'STALE_PULL_TIME' });
  const now = 1000;
  mockStore[EDIT_OPS_KEY] = JSON.stringify([{
    opId: 'editop_uuid1', editEventId: 'editevt_uuid1',
    originalPacketId: REJECTED, wellName: WELL,
    payload: { originalPacketId: REJECTED, wellName: WELL, dateTimeUTC: '2026-08-27T00:39:00.000Z', tankLevelFeet: 7, bblsTaken: 60, wellDown: false },
    state: 'edit_blocked', blockedReason: 'Original pull was rejected by the server (STALE_PULL_TIME) — edit held for review.',
    createdAt: now, updatedAt: now, attempts: 0, lastAttemptAt: null, lastError: null,
  }]);
  await rememberSubmittedPayload(REJECTED, { packetId: REJECTED, wellName: WELL, bblsTaken: 60 });
};

beforeEach(async () => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockOnline.value = true;
  mockedUploadEdit.mockReset();
  await clearPullHistory();
});

describe('reconcileRecoveredRejections — happy path', () => {
  test('re-points to ONE corrected pull, resolves the edit WITHOUT sending, clears attention, forgets payload', async () => {
    await seedStrandedState();

    // Attention BEFORE (rejected pull + blocked edit).
    const before = computeDeliveryCounts([], await getPullHistory(), Date.now(), await getEditOperations());
    expect(before.attention).toBeGreaterThan(0);

    const res = await reconcileRecoveredRejections(makeFetch(recoveredServer()));
    expect(res.reconciled).toBe(1);

    // Exactly ONE corrected pull, under the replacement id, with PM values.
    const hist = await getPullHistory();
    expect(hist).toHaveLength(1);
    const row = hist[0];
    expect(row.packetId).toBe(REPLACEMENT);
    expect(row.dateTime).toBe('8/26/2026 7:39 PM');
    expect(row.bblsTaken).toBe(60);
    expect(row.tankLevelFeet).toBe(7);
    expect(row.syncStatus).toBe('sent');
    // Audit lineage preserved.
    expect(row.recoveredFromPacketId).toBe(REJECTED);

    // Edit resolved WITHOUT transmission.
    expect(mockedUploadEdit).not.toHaveBeenCalled();
    expect(await getEditOperations()).toHaveLength(0);

    // Check & recover can never resubmit the AM packet — payload forgotten.
    expect(await getSubmittedPayload(REJECTED)).toBeNull();

    // Attention cleared.
    const after = computeDeliveryCounts([], await getPullHistory(), Date.now(), await getEditOperations());
    expect(after.attention).toBe(0);
  });

  test('idempotent: a second reconcile pass is a no-op', async () => {
    await seedStrandedState();
    const fetch1 = makeFetch(recoveredServer());
    await reconcileRecoveredRejections(fetch1);
    const res2 = await reconcileRecoveredRejections(fetch1);
    // Nothing left to reconcile (row already 'sent', op gone).
    expect(res2.reconciled).toBe(0);
    expect(await getPullHistory()).toHaveLength(1);
  });
});

describe('reconcileRecoveredRejections — gating', () => {
  test('Needs attention does NOT clear without a processed replacement receipt', async () => {
    await seedStrandedState();
    // Rejected record marked recovered, but the replacement is NOT yet processed.
    const server = recoveredServer();
    delete (server as Record<string, unknown>)[`packets/processed/${REPLACEMENT}`];

    const res = await reconcileRecoveredRejections(makeFetch(server));
    expect(res.reconciled).toBe(0);

    const hist = await getPullHistory();
    expect(hist).toHaveLength(1);
    expect(hist[0].packetId).toBe(REJECTED);   // unchanged
    expect(hist[0].syncStatus).toBe('rejected');
    expect(await getEditOperations()).toHaveLength(1); // edit still held
    expect(mockedUploadEdit).not.toHaveBeenCalled();
  });

  test('no recovery marker yet → untouched', async () => {
    await seedStrandedState();
    const res = await reconcileRecoveredRejections(makeFetch({
      [`packets/rejected/${REJECTED}`]: { packetId: REJECTED, reason: 'STALE_PULL_TIME' }, // no recoveredByPacketId
    }));
    expect(res.reconciled).toBe(0);
    expect((await getPullHistory())[0].syncStatus).toBe('rejected');
  });

  test('read failure (offline) leaves everything untouched', async () => {
    await seedStrandedState();
    const failingFetch = (jest.fn(async () => { throw new Error('offline'); }) as unknown) as typeof fetch;
    const res = await reconcileRecoveredRejections(failingFetch);
    expect(res.reconciled).toBe(0);
    expect((await getPullHistory())[0].packetId).toBe(REJECTED);
    expect(await getEditOperations()).toHaveLength(1);
  });

  test('provenance mismatch (processed replacement points at a different original) → untouched', async () => {
    await seedStrandedState();
    const server = recoveredServer();
    (server as Record<string, Record<string, unknown>>)[`packets/processed/${REPLACEMENT}`].recoveredFromPacketId = 'some_other_rejected_id';
    const res = await reconcileRecoveredRejections(makeFetch(server));
    expect(res.reconciled).toBe(0);
    expect((await getPullHistory())[0].packetId).toBe(REJECTED);
  });
});

describe('reconcileRecoveredRejections — dedupe to one pull', () => {
  test('a pre-existing backfilled replacement row is collapsed with the re-pointed AM row', async () => {
    await seedStrandedState();
    // Simulate backfill having already added the processed PM replacement as a
    // separate row (would be AM + PM without dedupe).
    await addPullToHistory(WELL, '8/26/2026 7:39 PM', 7, 60, false, REPLACEMENT.slice(0, 15), REPLACEMENT, 'sent');
    expect(await getPullHistory()).toHaveLength(2);

    await reconcileRecoveredRejections(makeFetch(recoveredServer()));

    const hist = await getPullHistory();
    expect(hist).toHaveLength(1);               // exactly one corrected pull
    expect(hist[0].packetId).toBe(REPLACEMENT);
  });
});
