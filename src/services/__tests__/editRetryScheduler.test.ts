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
jest.mock('../firebase', () => ({ uploadTankPacket: jest.fn(), uploadEditPacket: (...a: unknown[]) => mockedUploadEdit(...(a as [])), mintPacketId: jest.fn(() => 'pid_mock') }));
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

beforeEach(async () => {
  jest.useFakeTimers();
  Object.keys(mockStore).forEach((k) => delete mockStore[k]);
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
