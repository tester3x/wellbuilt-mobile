// Active-only edit-delivery scheduler (Thor 1 requirement 1). A single
// self-rescheduling deadline timer (NOT continuous polling) drives bounded
// automatic retry while foregrounded + online + authed. Fake timers drive both
// setTimeout and Date.now (jest modern timers mock Date). AppState is decoupled:
// the scheduler is gated by setDeliveryForeground/Online, driven directly here.
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
const mockedUploadEdit = jest.fn(async (..._a: any[]): Promise<any> => ({ wellName: 'Gunslinger 3' }));
jest.mock('../firebase', () => ({ uploadTankPacket: jest.fn(), uploadEditPacket: (...a: unknown[]) => mockedUploadEdit(...(a as [])),
  uploadEditPacketV3: (...a: unknown[]) => mockedUploadEdit(...(a as [])), mintPacketId: jest.fn(() => 'pid_mock') }));
jest.mock('../driverAuth', () => ({ getDriverId: jest.fn(async () => 'driver-a'), getDriverName: jest.fn(async () => 'Driver A') }));
jest.mock('../secureOperationalApi', () => ({ getFieldCommandStatus: async () => { throw new Error('no_receipt'); } }));

import {
  EditOperation, submitPullEdit, startEditDelivery, stopEditDelivery,
  setDeliveryForeground, setDeliveryOnline, setDeliveryFetch, scheduleEditDelivery, nextEditDeadline,
} from '../editDelivery';
import { addPullToHistory, clearPullHistory, setPullSyncStatus } from '../pullHistory';

const flush = async () => { await jest.advanceTimersByTimeAsync(0); await jest.advanceTimersByTimeAsync(0); };
const EDIT_OPS_KEY = '@wellbuilt_edit_ops';
const PID = '20260721_120600_Gunslinger3_abc123';
const PID2 = '20260721_130600_Dagger2_def456';
const editParams = (pid: string, bbls: number): any => ({ originalPacketTimestamp: pid.slice(0, 15), originalPacketId: pid, wellName: pid === PID ? 'Gunslinger 3' : 'Dagger 2', dateTime: '', dateTimeUTC: '', tankLevelFeet: 11.5, bblsTaken: bbls, wellDown: false });
const makeFetch = (paths: Record<string, unknown>) => (jest.fn(async (url: string) => { const m = String(url).match(/firebaseio\.com\/(.+)\.json/); return { ok: true, json: async () => (m && m[1] in paths ? paths[m[1]] : null) } as any; }) as unknown as typeof fetch);
const rawOps = (): EditOperation[] => JSON.parse(mockStore[EDIT_OPS_KEY] || '[]');
const processed = (pid: string) => ({ [`packets/processed/${pid}`]: { packetId: pid } });
const uploadArgs = () => mockedUploadEdit.mock.calls.map((c: any[]) => c[0]);

// A LIVE server view the test mutates in place: a single fetch closure reads the
// current `live` map on every call, so a receipt "appearing" later is just an
// assignment — no fetch swap, mirroring a CREATE landing mid-flight.
let live: Record<string, unknown> = {};
const liveFetch = (jest.fn(async (url: string) => { const m = String(url).match(/firebaseio\.com\/(.+)\.json/); return { ok: true, json: async () => (m && m[1] in live ? live[m[1]] : null) } as any; }) as unknown as typeof fetch);
const HELD = '20260830_120000_Thor1_held01';
const HELD2 = '20260830_121000_Odin2_held02';
const heldParams = (pid: string, well: string, bbls: number): any => ({ originalPacketTimestamp: pid.slice(0, 15), originalPacketId: pid, wellName: well, dateTime: '', dateTimeUTC: '', tankLevelFeet: 11.5, bblsTaken: bbls, wellDown: false });
// The original is SUBMITTED locally (not yet 'sent'/processed) → submitPullEdit
// takes the dependent-hold path when the server has no receipt yet.
async function primeHeldOriginal(pid: string, well: string) {
  await addPullToHistory(well, '8/30/2026 12:00 PM', 11.5, 170, false, pid.slice(0, 15), pid);
  await setPullSyncStatus(pid, 'submitted');
}
const opFor = (pid: string) => rawOps().find(o => o.originalPacketId === pid)!;

