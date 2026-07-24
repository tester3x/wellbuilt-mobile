// Bounded confirmation retries + quiet startup reconciliation (7/23 field
// case fix). The reconcile layer is READ-ONLY: it must never invoke packet
// send code — uploadTankPacket is asserted untouched in every test here.

const mockStore: Record<string, string> = {};
const mockOnline = { value: true };
let capturedNetInfoListener: ((state: any) => void) | null = null;

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
    addEventListener: jest.fn((cb: (state: any) => void) => {
      capturedNetInfoListener = cb;
      return () => { capturedNetInfoListener = null; };
    }),
  },
}));

const uploadTankMock = jest.fn();
jest.mock('../firebase', () => ({
  uploadTankPacket: uploadTankMock,
  uploadEditPacket: jest.fn(),
  mintPacketId: jest.fn((w: string) => `20260724_000001_${String(w).replace(/\s+/g, '')}_t1`),
}));

jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => null),
  getDriverName: jest.fn(async () => null),
}));

/** Server state the switchable global fetch serves. Mutate between passes. */
const serverPaths: Record<string, unknown> = {};
function installGlobalFetch() {
  (global as any).fetch = jest.fn(async (url: string) => {
    const m = String(url).match(/firebaseio\.com\/(.+)\.json/);
    const path = m ? decodeURIComponent(m[1]) : '';
    return { ok: true, json: async () => (path in serverPaths ? serverPaths[path] : null) } as any;
  });
}

function bootApp() {
  let mods: any = {};
  jest.isolateModules(() => {
    mods = {
      packetQueue: require('../packetQueue'),
      deliveryStatus: require('../deliveryStatus'),
      pullHistory: require('../pullHistory'),
    };
  });
  return mods;
}

const PID_A = '20260723_225008_TestWell_saaove';
const PID_B = '20260723_225046_Gab1_owplfa';

async function addSubmitted(app: any, pid: string, wellName: string, submittedAt: number) {
  await app.pullHistory.addPullToHistory(wellName, '7/23/2026 10:49 PM', 12.5, 140, false, pid.slice(0, 15), pid, 'submitted');
  await app.pullHistory.setPullSyncStatus(pid, 'submitted', { submittedAt });
}

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  for (const k of Object.keys(serverPaths)) delete serverPaths[k];
  mockOnline.value = true;
  capturedNetInfoListener = null;
  uploadTankMock.mockReset();
  installGlobalFetch();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test('1. confirmation lands mid-ladder: history → sent, no resend, ONE fresh announcement', async () => {
  const app = bootApp();
  await addSubmitted(app, PID_A, 'Test Well', Date.now());
  const events: any[] = [];
  app.deliveryStatus.onReconcileResult((r: any) => events.push(r));

  // First pass races the Cloud Function — misses, schedules the 5 s rung.
  const miss = await app.deliveryStatus.reconcileSubmittedPulls();
  expect(miss.stillUnknown).toBe(1);
  expect(app.deliveryStatus.confirmationRetryState()).toEqual({ timerPending: true, step: 1 });

  // Server outcome lands before the retry fires.
  serverPaths[`packets/processed/${PID_A}`] = { packetId: PID_A, processedAt: new Date().toISOString() };
  await jest.advanceTimersByTimeAsync(5_000);

  expect((await app.pullHistory.getPullHistory())[0].syncStatus).toBe('sent');
  expect(uploadTankMock).not.toHaveBeenCalled(); // reconciliation never resends
  expect(events.filter(e => e.freshConfirmedSent > 0)).toHaveLength(1); // one toast at most
  // Resolved → ladder fully stands down.
  expect(app.deliveryStatus.confirmationRetryState()).toEqual({ timerPending: false, step: 0 });
});

test('2. unknown through ALL retries: stays submitted, visible, no false delivered toast, ladder capped', async () => {
  const app = bootApp();
  await addSubmitted(app, PID_A, 'Test Well', Date.now());
  const events: any[] = [];
  app.deliveryStatus.onReconcileResult((r: any) => events.push(r));

  await app.deliveryStatus.reconcileSubmittedPulls(); // miss → rung 1
  await jest.advanceTimersByTimeAsync(5_000);         // miss → rung 2
  await jest.advanceTimersByTimeAsync(15_000);        // miss → rung 3
  await jest.advanceTimersByTimeAsync(45_000);        // miss → budget spent

  const state = app.deliveryStatus.confirmationRetryState();
  expect(state.timerPending).toBe(false); // NOT an unbounded loop
  expect(state.step).toBe(app.deliveryStatus.CONFIRMATION_RETRY_DELAYS_MS.length);
  await jest.advanceTimersByTimeAsync(3_600_000); // nothing else ever fires
  expect(app.deliveryStatus.confirmationRetryState().timerPending).toBe(false);

  expect((await app.pullHistory.getPullHistory())[0].syncStatus).toBe('submitted'); // preserved
  const items = await app.deliveryStatus.getDeliveryItems();
  expect(items.some((i: any) => i.packetId === PID_A && i.status === 'submitted')).toBe(true); // still visible
  expect(events.filter(e => e.freshConfirmedSent > 0)).toHaveLength(0);
  expect(uploadTankMock).not.toHaveBeenCalled();
});

