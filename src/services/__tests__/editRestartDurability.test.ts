// Restart durability of the active-only scheduler (Thor 1 final proof #1). A
// held_dependent edit — and an uploaded-awaiting-confirmation edit — must
// survive an app-process restart: the durable queue persists, ALL in-memory
// scheduler state is destroyed (stopEditDelivery), and on relaunch the single
// deadline timer must resume the REMAINING nonzero cadence from the persisted
// receiptChecks/lastReceiptCheckAt — never reset to 0ms, never lose or duplicate
// the op, never wait for a lifecycle/connectivity/manual event.
const mockStore: Record<string, string> = {};
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
  default: { fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true, type: 'cellular' })), addEventListener: jest.fn(() => () => undefined) },
}));
const mockedUploadEdit = jest.fn(async (..._a: any[]): Promise<any> => ({ wellName: 'Thor 1' }));
jest.mock('../firebase', () => ({ uploadTankPacket: jest.fn(), uploadEditPacket: (...a: unknown[]) => mockedUploadEdit(...(a as [])), mintPacketId: jest.fn(() => 'pid') }));
jest.mock('../driverAuth', () => ({ getDriverId: jest.fn(async () => 'driver-a'), getDriverName: jest.fn(async () => 'Driver A') }));
jest.mock('../secureOperationalApi', () => ({ getFieldCommandStatus: async () => { throw new Error('no_receipt'); } }));

import {
  EditOperation, startEditDelivery, stopEditDelivery,
  setDeliveryForeground, setDeliveryFetch, nextEditDeadline, EDIT_AUTO_BACKOFF_MS,
} from '../editDelivery';

const EDIT_OPS_KEY = '@wellbuilt_edit_ops';
const HELD = '20260830_120000_Thor1_held01';
const T0 = new Date('2026-08-30T18:00:00.000Z').getTime(); // fixed fake wall clock
const flush = async () => { await jest.advanceTimersByTimeAsync(0); await jest.advanceTimersByTimeAsync(0); };
const rawOps = (): EditOperation[] => JSON.parse(mockStore[EDIT_OPS_KEY] || '[]');
// A DIFFERENT fetch instance from the injected one (readJsonPath treats
// fetchFn===fetch as the real auth-gated fetch).
let live: Record<string, unknown> = {};
const liveFetch = (jest.fn(async (url: string) => { const m = String(url).match(/firebaseio\.com\/(.+)\.json/); return { ok: true, json: async () => (m && m[1] in live ? live[m[1]] : null) } as any; }) as unknown as typeof fetch);
const processed = (pid: string, extra: Record<string, unknown> = {}) => ({ [`packets/processed/${pid}`]: { packetId: pid, ...extra } });

// A durable op exactly as it would sit in AsyncStorage after a prior session.
function persist(op: Partial<EditOperation>) {
  const full: EditOperation = {
    opId: 'editop_00000000-0000-4000-8000-0000000000aa',
    editEventId: 'editevt_00000000-0000-4000-8000-0000000000bb',
    originalPacketId: HELD,
    wellName: 'Thor 1',
    payload: { originalPacketTimestamp: HELD.slice(0, 15), originalPacketId: HELD, wellName: 'Thor 1', dateTime: '', dateTimeUTC: '', tankLevelFeet: 11.5, bblsTaken: 140, wellDown: false } as any,
    state: 'edit_pending',
    createdAt: T0 - 120000,
    updatedAt: T0 - 5000,
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    receiptChecks: 2,
    lastReceiptCheckAt: T0 - 5000,
    ...op,
  } as EditOperation;
  mockStore[EDIT_OPS_KEY] = JSON.stringify([full]);
  return full;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
  Object.keys(mockStore).forEach((k) => delete mockStore[k]);
  live = {};
  mockedUploadEdit.mockReset();
  mockedUploadEdit.mockResolvedValue({ wellName: 'Thor 1' });
  stopEditDelivery();
  (global as any).fetch = (jest.fn(async () => ({ ok: true, json: async () => null })) as any); // distinct from liveFetch
});
afterEach(() => { stopEditDelivery(); jest.clearAllTimers(); jest.useRealTimers(); });

