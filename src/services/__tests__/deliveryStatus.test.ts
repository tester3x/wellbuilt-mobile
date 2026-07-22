// Truthful delivery-status proofs (GS3): submitted ≠ sent; rejections are
// reconciled with their exact reason and preserved; badge counts are
// accurate; manual retry reuses the stable id; concurrent flushes cannot
// double-send. All storage/network mocked — no Firebase writes.

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
    return `20260722_13${String(mockMint.counter).padStart(4, '0')}_${String(wellName).replace(/\s+/g, '')}_d${mockMint.counter}`;
  }),
}));

jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => null),
  getDriverName: jest.fn(async () => null),
}));

import { uploadTankPacket } from '../firebase';
import {
  SUBMITTED_ATTENTION_MS,
  computeDeliveryCounts,
  getDeliveryItems,
  reconcileSubmittedPulls,
} from '../deliveryStatus';
import { SYNC_FAILED_THRESHOLD, flushQueue, retryPacketNow, smartUploadTankPacket } from '../packetQueue';
import { addPullToHistory, clearPullHistory, getPullHistory } from '../pullHistory';

const QUEUE_KEY = '@wellbuilt_packet_queue';
const mockedUploadTank = uploadTankPacket as jest.Mock;

const PID = '20260722_140214_Gunslinger3_2wvtd1';

const pullParams = (packetId: string) => ({
  packetId,
  wellName: 'Gunslinger 3',
  dateTime: '7/21/2026 12:06 PM',
  dateTimeUTC: '2026-07-21T17:06:00.000Z',
  tankLevelFeet: 11.583333333333334,
  bblsTaken: 170,
  wellDown: false,
});

/** fetch mock backed by a path→value map (null body = "not found"). */
const makeFetch = (paths: Record<string, unknown>) =>
  jest.fn(async (url: string) => {
    const m = String(url).match(/firebaseio\.com\/(.+)\.json/);
    const path = m ? m[1] : '';
    return {
      ok: true,
      json: async () => (path in paths ? paths[path] : null),
    } as any;
  }) as unknown as typeof fetch;

const rawQueue = (): any[] => (mockStore[QUEUE_KEY] ? JSON.parse(mockStore[QUEUE_KEY]) : []);

beforeEach(async () => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockOnline.value = true;
  mockedUploadTank.mockReset();
  await clearPullHistory();
});

describe('server-outcome reconciliation', () => {
  test('GS3 case: upload succeeded but server quarantined — history shows rejected with reason, NEVER sent', async () => {
    await addPullToHistory('Gunslinger 3', '7/21/2026 12:06 PM', 11.58, 170, false, PID.slice(0, 15), PID, 'submitted');
    const fetchFn = makeFetch({
      // NOT in processed — the stale guard consumed it…
      [`packets/rejected/${PID}`]: {
        packetId: PID,
        reason: 'STALE_PULL_TIME',
        readableReason: 'Incoming pull time 2026-07-21T17:06:00.000Z is not newer than the well watermark.',
      },
    });
    const r = await reconcileSubmittedPulls(fetchFn);
    expect(r.confirmedRejected).toBe(1);
    expect(r.confirmedSent).toBe(0);
    const entry = (await getPullHistory())[0];
    expect(entry.syncStatus).toBe('rejected');
    expect(entry.syncStatus).not.toBe('sent');
    expect(entry.rejectionReason).toContain('STALE_PULL_TIME');
    expect(entry.rejectionReason).toContain('not newer than the well watermark');
    // Evidence preserved: the entry itself is still fully present.
    expect(entry.bblsTaken).toBe(170);
  });

  test('processed acknowledgment flips submitted → sent with the server processedAt time', async () => {
    await addPullToHistory('Gunslinger 3', '7/21/2026 12:06 PM', 11.58, 170, false, PID.slice(0, 15), PID, 'submitted');
    const fetchFn = makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID, processedAt: '2026-07-22T19:02:17.988Z' },
    });
    const r = await reconcileSubmittedPulls(fetchFn);
    expect(r.confirmedSent).toBe(1);
    const entry = (await getPullHistory())[0];
    expect(entry.syncStatus).toBe('sent');
    expect(entry.sentConfirmedAt).toBe(new Date('2026-07-22T19:02:17.988Z').getTime());
  });

  test('no outcome yet stays submitted (preserved), and network errors change nothing', async () => {
    await addPullToHistory('Gunslinger 3', '7/21/2026 12:06 PM', 11.58, 170, false, PID.slice(0, 15), PID, 'submitted');
    const r1 = await reconcileSubmittedPulls(makeFetch({}));
    expect(r1.stillUnknown).toBe(1);
    expect((await getPullHistory())[0].syncStatus).toBe('submitted');
    const failingFetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await reconcileSubmittedPulls(failingFetch);
    expect((await getPullHistory())[0].syncStatus).toBe('submitted');
  });

  test('rejected packets are not auto-retried: not in the queue, no retry offered', async () => {
    await addPullToHistory('Gunslinger 3', '7/21/2026 12:06 PM', 11.58, 170, false, PID.slice(0, 15), PID, 'submitted');
    await reconcileSubmittedPulls(makeFetch({
      [`packets/rejected/${PID}`]: { reason: 'FUTURE_PULL_TIME', readableReason: 'ahead of server time' },
    }));
    expect(rawQueue()).toHaveLength(0); // nothing queued → nothing to auto-retry
    const items = await getDeliveryItems();
    const rejectedItem = items.find((i) => i.packetId === PID)!;
    expect(rejectedItem.status).toBe('rejected');
    expect(rejectedItem.canRetry).toBe(false);
    expect(rejectedItem.lastError).toContain('FUTURE_PULL_TIME');
  });
});

