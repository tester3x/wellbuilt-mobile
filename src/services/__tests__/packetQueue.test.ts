// Durable-queue + stable-identity proofs (GS3 follow-up).
// AsyncStorage/NetInfo/firebase/driverAuth are mocked; no Firebase writes.

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
    return `20260722_12${String(mockMint.counter).padStart(4, '0')}_${String(wellName).replace(/\s+/g, '')}_t${mockMint.counter}`;
  }),
}));

jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => null),
  getDriverName: jest.fn(async () => null),
}));

import { uploadTankPacket, uploadEditPacket } from '../firebase';
import {
  SYNC_FAILED_THRESHOLD,
  computeBackoffMs,
  flushQueue,
  getQueuedPackets,
  smartUploadEditPacket,
  smartUploadTankPacket,
} from '../packetQueue';
import { addPullToHistory, clearPullHistory, getPullHistory, loadPullHistory, setPullSyncStatus } from '../pullHistory';

const QUEUE_KEY = '@wellbuilt_packet_queue';
const HISTORY_KEY = '@wellbuilt_pull_history';
const mockedUploadTank = uploadTankPacket as jest.Mock;
const mockedUploadEdit = uploadEditPacket as jest.Mock;

const pullParams = (packetId: string | undefined, wellName = 'Gunslinger 3') => ({
  packetId,
  wellName,
  dateTime: '7/21/2026 12:06 PM',
  dateTimeUTC: '2026-07-21T17:06:00.000Z',
  tankLevelFeet: 11.583333333333334,
  bblsTaken: 170,
  wellDown: false,
});

/** Read the queue RAW from mock storage (no migration side effects). */
const rawQueue = (): any[] => (mockStore[QUEUE_KEY] ? JSON.parse(mockStore[QUEUE_KEY]) : []);
/** Clear per-packet backoff so the next flush attempts immediately. */
const resetBackoff = () => {
  const q = rawQueue().map((p) => ({ ...p, nextAttemptAt: null }));
  mockStore[QUEUE_KEY] = JSON.stringify(q);
};

beforeEach(async () => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockOnline.value = true;
  mockedUploadTank.mockReset();
  mockedUploadEdit.mockReset();
  await clearPullHistory();
});

describe('stable packet identity', () => {
  test('1. online submission uses ONE id through upload and result', async () => {
    mockedUploadTank.mockImplementation(async (p: any) => ({
      packetId: p.packetId,
      packetTimestamp: p.packetId.slice(0, 15),
      wellName: p.wellName,
      packet: p,
      fileName: 'x',
    }));
    const r = await smartUploadTankPacket(pullParams('20260721_120600_Gunslinger3_abc123'));
    expect(r.success).toBe(true);
    expect(r.packetId).toBe('20260721_120600_Gunslinger3_abc123');
    expect(mockedUploadTank).toHaveBeenCalledTimes(1);
    expect(mockedUploadTank.mock.calls[0][0].packetId).toBe('20260721_120600_Gunslinger3_abc123');
  });

  test('2. offline submission carries the same id in queue entry, payload, and result', async () => {
    mockOnline.value = false;
    const r = await smartUploadTankPacket(pullParams('20260721_120600_Gunslinger3_abc123'));
    expect(r.queued).toBe(true);
    expect(r.packetId).toBe('20260721_120600_Gunslinger3_abc123');
    expect(r.packetTimestamp).toBe('20260721_120600');
    const q = rawQueue();
    expect(q).toHaveLength(1);
    expect(q[0].packetId).toBe('20260721_120600_Gunslinger3_abc123');
    expect(q[0].data.packetId).toBe('20260721_120600_Gunslinger3_abc123');
    expect(mockedUploadTank).not.toHaveBeenCalled();
  });

  test('an id is minted exactly once when the caller supplies none', async () => {
    mockOnline.value = false;
    const before = mockMint.counter;
    const r = await smartUploadTankPacket(pullParams(undefined));
    expect(mockMint.counter).toBe(before + 1);
    expect(r.packetId).toMatch(/^20260722_12\d{4}_Gunslinger3_t\d+$/);
    expect(rawQueue()[0].packetId).toBe(r.packetId);
  });

  test('3. replay uses the identical id — never a fresh one', async () => {
    mockOnline.value = false;
    await smartUploadTankPacket(pullParams('20260721_120600_Gunslinger3_abc123'));
    mockOnline.value = true;
    mockedUploadTank.mockResolvedValue({ packetId: 'ignored' });
    const minted = mockMint.counter;
    await flushQueue();
    expect(mockedUploadTank).toHaveBeenCalledTimes(1);
    expect(mockedUploadTank.mock.calls[0][0].packetId).toBe('20260721_120600_Gunslinger3_abc123');
    expect(mockMint.counter).toBe(minted); // replay minted nothing
    expect(rawQueue()).toHaveLength(0);
  });

  test('11. duplicate replay of the same id is idempotent (timeout-after-landing case)', async () => {
    mockOnline.value = false;
    await smartUploadTankPacket(pullParams('20260721_120600_Gunslinger3_abc123'));
    mockOnline.value = true;
    // First attempt: server got the PUT but the client saw a timeout.
    mockedUploadTank.mockRejectedValueOnce(new Error('timeout'));
    await flushQueue();
    expect(rawQueue()).toHaveLength(1); // retained with retry metadata
    resetBackoff();
    mockedUploadTank.mockResolvedValueOnce({ packetId: 'ok' });
    await flushQueue();
    expect(mockedUploadTank).toHaveBeenCalledTimes(2);
    const ids = mockedUploadTank.mock.calls.map((c) => c[0].packetId);
    expect(ids[0]).toBe(ids[1]); // identical identity both times
  });
});

