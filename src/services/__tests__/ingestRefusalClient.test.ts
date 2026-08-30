// Phase-4 client: permanent structured refusals park with their reason;
// transient failures keep the capped-backoff retry; classification is
// conservative (unknown → transient); the queue never silently deletes.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
      removeItem: jest.fn(async (k: string) => { store.delete(k); }),
      __store: store,
    },
  };
});
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true, type: 'cellular' })),
    addEventListener: jest.fn(() => () => undefined),
  },
}));
const uploadTankPacket = jest.fn();
jest.mock('../firebase', () => ({
  uploadTankPacket: (...a: unknown[]) => uploadTankPacket(...a),
  uploadEditPacket: jest.fn(),
  mintPacketId: jest.fn(() => 'pid_mock'),
}));
jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => 'driver-1'),
  getDriverName: jest.fn(async () => 'Tester'),
}));

import { classifyIngestFailure } from '../ingestRefusal';
import { flushQueue, getQueuedPackets, queuePacket } from '../packetQueue';
import { addPullToHistory, getPullHistory } from '../pullHistory';

function callableError(message: string, callableStatus?: string, httpStatus?: number) {
  const e = new Error(message);
  (e as any).callableStatus = callableStatus;
  (e as any).httpStatus = httpStatus;
  return e;
}

describe('classifyIngestFailure', () => {
  test('protocol statuses: validation/authorization/precondition are permanent', () => {
    expect(classifyIngestFailure(callableError('well_out_of_scope', 'FAILED_PRECONDITION', 400)))
      .toEqual({ kind: 'permanent', reason: 'well_out_of_scope' });
    expect(classifyIngestFailure(callableError('unsupported_request_type', 'INVALID_ARGUMENT', 400)))
      .toEqual({ kind: 'permanent', reason: 'unsupported_request_type' });
    expect(classifyIngestFailure(callableError('driver_inactive', 'PERMISSION_DENIED', 403)))
      .toEqual({ kind: 'permanent', reason: 'driver_inactive' });
  });

  test('throttling, auth expiry, server errors, and network failures stay transient', () => {
    expect(classifyIngestFailure(callableError('Packet rate limit', 'RESOURCE_EXHAUSTED', 429)).kind).toBe('transient');
    expect(classifyIngestFailure(callableError('Callable ingestWbmPull failed (401)', undefined, 401)).kind).toBe('transient');
    expect(classifyIngestFailure(callableError('Callable ingestWbmPull failed (500)', undefined, 500)).kind).toBe('transient');
    expect(classifyIngestFailure(new TypeError('Network request failed')).kind).toBe('transient');
    // Blocker-3: staged-rollout maintenance pause is a RETRYABLE class — the
    // client must RETAIN the queued packet, not mark it sent/rejected.
    expect(classifyIngestFailure(callableError('wbm_mutations_paused', 'UNAVAILABLE', 503)).kind).toBe('transient');
    expect(classifyIngestFailure(undefined).kind).toBe('transient'); // conservative default
  });

  test('bare HTTP 400 without a protocol status is still permanent (the audited shape)', () => {
    expect(classifyIngestFailure(callableError('Callable ingestWbmPull failed (400)', undefined, 400)).kind)
      .toBe('permanent');
  });
});

describe('flush parking of permanent refusals', () => {
  const PID = '20260828_044800_Gabriel5_ab12cd';

  beforeEach(() => {
    uploadTankPacket.mockReset();
  });

  test('permanent refusal: removed from queue, history shows rejected + exact reason, payload retained', async () => {
    await addPullToHistory('Gabriel 5', '8/28/2026 4:48 AM', 9.4, 0, false, '20260828_044800', PID, 'pending_sync');
    await queuePacket('pull', { wellName: 'Gabriel 5', packetId: PID, bblsTaken: 0 });
    uploadTankPacket.mockRejectedValue(callableError('well_out_of_scope', 'FAILED_PRECONDITION', 400));

    const r = await flushQueue();
    expect(r.failed).toBe(1);
    expect(await getQueuedPackets()).toHaveLength(0); // no endless retry
    const hist = await getPullHistory();
    const entry = hist.find(e => e.packetId === PID)!;
    expect(entry.syncStatus).toBe('rejected');
    expect(entry.rejectionReason).toBe('ingest_refused: well_out_of_scope');
    // Same-ID recovery evidence retained.
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default as any;
    const payloads = JSON.parse(await AsyncStorage.getItem('@wellbuilt_submitted_payloads') ?? '{}');
    expect(payloads[PID]).toBeTruthy();
  });

  test('transient failure: packet STAYS queued with retry metadata (never dropped)', async () => {
    const PID2 = '20260828_050000_Gabriel5_cd34ef';
    await queuePacket('pull', { wellName: 'Gabriel 5', packetId: PID2, bblsTaken: 10 });
    uploadTankPacket.mockRejectedValue(callableError('Callable ingestWbmPull failed (503)', undefined, 503));

    const r = await flushQueue();
    expect(r.failed).toBe(1);
    const q = await getQueuedPackets();
    expect(q).toHaveLength(1);
    expect(q[0].retryCount).toBe(1);
  });
});