beforeEach(async () => {
  jest.useFakeTimers();
  Object.keys(mockStore).forEach((k) => delete mockStore[k]);
  live = {};
  mockedUploadEdit.mockReset();
  mockedUploadEdit.mockRejectedValue(new Error('network request failed')); // transient by default
  stopEditDelivery();
  await clearPullHistory();
  await addPullToHistory('Gunslinger 3', '7/21/2026 12:06 PM', 11.5, 170, false, PID.slice(0, 15), PID);
  await setPullSyncStatus(PID, 'sent');
  await addPullToHistory('Dagger 2', '7/21/2026 1:06 PM', 11.5, 170, false, PID2.slice(0, 15), PID2);
  await setPullSyncStatus(PID2, 'sent');
});
const _realFetch = global.fetch;
afterEach(() => { stopEditDelivery(); jest.clearAllTimers(); jest.useRealTimers(); (global as any).fetch = _realFetch; });

async function submit(pid: string, bbls: number) {
  (global as any).fetch = makeFetch(processed(pid));
  return submitPullEdit(editParams(pid, bbls), makeFetch(processed(pid)));
}

describe('active-only edit retry scheduler', () => {
  it('initial Submit attempts immediately (before any timer fires)', async () => {
    await submit(PID, 140);
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);
    expect(rawOps()[0].attempts).toBe(1);
  });

  it('retries at each documented backoff deadline with NO AppState event', async () => {
    await submit(PID, 140);                 // attempt 1 @ t0
    startEditDelivery(); setDeliveryFetch(makeFetch(processed(PID))); await scheduleEditDelivery(); await flush();
    await jest.advanceTimersByTimeAsync(2000); expect(mockedUploadEdit).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(8000); expect(mockedUploadEdit).toHaveBeenCalledTimes(3);
    await jest.advanceTimersByTimeAsync(20000); expect(mockedUploadEdit).toHaveBeenCalledTimes(4);
    await jest.advanceTimersByTimeAsync(60000); expect(mockedUploadEdit).toHaveBeenCalledTimes(5);
    await jest.advanceTimersByTimeAsync(60000); expect(mockedUploadEdit).toHaveBeenCalledTimes(6); // 60s cap, still retrying
  });

  it('background cancels the timer; foreground resumes and processes overdue immediately', async () => {
    await submit(PID, 140);                    // attempt 1
    setDeliveryForeground(false);              // background BEFORE the scheduler can fire
    startEditDelivery(); setDeliveryFetch(makeFetch(processed(PID)));
    await scheduleEditDelivery(); await flush(); // _fg=false → no timer set
    await jest.advanceTimersByTimeAsync(120000);
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1); // no retries while backgrounded
    setDeliveryForeground(true); await flush();  // foreground → process overdue immediately
    expect(mockedUploadEdit).toHaveBeenCalledTimes(2);
  });

  it('offline cancels/waits; reconnect immediately retries', async () => {
    await submit(PID, 140);
    startEditDelivery(); setDeliveryFetch(makeFetch(processed(PID))); await scheduleEditDelivery(); await flush();
    setDeliveryOnline(false);
    await jest.advanceTimersByTimeAsync(120000);
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);
    setDeliveryOnline(true); await flush();
    expect(mockedUploadEdit).toHaveBeenCalledTimes(2);
  });

  it('queue drain: confirmed edit leaves the queue, then NO further wakeups', async () => {
    mockedUploadEdit.mockResolvedValue({ wellName: 'Gunslinger 3' }); // upload ok (pending, no proof)
    const applied = { [`packets/processed/${PID}`]: { packetId: PID, tankLevelFeet: 11.5, bblsTaken: 140, wellDown: false, editedAt: Date.now() + 1 } };
    (global as any).fetch = makeFetch(applied);
    await submitPullEdit(editParams(PID, 140), makeFetch(applied)); // → edit_submitted
    startEditDelivery(); setDeliveryFetch(makeFetch(applied)); await scheduleEditDelivery(); await flush();
    await jest.advanceTimersByTimeAsync(3000);  // a scheduler pass reconciles the receipt → op drains
    expect(rawOps().length).toBe(0);            // confirmed + removed
    expect(await nextEditDeadline(Date.now())).toBeNull();
    const before = mockedUploadEdit.mock.calls.length;
    await jest.advanceTimersByTimeAsync(300000);
    expect(mockedUploadEdit.mock.calls.length).toBe(before); // no wakeups when empty
  });

  it('two pending operations share ONE scheduler; identity+payload stay byte-equivalent across retries', async () => {
    await submit(PID, 140);
    await submit(PID2, 155);
    startEditDelivery(); setDeliveryFetch(makeFetch({ ...processed(PID), ...processed(PID2) })); await scheduleEditDelivery(); await flush();
    const idsBefore = uploadArgs().filter((a) => a.originalPacketId === PID).map((a) => JSON.stringify(a));
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(8000);
    const idsAfter = uploadArgs().filter((a) => a.originalPacketId === PID).map((a) => JSON.stringify(a));
    const first = JSON.parse(idsBefore[0]);
    for (const s of idsAfter) {
      const a = JSON.parse(s);
      expect(a.editEventId).toBe(first.editEventId);
      expect(a.correctionCreatedAtUTC).toBe(first.correctionCreatedAtUTC);
      expect(a.wellDown).toBe(false);
    }
    expect(uploadArgs().some((a) => a.originalPacketId === PID2)).toBe(true); // independent original progresses
  });
});