describe('never silently discard', () => {
  test('4. five failures retain the packet and mark history sync_failed', async () => {
    const pid = '20260721_120600_Gunslinger3_abc123';
    await addPullToHistory('Gunslinger 3', '7/21/2026 12:06 PM', 11.58, 170, false, pid.slice(0, 15), pid, 'pending_sync');
    mockOnline.value = false;
    await smartUploadTankPacket(pullParams(pid));
    mockOnline.value = true;
    mockedUploadTank.mockRejectedValue(new Error('server unreachable'));
    for (let i = 0; i < SYNC_FAILED_THRESHOLD; i++) {
      resetBackoff();
      await flushQueue();
    }
    const q = rawQueue();
    expect(q).toHaveLength(1); // STILL QUEUED — attention, not deletion
    expect(q[0].retryCount).toBe(SYNC_FAILED_THRESHOLD);
    expect(q[0].lastError).toContain('server unreachable');
    expect(q[0].lastAttemptAt).toBeGreaterThan(0);
    expect(q[0].nextAttemptAt).toBeGreaterThan(Date.now());
    const entry = (await getPullHistory()).find((e) => e.packetId === pid)!;
    expect(entry.syncStatus).toBe('sync_failed');
  });

  test('5. a packet older than 24 hours is retained and still sent', async () => {
    const pid = '20260720_100000_Gunslinger3_old111';
    const old = Date.now() - 25 * 60 * 60 * 1000;
    mockStore[QUEUE_KEY] = JSON.stringify([
      { id: 'queued_old', type: 'pull', data: pullParams(pid), createdAt: old, retryCount: 3, packetId: pid, firstQueuedAt: old, nextAttemptAt: null },
    ]);
    mockedUploadTank.mockRejectedValueOnce(new Error('still failing'));
    await flushQueue();
    expect(rawQueue()).toHaveLength(1); // 24h rule no longer discards
    resetBackoff();
    mockedUploadTank.mockResolvedValueOnce({ packetId: 'ok' });
    await flushQueue();
    expect(rawQueue()).toHaveLength(0); // eventually confirmed sent
    expect(mockedUploadTank.mock.calls[1][0].packetId).toBe(pid);
  });

  test('6. an offline flush consumes no retry attempt', async () => {
    mockOnline.value = false;
    await smartUploadTankPacket(pullParams('20260721_120600_Gunslinger3_abc123'));
    await flushQueue();
    await flushQueue();
    const q = rawQueue();
    expect(q[0].retryCount).toBe(0);
    expect(q[0].lastAttemptAt).toBeNull();
    expect(mockedUploadTank).not.toHaveBeenCalled();
  });

  test('backoff is exponential and capped', () => {
    expect(computeBackoffMs(1)).toBe(30_000);
    expect(computeBackoffMs(2)).toBe(60_000);
    expect(computeBackoffMs(20)).toBe(30 * 60 * 1000);
  });
});