describe('restart durability — held_dependent edit', () => {
  it('resumes the REMAINING nonzero receipt deadline on relaunch (no 0ms reset, no loss, no dup)', async () => {
    const before = persist({ receiptChecks: 2, lastReceiptCheckAt: T0 - 5000 });
    // remaining deadline = lastReceiptCheckAt + backoff[min(2+1,4)] = (T0-5000)+20000 = T0+15000
    const expectedDeadline = (T0 - 5000) + EDIT_AUTO_BACKOFF_MS[3];
    expect(expectedDeadline).toBe(T0 + 15000);

    // ── app-process RESTART: in-memory scheduler state already destroyed by
    //    stopEditDelivery() in beforeEach; the durable queue persists. ──
    startEditDelivery(); setDeliveryFetch(liveFetch); await flush();

    const dl = await nextEditDeadline(Date.now());
    expect(dl).toBe(expectedDeadline);          // remaining/future deadline, computed from persisted state
    expect(dl! - Date.now()).toBe(15000);       // NONZERO — not reset to 0ms
    expect(jest.getTimerCount()).toBe(1);       // exactly one timer armed
    expect(rawOps()).toHaveLength(1);           // op not lost
    expect(rawOps()[0].opId).toBe(before.opId); // same identity
    expect(mockedUploadEdit).not.toHaveBeenCalled(); // no immediate/duplicate send

    // waits on its own timer, NOT a lifecycle/connectivity event:
    await jest.advanceTimersByTimeAsync(14999);
    expect(mockedUploadEdit).not.toHaveBeenCalled();
    expect(rawOps()[0].receiptChecks).toBe(2);  // cadence not advanced early, not reset

    // CREATE receipt appears → automatic promotion/send at the resumed deadline.
    live = { ...processed(HELD) };
    await jest.advanceTimersByTimeAsync(1);      // reaches T0+15000
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);
    expect(mockedUploadEdit.mock.calls[0][0].editEventId).toBe(before.editEventId); // stable identity
    expect(mockedUploadEdit.mock.calls[0][0].originalPacketId).toBe(HELD);
  });

  it('if the receipt is still absent, the resumed cadence advances (2/8/20/60) not reset', async () => {
    persist({ receiptChecks: 2, lastReceiptCheckAt: T0 - 5000 });
    startEditDelivery(); setDeliveryFetch(liveFetch); await flush();
    await jest.advanceTimersByTimeAsync(15000);  // deadline: still absent
    expect(rawOps()[0].receiptChecks).toBe(3);   // advanced from persisted 2 → 3 (continues, not reset)
    await jest.advanceTimersByTimeAsync(60000);  // next = backoff[4] = 60s cap
    expect(rawOps()[0].receiptChecks).toBe(4);
    expect(mockedUploadEdit).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
  });
});

describe('restart durability — edit_submitted awaiting confirmation', () => {
  it('relaunch resumes READ-ONLY receipt checks and NEVER re-uploads', async () => {
    const before = persist({ state: 'edit_submitted', attempts: 1, lastAttemptAt: T0 - 5000, lastError: null, receiptChecks: 1, lastReceiptCheckAt: T0 - 5000 });
    startEditDelivery(); setDeliveryFetch(liveFetch); await flush();

    // Receipt not yet present → it rechecks (read-only), never re-uploads.
    await jest.advanceTimersByTimeAsync(8000);
    expect(mockedUploadEdit).not.toHaveBeenCalled();
    expect(rawOps()[0]?.state).toBe('edit_submitted');
    expect(rawOps()[0]?.receiptChecks).toBeGreaterThan(1); // read-only rechecks resumed

    // A committed proof appears → confirmation drains it, STILL no upload.
    live = { ...processed(HELD, { committed: true }) };
    await jest.advanceTimersByTimeAsync(60000);
    expect(mockedUploadEdit).not.toHaveBeenCalled();       // never re-uploaded on relaunch
    expect(rawOps()).toHaveLength(0);                      // confirmed + drained
    void before;
  });
});

describe('restart durability — cold background launch', () => {
  it('does NOT arm the timer until foregrounded', async () => {
    persist({ receiptChecks: 2, lastReceiptCheckAt: T0 - 5000 });
    setDeliveryForeground(false);                 // cold launch in background
    startEditDelivery(); setDeliveryFetch(liveFetch); await flush();
    expect(jest.getTimerCount()).toBe(0);         // not armed while backgrounded
    await jest.advanceTimersByTimeAsync(300000);
    expect(rawOps()[0].receiptChecks).toBe(2);    // no wakeups, cadence untouched
    expect(mockedUploadEdit).not.toHaveBeenCalled();

    live = { ...processed(HELD) };
    setDeliveryForeground(true); await flush();    // foreground → arms + immediate pass
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);
  });
});
