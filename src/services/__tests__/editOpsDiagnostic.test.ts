// Proves the VC29 read-only edit-ops diagnostic performs ZERO writes and does
// not mutate the operation, the marker, or the scheduler. Its only side effect
// is console output.

const mockStore: Record<string, string> = {};

const setItem = jest.fn(async (k: string, v: string) => { mockStore[k] = v; });
const removeItem = jest.fn(async (k: string) => { delete mockStore[k]; });
const mergeItem = jest.fn(async () => { throw new Error('mergeItem must not be called'); });
const clear = jest.fn(async () => { throw new Error('clear must not be called'); });

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
    setItem,
    removeItem,
    mergeItem,
    clear,
  },
}));

jest.mock('expo-crypto', () => ({
  __esModule: true,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: jest.fn(async (_alg: string, s: string) => `sha(${s.length})`),
  randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000000'),
}));

// Network + queue reads → stubbed, never real.
const readJsonPath = jest.fn(async () => ({ found: false, data: null, diagnosis: null }));
jest.mock('../backendAccess', () => ({ readJsonPath: (...a: unknown[]) => (readJsonPath as any)(...a) }));

const isOnline = jest.fn(async () => true);
const getQueuedPackets = jest.fn(async () => [] as unknown[]);
jest.mock('../packetQueue', () => ({
  isOnline: () => isOnline(),
  getQueuedPackets: () => getQueuedPackets(),
  mutateQueuedPullInPlace: jest.fn(),
  onConnectivityChange: jest.fn(() => () => undefined),
  onFlushComplete: jest.fn(() => () => undefined),
}));

// Marker source + a write-detector on setPullEditStatus (must NOT be called).
const setPullEditStatus = jest.fn(async () => { throw new Error('setPullEditStatus must not be called'); });
const getPullHistory = jest.fn(async () => ([
  {
    id: '20260831_230250_TestWell_a6sm54',
    packetId: '20260831_230250_TestWell_a6sm54',
    wellName: 'Test Well',
    tankLevelFeet: 15,
    bblsTaken: 140,
    editStatus: 'edit_pending',
    editStatusReason: null,
  },
]));
jest.mock('../pullHistory', () => ({
  getPullHistory: () => getPullHistory(),
  setPullEditStatus: (...a: unknown[]) => (setPullEditStatus as any)(...a),
  setPullSyncStatus: jest.fn(),
}));

// Write callables must never be invoked by a read-only snapshot.
const uploadEditPacket = jest.fn(async () => { throw new Error('uploadEditPacket must not be called'); });
jest.mock('../firebase', () => ({ uploadEditPacket: (...a: unknown[]) => (uploadEditPacket as any)(...a) }));

import { getEditOperations } from '../editDelivery';
import { logEditOpsDiagnostic, __resetEditOpsDiagnosticForTest } from '../editOpsDiagnostic';

const EDIT_OPS_KEY = '@wellbuilt_edit_ops';

// A realistic preserved op (edit_pending, one prior failed attempt, stale error).
const OP = {
  opId: 'editop_11111111-1111-4111-8111-111111111111',
  editEventId: 'editevt_22222222-2222-4222-8222-222222222222',
  originalPacketId: '20260831_230250_TestWell_a6sm54',
  wellName: 'Test Well',
  payload: {
    originalPacketTimestamp: '20260831_230250',
    originalPacketId: '20260831_230250_TestWell_a6sm54',
    wellName: 'Test Well',
    dateTime: '',
    dateTimeUTC: '',
    tankLevelFeet: 16,
    bblsTaken: 140,
    wellDown: false,
    editEventId: 'editevt_22222222-2222-4222-8222-222222222222',
  },
  state: 'edit_pending',
  createdAt: 1756000000000,
  updatedAt: 1756000000000,
  attempts: 1,
  lastAttemptAt: 1756000000000,
  lastError: 'errors.permission',
  receiptChecks: 0,
  lastReceiptCheckAt: null,
};

describe('editOpsDiagnostic — read-only snapshot', () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    for (const k of Object.keys(mockStore)) delete mockStore[k];
    mockStore[EDIT_OPS_KEY] = JSON.stringify([OP]);
    setItem.mockClear(); removeItem.mockClear(); mergeItem.mockClear(); clear.mockClear();
    readJsonPath.mockClear(); setPullEditStatus.mockClear(); uploadEditPacket.mockClear();
    __resetEditOpsDiagnosticForTest();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { logSpy.mockRestore(); });

  test('performs zero writes and leaves the op byte-identical', async () => {
    const before = mockStore[EDIT_OPS_KEY];
    await logEditOpsDiagnostic(jest.fn() as unknown as typeof fetch);

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(mergeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    // Byte-for-byte unchanged.
    expect(mockStore[EDIT_OPS_KEY]).toBe(before);
    // Op is still exactly one edit_pending op with the same attempts/state/error.
    const ops = await getEditOperations();
    expect(ops).toHaveLength(1);
    expect(ops[0].state).toBe('edit_pending');
    expect(ops[0].attempts).toBe(1);
    expect(ops[0].lastError).toBe('errors.permission');
  });

  test('does not touch the marker or any write callable', async () => {
    await logEditOpsDiagnostic(jest.fn() as unknown as typeof fetch);
    expect(setPullEditStatus).not.toHaveBeenCalled();
    expect(uploadEditPacket).not.toHaveBeenCalled();
  });

  test('emits a snapshot to the console (observability side effect only)', async () => {
    await logEditOpsDiagnostic(jest.fn() as unknown as typeof fetch);
    const emitted = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(emitted).toContain('[EditOpsDiag]');
    expect(emitted).toContain('BEGIN read-only edit-ops snapshot');
    expect(emitted).toContain('op.state=edit_pending');
    // Raw editEventId is NEVER printed — only a fingerprint.
    expect(emitted).not.toContain('editevt_22222222-2222-4222-8222-222222222222');
  });

  test('the second invocation in a process is a no-op (guarded)', async () => {
    await logEditOpsDiagnostic(jest.fn() as unknown as typeof fetch);
    const firstCount = logSpy.mock.calls.length;
    // No reset this time → guard should suppress a second snapshot.
    await logEditOpsDiagnostic(jest.fn() as unknown as typeof fetch);
    expect(logSpy.mock.calls.length).toBe(firstCount);
  });
});