describe('per-packet persistence (crash safety)', () => {
  const pidA = '20260721_100000_Gunslinger3_aaa111';
  const pidB = '20260721_110000_Gunslinger3_bbb222';

  const seedTwo = () => {
    mockStore[QUEUE_KEY] = JSON.stringify([
      { id: 'qA', type: 'pull', data: pullParams(pidA), createdAt: 1000, retryCount: 0, packetId: pidA, firstQueuedAt: 1000 },
      { id: 'qB', type: 'pull', data: pullParams(pidB), createdAt: 2000, retryCount: 0, packetId: pidB, firstQueuedAt: 2000 },
    ]);
  };

  test('7. a successful removal is persisted BEFORE the next packet is attempted', async () => {
    seedTwo();
    const queueDuringB: any[] = [];
    mockedUploadTank.mockImplementation(async (p: any) => {
      if (p.packetId === pidB) queueDuringB.push(...rawQueue());
      return { packetId: p.packetId };
    });
    await flushQueue();
    // While B was uploading, A was ALREADY gone from durable storage.
    expect(queueDuringB.some((e) => e.packetId === pidA)).toBe(false);
    expect(queueDuringB.some((e) => e.packetId === pidB)).toBe(true);
  });

  test('8. failed retry metadata is persisted BEFORE the next packet is attempted', async () => {
    seedTwo();
    const aStateDuringB: any[] = [];
    mockedUploadTank.mockImplementation(async (p: any) => {
      if (p.packetId === pidA) throw new Error('A failed');
      aStateDuringB.push(rawQueue().find((e) => e.packetId === pidA));
      return { packetId: p.packetId };
    });
    await flushQueue();
    expect(aStateDuringB[0].retryCount).toBe(1);
    expect(aStateDuringB[0].lastError).toContain('A failed');
    expect(aStateDuringB[0].nextAttemptAt).toBeGreaterThan(0);
  });

  test('9. a crash between items cannot resurrect a successfully removed packet', async () => {
    seedTwo();
    // A succeeds; then the app "crashes" mid-flush (B upload throws hard).
    mockedUploadTank.mockImplementation(async (p: any) => {
      if (p.packetId === pidA) return { packetId: pidA };
      throw new Error('crash-ish failure');
    });
    await flushQueue();
    // Restart: flush again with everything succeeding.
    resetBackoff();
    mockedUploadTank.mockClear();
    mockedUploadTank.mockImplementation(async (p: any) => ({ packetId: p.packetId }));
    await flushQueue();
    const idsSent = mockedUploadTank.mock.calls.map((c) => c[0].packetId);
    expect(idsSent).toEqual([pidB]); // A is gone for good — never re-sent
    expect(rawQueue()).toHaveLength(0);
  });

  test('12. queue ordering remains oldest-first', async () => {
    mockStore[QUEUE_KEY] = JSON.stringify([
      { id: 'q3', type: 'pull', data: pullParams('20260721_030000_Gunslinger3_c3'), createdAt: 3000, retryCount: 0, packetId: '20260721_030000_Gunslinger3_c3', firstQueuedAt: 3000 },
      { id: 'q1', type: 'pull', data: pullParams('20260721_010000_Gunslinger3_c1'), createdAt: 1000, retryCount: 0, packetId: '20260721_010000_Gunslinger3_c1', firstQueuedAt: 1000 },
      { id: 'q2', type: 'pull', data: pullParams('20260721_020000_Gunslinger3_c2'), createdAt: 2000, retryCount: 0, packetId: '20260721_020000_Gunslinger3_c2', firstQueuedAt: 2000 },
    ]);
    mockedUploadTank.mockImplementation(async (p: any) => ({ packetId: p.packetId }));
    await flushQueue();
    expect(mockedUploadTank.mock.calls.map((c) => c[0].packetId)).toEqual([
      '20260721_010000_Gunslinger3_c1',
      '20260721_020000_Gunslinger3_c2',
      '20260721_030000_Gunslinger3_c3',
    ]);
  });
});

describe('legacy migration', () => {
  test('10. a legacy queue entry receives ONE durable id and keeps it across retries/restarts', async () => {
    mockStore[QUEUE_KEY] = JSON.stringify([
      { id: 'queued_1721598000000_x1y2z3', type: 'pull', data: { wellName: 'Gunslinger 3', dateTimeUTC: '2026-07-21T17:06:00.000Z', bblsTaken: 170, tankLevelFeet: 11.58 }, createdAt: 555, retryCount: 2 },
    ]);
    const before = mockMint.counter;
    const q1 = await getQueuedPackets();
    expect(mockMint.counter).toBe(before + 1); // minted exactly once
    const assigned = q1[0].packetId!;
    expect(assigned).toContain('Gunslinger3');
    expect(q1[0].data.packetId).toBe(assigned);
    // Payload/metadata/ordering preserved.
    expect(q1[0].data.bblsTaken).toBe(170);
    expect(q1[0].retryCount).toBe(2);
    expect(q1[0].createdAt).toBe(555);
    expect(q1[0].firstQueuedAt).toBe(555);
    // Persisted durably, and NEVER regenerated on later loads or retries.
    expect(rawQueue()[0].packetId).toBe(assigned);
    const q2 = await getQueuedPackets();
    expect(q2[0].packetId).toBe(assigned);
    expect(mockMint.counter).toBe(before + 1);
    mockedUploadTank.mockRejectedValueOnce(new Error('fail once'));
    await flushQueue();
    resetBackoff();
    mockedUploadTank.mockResolvedValueOnce({ packetId: assigned });
    await flushQueue();
    const ids = mockedUploadTank.mock.calls.map((c) => c[0].packetId);
    expect(ids).toEqual([assigned, assigned]);
  });

  test('migration leaves unrelated AsyncStorage keys untouched', async () => {
    mockStore['@wellbuilt_other_thing'] = '"do-not-touch"';
    mockStore[QUEUE_KEY] = JSON.stringify([
      { id: 'queued_1', type: 'pull', data: { wellName: 'Atlas 1' }, createdAt: 1, retryCount: 0 },
    ]);
    await getQueuedPackets();
    expect(mockStore['@wellbuilt_other_thing']).toBe('"do-not-touch"');
  });
});