describe('badge counts', () => {
  test('accurate pending / failed / submitted-too-long / rejected counts', () => {
    const now = Date.now();
    const queue: any[] = [
      { id: 'q1', type: 'pull', data: {}, createdAt: 1, retryCount: 0, packetId: 'p1' },
      { id: 'q2', type: 'pull', data: {}, createdAt: 2, retryCount: SYNC_FAILED_THRESHOLD, packetId: 'p2' },
      { id: 'q3', type: 'edit', data: {}, createdAt: 3, retryCount: 1, packetId: null },
    ];
    const history: any[] = [
      { packetId: 'p3', syncStatus: 'submitted', submittedAt: now - SUBMITTED_ATTENTION_MS - 1000, sentAt: 0 },
      { packetId: 'p4', syncStatus: 'submitted', submittedAt: now - 1000, sentAt: 0 },
      { packetId: 'p5', syncStatus: 'rejected', sentAt: 0 },
      { packetId: 'p6', syncStatus: 'sent', sentAt: 0 },
      { packetId: 'p7', status: 'sent', sentAt: 0 }, // legacy, no syncStatus
    ];
    const c = computeDeliveryCounts(queue, history, now);
    expect(c).toEqual({
      pending: 2,          // q1 + q3 (below threshold)
      failed: 1,           // q2
      submittedTooLong: 1, // p3
      rejected: 1,         // p5
      attention: 3,
    });
  });

  test('legacy history entries without syncStatus never inflate the badge', () => {
    const c = computeDeliveryCounts([], [{ packetId: 'x', status: 'edited', sentAt: 0 } as any], Date.now());
    expect(c.attention).toBe(0);
    expect(c.pending).toBe(0);
  });
});

describe('manual retry + concurrency', () => {
  test('manual retry reuses the same stable packetId', async () => {
    mockOnline.value = false;
    await smartUploadTankPacket(pullParams(PID));
    mockOnline.value = true;
    mockedUploadTank.mockRejectedValueOnce(new Error('tower down'));
    await flushQueue();
    const q = rawQueue();
    expect(q[0].nextAttemptAt).toBeGreaterThan(Date.now()); // backing off
    mockedUploadTank.mockResolvedValueOnce({ packetId: PID });
    const r = await retryPacketNow(q[0].id);
    expect(r.attempted).toBe(true);
    expect(r.sent).toBe(1);
    const ids = mockedUploadTank.mock.calls.map((c2) => c2[0].packetId);
    expect(ids).toEqual([PID, PID]); // identical identity, no fresh mint
    expect(rawQueue()).toHaveLength(0);
  });

  test('retry of an unknown queue entry is a safe no-op', async () => {
    const r = await retryPacketNow('queued_never_existed');
    expect(r).toEqual({ attempted: false, sent: 0, failed: 0 });
    expect(mockedUploadTank).not.toHaveBeenCalled();
  });

  test('concurrent flush/manual retry cannot double-send the same packet', async () => {
    mockOnline.value = false;
    await smartUploadTankPacket(pullParams(PID));
    mockOnline.value = true;
    let resolveUpload: (v: any) => void;
    mockedUploadTank.mockImplementation(
      () => new Promise((res) => { resolveUpload = res; }),
    );
    const first = flushQueue();               // acquires the flush lock
    await new Promise((r) => setTimeout(r, 20));
    const second = flushQueue();              // must bounce off the lock
    const secondResult = await second;
    expect(secondResult).toEqual({ sent: 0, failed: 0 });
    resolveUpload!({ packetId: PID });
    await first;
    expect(mockedUploadTank).toHaveBeenCalledTimes(1); // exactly one send
  });
});

describe('persistence across restart', () => {
  test('statuses and queue metadata survive a simulated restart (fresh module state, same storage)', async () => {
    await addPullToHistory('Gunslinger 3', '7/21/2026 12:06 PM', 11.58, 170, false, PID.slice(0, 15), PID, 'submitted');
    await reconcileSubmittedPulls(makeFetch({
      [`packets/rejected/${PID}`]: { reason: 'STALE_PULL_TIME', readableReason: 'held' },
    }));
    // "Restart": drop all in-memory caches; storage is the only survivor.
    jest.resetModules();
    const freshHistory = require('../pullHistory') as typeof import('../pullHistory');
    const loaded = await freshHistory.loadPullHistory();
    const entry = loaded.find((e: any) => e.packetId === PID)!;
    expect(entry.syncStatus).toBe('rejected');
    expect(entry.rejectionReason).toContain('STALE_PULL_TIME');
  });
});