test('3. restart with a stale already-processed submitted entry: silent sent, no badge attention, no toast', async () => {
  const app = bootApp();
  // Submitted 12 hours ago (previous session), processed server-side long ago.
  await addSubmitted(app, PID_A, 'Test Well', Date.now() - 12 * 60 * 60 * 1000);
  serverPaths[`packets/processed/${PID_A}`] = { packetId: PID_A, processedAt: '2026-07-24T03:51:48.031Z' };
  const events: any[] = [];
  app.deliveryStatus.onReconcileResult((r: any) => events.push(r));

  // Startup: immediate quiet pass; badge waits for this before first render.
  app.deliveryStatus.startDeliveryReconciler();
  await app.deliveryStatus.whenInitialReconcileSettled();

  const entry = (await app.pullHistory.getPullHistory())[0];
  expect(entry.syncStatus).toBe('sent');
  expect(events.filter(e => e.confirmedSent > 0)).toHaveLength(1);
  expect(events.filter(e => e.freshConfirmedSent > 0)).toHaveLength(0); // SILENT catch-up
  // What the badge shows after the gate: zero attention, zero pending.
  const counts = app.deliveryStatus.computeDeliveryCounts(
    await app.packetQueue.getQueuedPackets(), await app.pullHistory.getPullHistory(), Date.now(),
  );
  expect(counts.attention).toBe(0);
  expect(counts.pending).toBe(0);
  expect(uploadTankMock).not.toHaveBeenCalled();
});

test('4. restart with a genuinely unresolved submitted item: stays visible; retries only while online', async () => {
  const app = bootApp();
  await addSubmitted(app, PID_A, 'Test Well', Date.now() - 12 * 60 * 60 * 1000);
  // No server outcome at all (the packet vanished / CF never ran).

  app.packetQueue.startNetworkMonitor();
  app.deliveryStatus.startDeliveryReconciler();
  await app.deliveryStatus.whenInitialReconcileSettled();

  // Still visible as unresolved truth after the initial reconcile...
  const items = await app.deliveryStatus.getDeliveryItems();
  expect(items.some((i: any) => i.packetId === PID_A && i.status === 'submitted')).toBe(true);
  // ...with a bounded follow-up scheduled while online.
  expect(app.deliveryStatus.confirmationRetryState().timerPending).toBe(true);

  // Going offline cancels the pending follow-up (confirmation cannot land).
  capturedNetInfoListener?.({ isConnected: false, isInternetReachable: false, type: 'none' });
  await Promise.resolve();
  expect(app.deliveryStatus.confirmationRetryState().timerPending).toBe(false);
  expect(uploadTankMock).not.toHaveBeenCalled();
});

test('5. multiple pulls resolving across passes: each updates once, toast count accurate, no duplicates', async () => {
  const app = bootApp();
  await addSubmitted(app, PID_A, 'Test Well', Date.now());
  await addSubmitted(app, PID_B, 'Gab 1', Date.now());
  const events: any[] = [];
  app.deliveryStatus.onReconcileResult((r: any) => events.push(r));

  // Pass 1: A confirmed, B still processing.
  serverPaths[`packets/processed/${PID_A}`] = { packetId: PID_A, processedAt: new Date().toISOString() };
  const p1 = await app.deliveryStatus.reconcileSubmittedPulls();
  expect(p1.confirmedSent).toBe(1);
  expect(p1.freshConfirmedSent).toBe(1);
  expect(p1.stillUnknown).toBe(1);

  // Retry rung: B lands.
  serverPaths[`packets/processed/${PID_B}`] = { packetId: PID_B, processedAt: new Date().toISOString() };
  await jest.advanceTimersByTimeAsync(5_000);

  const history = await app.pullHistory.getPullHistory();
  expect(history.filter((e: any) => e.syncStatus === 'sent')).toHaveLength(2);
  const fresh = events.filter(e => e.freshConfirmedSent > 0);
  expect(fresh).toHaveLength(2); // one announcement per resolving pass
  expect(fresh.reduce((n, e) => n + e.freshConfirmedSent, 0)).toBe(2); // accurate total

  // Any later pass announces nothing again.
  const p3 = await app.deliveryStatus.reconcileSubmittedPulls();
  expect(p3.confirmedSent).toBe(0);
  expect(events.filter(e => e.freshConfirmedSent > 0)).toHaveLength(2);
  expect(uploadTankMock).not.toHaveBeenCalled();
});

test('6. UI wiring: toast announces freshConfirmedSent only; badge gates first render on the startup pass', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', '..', '..');
  const toast = fs.readFileSync(path.join(root, 'src', 'components', 'SyncToast.tsx'), 'utf8');
  const badge = fs.readFileSync(path.join(root, 'src', 'components', 'SyncAttentionBadge.tsx'), 'utf8');
  expect(toast.includes('r.freshConfirmedSent > 0')).toBe(true);
  expect(toast.includes('r.confirmedSent > 0')).toBe(false); // stale catch-ups stay silent
  expect(badge.includes('whenInitialReconcileSettled().then')).toBe(true);
  // Flush toast wording stays truthful: submitted, never "sent".
  expect(toast.includes('submitted. Waiting for confirmation.')).toBe(true);
});