describe('edit packets (behavior preserved)', () => {
  test('13. edits still queue and replay without regression, without a minted pull id', async () => {
    const editParams = {
      originalPacketTimestamp: '20260721_122813',
      originalPacketId: '20260721_122813_Gunslinger3_4ubj48',
      wellName: 'Gunslinger 3',
      dateTime: '',
      dateTimeUTC: '',
      tankLevelFeet: 11.58,
      bblsTaken: 165,
      wellDown: false,
    };
    mockOnline.value = false;
    const r = await smartUploadEditPacket(editParams);
    expect(r.queued).toBe(true);
    const q = rawQueue();
    expect(q[0].type).toBe('edit');
    expect(q[0].packetId).toBeNull(); // edit identity = original pull's id
    // Migration must not assign a pull-style id to edits.
    await getQueuedPackets();
    expect(rawQueue()[0].packetId).toBeNull();
    mockOnline.value = true;
    mockedUploadEdit.mockResolvedValueOnce({ wellName: 'Gunslinger 3' });
    await flushQueue();
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);
    expect(mockedUploadEdit.mock.calls[0][0]).toMatchObject(editParams);
    expect(rawQueue()).toHaveLength(0);
  });
});

describe('pull history compatibility + reconciliation', () => {
  test('14. legacy history entries load and reconcile without migration failure', async () => {
    mockStore[HISTORY_KEY] = JSON.stringify([
      {
        id: 'queued_20260721170845_Gunslinger3', // pre-fix invented id
        wellName: 'Gunslinger 3',
        dateTime: '7/21/2026 12:06 PM',
        tankLevelFeet: 11.58,
        bblsTaken: 170,
        wellDown: false,
        sentAt: Date.now(),
        packetTimestamp: '20260721170845',
        packetId: 'queued_20260721170845_Gunslinger3',
        status: 'edited', // legacy — no syncStatus fields at all
      },
    ]);
    const loaded = await loadPullHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].syncStatus).toBeUndefined(); // legacy shape preserved
    expect(loaded[0].status).toBe('edited');
    // Reconciliation by unknown id is a safe no-op; by known id it works.
    expect(await setPullSyncStatus('nonexistent_id', 'sent')).toBe(false);
    expect(await setPullSyncStatus('queued_20260721170845_Gunslinger3', 'sent', { sentConfirmedAt: 123 })).toBe(true);
    const after = await getPullHistory();
    expect(after[0].syncStatus).toBe('sent');
    expect(after[0].sentConfirmedAt).toBe(123);
  });

  test('a flushed upload flips pending_sync → submitted (NOT sent — server outcome unknown)', async () => {
    const pid = '20260721_120600_Gunslinger3_abc123';
    await addPullToHistory('Gunslinger 3', '7/21/2026 12:06 PM', 11.58, 170, false, pid.slice(0, 15), pid, 'pending_sync');
    expect((await getPullHistory())[0].syncStatus).toBe('pending_sync');
    mockOnline.value = false;
    await smartUploadTankPacket(pullParams(pid));
    mockOnline.value = true;
    mockedUploadTank.mockResolvedValueOnce({ packetId: pid });
    await flushQueue();
    const entry = (await getPullHistory()).find((e) => e.packetId === pid)!;
    expect(entry.syncStatus).toBe('submitted'); // GS3: upload ≠ processed
    expect(entry.submittedAt).toBeGreaterThan(0);
    expect(entry.sentConfirmedAt).toBeUndefined();
  });
});