// ── Held-dependent edit auto-recheck (requirement 1: the dangerous case) ──
// A CREATE is submitted, an EDIT immediately follows, the CREATE receipt is not
// present yet → the EDIT is held_dependent. With NO AppState/connectivity/auth/
// flush/restart event, the single deadline timer must recheck the receipt on a
// bounded, nonzero cadence and deliver the moment the CREATE lands.
describe('held-dependent edit — automatic receipt-recheck (no external wake event)', () => {
  // global.fetch must be a DIFFERENT instance from the injected liveFetch, else
  // readJsonPath sees fetchFn===fetch and treats it as the real (auth-gated)
  // fetch. The scheduler and submit both use the injected liveFetch explicitly.
  beforeEach(async () => { (global as any).fetch = makeFetch({}); });

  // A. Receipt appears after the first recheck → scheduler discovers it and
  //    sends automatically, in bounded time, with no external event.
  it('A: delivers automatically once the CREATE receipt appears (bounded, no external event)', async () => {
    mockedUploadEdit.mockResolvedValue({ wellName: 'Thor 1' });
    await primeHeldOriginal(HELD, 'Thor 1');
    const out = await submitPullEdit(heldParams(HELD, 'Thor 1', 140), liveFetch);
    expect(out).toEqual({ mode: 'held_dependent' });     // receipt absent at submit
    startEditDelivery(); setDeliveryFetch(liveFetch); await flush();

    await jest.advanceTimersByTimeAsync(2000);            // first recheck @ +2s
    expect(mockedUploadEdit).not.toHaveBeenCalled();      // still absent → no send
    expect(opFor(HELD).receiptChecks).toBe(1);

    live = { ...processed(HELD) };                         // CREATE lands (no event)
    await jest.advanceTimersByTimeAsync(8000);            // second recheck @ +8s
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);    // delivered automatically
    expect(mockedUploadEdit.mock.calls[0][0].originalPacketId).toBe(HELD);
    // bounded: delivered within the documented 2s+8s window, no restart/flush/auth.
  });

  // B. Receipt stays absent → 2s → 8s → 20s → 60s steady, one timer, no 0ms
  //    spin, no duplicate upload, durable op stays inspectable.
  it('B: rechecks on the bounded 2/8/20/60 cadence — one timer, no spin, no send', async () => {
    await primeHeldOriginal(HELD, 'Thor 1');
    await submitPullEdit(heldParams(HELD, 'Thor 1', 140), liveFetch);
    startEditDelivery(); setDeliveryFetch(liveFetch); await flush();
    expect(jest.getTimerCount()).toBe(1);

    await jest.advanceTimersByTimeAsync(2000);  expect(opFor(HELD).receiptChecks).toBe(1);
    await jest.advanceTimersByTimeAsync(8000);  expect(opFor(HELD).receiptChecks).toBe(2);
    await jest.advanceTimersByTimeAsync(20000); expect(opFor(HELD).receiptChecks).toBe(3);
    await jest.advanceTimersByTimeAsync(60000); expect(opFor(HELD).receiptChecks).toBe(4);
    await jest.advanceTimersByTimeAsync(60000); expect(opFor(HELD).receiptChecks).toBe(5); // 60s cap

    expect(jest.getTimerCount()).toBe(1);               // exactly ONE timer throughout
    expect(mockedUploadEdit).not.toHaveBeenCalled();    // never sent while dependent
    expect(opFor(HELD).state).toBe('edit_pending');     // durable + inspectable
    expect(opFor(HELD).attempts).toBe(0);               // no transport attempt consumed
  });

  // C. Backgrounding cancels the timer; foregrounding recomputes and resumes.
  it('C: background cancels the recheck timer; foreground recomputes and resumes', async () => {
    await primeHeldOriginal(HELD, 'Thor 1');
    await submitPullEdit(heldParams(HELD, 'Thor 1', 140), liveFetch);
    startEditDelivery(); setDeliveryFetch(liveFetch); await flush();

    setDeliveryForeground(false);
    expect(jest.getTimerCount()).toBe(0);               // canceled while backgrounded
    await jest.advanceTimersByTimeAsync(300000);
    expect(opFor(HELD).receiptChecks).toBe(0);          // no wakeups while backgrounded

    mockedUploadEdit.mockResolvedValue({ wellName: 'Thor 1' });
    live = { ...processed(HELD) };
    setDeliveryForeground(true); await flush();          // foreground → immediate recompute
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);  // resumes and delivers
  });

  // D. Connectivity/auth loss cancels; restoration resumes without a 2nd timer.
  it('D: offline cancels; reconnect resumes recheck with a single processor', async () => {
    await primeHeldOriginal(HELD, 'Thor 1');
    await submitPullEdit(heldParams(HELD, 'Thor 1', 140), liveFetch);
    startEditDelivery(); setDeliveryFetch(liveFetch); await flush();

    setDeliveryOnline(false);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(300000);
    expect(opFor(HELD).receiptChecks).toBe(0);

    mockedUploadEdit.mockResolvedValue({ wellName: 'Thor 1' });
    live = { ...processed(HELD) };
    setDeliveryOnline(true); await flush();
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBeLessThanOrEqual(1); // never overlapping processors
  });

  // E. Two dependent edits for one original + one for another: same-original
  //    serialization preserved, unrelated original not starved, ids stable.
  it('E: same-original serialization holds while the unrelated original progresses', async () => {
    mockedUploadEdit.mockResolvedValue({ wellName: 'x' });
    await primeHeldOriginal(HELD, 'Thor 1');
    await primeHeldOriginal(HELD2, 'Odin 2');
    await submitPullEdit(heldParams(HELD, 'Thor 1', 140), liveFetch);   // op1 (earlier)
    await jest.advanceTimersByTimeAsync(1);                              // distinct createdAt
    await submitPullEdit(heldParams(HELD, 'Thor 1', 141), liveFetch);   // op2 (later, same original)
    await submitPullEdit(heldParams(HELD2, 'Odin 2', 150), liveFetch);  // other original
    const ops = rawOps().filter(o => o.originalPacketId === HELD).sort((a, b) => a.createdAt - b.createdAt || (a.opId < b.opId ? -1 : 1));
    const [op1, op2] = ops;
    expect(op1.editEventId).not.toBe(op2.editEventId);                  // distinct corrections

    startEditDelivery(); setDeliveryFetch(liveFetch); await flush();
    live = { ...processed(HELD), ...processed(HELD2) };                 // both CREATEs land
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(8000);

    const sent = uploadArgs();
    const sentEvids = sent.map(a => a.editEventId);
    expect(sentEvids).toContain(op1.editEventId);                       // earlier correction sent
    expect(sentEvids).not.toContain(op2.editEventId);                  // later HELD behind it (serial)
    expect(sent.some(a => a.originalPacketId === HELD2)).toBe(true);   // unrelated NOT starved
    // identity stable across op1's retries
    for (const a of sent.filter(a => a.originalPacketId === HELD)) expect(a.editEventId).toBe(op1.editEventId);
  });

  // F. Original permanently rejected/collision → dependent edit PARKS with an
  //    explicit reason, no send, no endless timer.
  it('F: original rejected → dependent edit parks with a durable reason, timer stops', async () => {
    await primeHeldOriginal(HELD, 'Thor 1');
    await submitPullEdit(heldParams(HELD, 'Thor 1', 140), liveFetch);
    live = { [`packets/rejected/${HELD}`]: { reason: 'duplicate_collision' } };
    startEditDelivery(); setDeliveryFetch(liveFetch); await flush();

    await jest.advanceTimersByTimeAsync(2000);            // first recheck discovers the rejection
    const op = opFor(HELD);
    expect(op.state).toBe('edit_blocked');               // parked, not sent, not deleted
    expect(op.blockedReason).toMatch(/rejected by the server/i);
    expect(op.blockedReason).toMatch(/duplicate_collision/);
    expect(mockedUploadEdit).not.toHaveBeenCalled();

    expect(await nextEditDeadline(Date.now())).toBeNull(); // terminal → no deadline
    expect(jest.getTimerCount()).toBe(0);                 // no endless timer
    await jest.advanceTimersByTimeAsync(300000);
    expect(jest.getTimerCount()).toBe(0);                 // stays quiet
  });
});
