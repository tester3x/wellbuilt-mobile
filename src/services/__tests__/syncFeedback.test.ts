// Branded sync feedback + reconciliation freshness proofs (field-test
// fixes). Service tests use the standard mocks; UI behavior is pinned by
// source-wiring assertions. No Firebase writes.

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
  mintPacketId: jest.fn((w: string) => `20260723_000001_${String(w).replace(/\s+/g, '')}_x1`),
}));

jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => null),
  getDriverName: jest.fn(async () => null),
}));

import * as fs from 'fs';
import * as path from 'path';
import { onReconcileResult, reconcileSubmittedPulls } from '../deliveryStatus';
import { addPullToHistory, clearPullHistory, getPullHistory } from '../pullHistory';

const PID = '20260722_140214_Gunslinger3_2wvtd1';

const makeFetch = (paths: Record<string, unknown>, delayMs = 0) =>
  jest.fn(async (url: string) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const m = String(url).match(/firebaseio\.com\/(.+)\.json/);
    return { ok: true, json: async () => (m && m[1] in paths ? paths[m[1]] : null) } as any;
  }) as unknown as typeof fetch;

beforeEach(async () => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockOnline.value = true;
  await clearPullHistory();
});

describe('reconciliation freshness (stale "Submitted — awaiting server" fix)', () => {
  test('REGRESSION: packet already processed before the screen opens → first pass settles to Delivered, not Awaiting', async () => {
    // Local state is stale: still 'submitted'…
    await addPullToHistory('Gunslinger 3', '7/22/2026 4:03 PM', 11.58, 170, false, PID.slice(0, 15), PID, 'submitted');
    // …but the exact packet ALREADY exists in processed (as on the WB-M dashboard).
    const events: any[] = [];
    const unsub = onReconcileResult((r) => events.push(r));
    const r = await reconcileSubmittedPulls(makeFetch({
      [`packets/processed/${PID}`]: { packetId: PID, processedAt: '2026-07-22T21:03:30.000Z' },
    }));
    unsub();
    // Processed confirmation WINS over the stale local submitted state.
    expect(r.confirmedSent).toBe(1);
    const entry = (await getPullHistory())[0];
    expect(entry.syncStatus).toBe('sent');
    expect(entry.syncStatus).not.toBe('submitted');
    // And the settle is broadcast immediately for rows/badge/toast.
    expect(events).toHaveLength(1);
    expect(events[0].confirmedSent).toBe(1);
  });

  test('overlapping reconcile calls collapse to one pass (no stacked polls)', async () => {
    await addPullToHistory('Gunslinger 3', '7/22/2026 4:03 PM', 11.58, 170, false, PID.slice(0, 15), PID, 'submitted');
    const fetchFn = makeFetch({ [`packets/processed/${PID}`]: { packetId: PID } }, 30);
    const [a, b] = await Promise.all([
      reconcileSubmittedPulls(fetchFn),
      reconcileSubmittedPulls(fetchFn), // fired while the first is in flight
    ]);
    const totals = a.confirmedSent + b.confirmedSent;
    expect(totals).toBe(1); // exactly one pass did the work
    expect((await getPullHistory())[0].syncStatus).toBe('sent');
  });

  test('reconcile-result events fire per completed pass with truthful counts', async () => {
    const events: any[] = [];
    const unsub = onReconcileResult((r) => events.push(r));
    await reconcileSubmittedPulls(makeFetch({})); // nothing submitted
    unsub();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ confirmedSent: 0, confirmedRejected: 0, stillUnknown: 0 });
  });
});

// ── Source-wiring proofs for the UI contract ─────────────────────────────
const read = (p: string) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const recordSrc = read('../../../app/record.tsx');
const toastSrc = read('../../components/SyncToast.tsx');
const badgeSrc = read('../../components/SyncAttentionBadge.tsx');
const syncScreenSrc = read('../../../app/sync-status.tsx');
const layoutSrc = read('../../../app/_layout.tsx');

describe('record.tsx — form reset contract', () => {
  const submitBody = recordSrc.slice(recordSrc.indexOf('const handleSubmit'));

  test('reset clears level, barrels, wellDown, and picker state', () => {
    const helper = recordSrc.slice(recordSrc.indexOf('const resetFormAfterDurableSave'), recordSrc.indexOf('const handleSubmit'));
    expect(helper).toContain("setLevel('')");
    expect(helper).toContain("setBarrels('')");
    expect(helper).toContain('setWellDown(false)');
    expect(helper).toContain('setDateTime(now)');
    expect(helper).toContain('setTempDateTime(now)');
  });

  test('new-pull path resets UNCONDITIONALLY after durable save, BEFORE feedback — identical for consecutive offline submissions', () => {
    const newPullIdx = submitBody.indexOf('NEW PULL MODE');
    const resetIdx = submitBody.indexOf('resetFormAfterDurableSave();', newPullIdx);
    const queuedFeedbackIdx = submitBody.indexOf("'Saved on this phone'", newPullIdx);
    expect(resetIdx).toBeGreaterThan(-1);
    expect(queuedFeedbackIdx).toBeGreaterThan(resetIdx); // reset precedes feedback
    // Unconditional: the reset sits before the queued/online branch, so the
    // first and any consecutive offline submission behave identically and
    // never depend on toast dismissal or tapping OK.
    const branchIdx = submitBody.indexOf('if (uploadResult.queued)', newPullIdx);
    expect(resetIdx).toBeLessThan(branchIdx);
  });

  test('edit path also resets before feedback', () => {
    const editResetIdx = submitBody.indexOf('resetFormAfterDurableSave();');
    const editToastIdx = submitBody.indexOf("'Pull updated'");
    expect(editResetIdx).toBeGreaterThan(-1);
    expect(editToastIdx).toBeGreaterThan(editResetIdx);
  });

  test('storage failure preserves the form: no reset in the catch path', () => {
    const catchBlock = submitBody.slice(submitBody.lastIndexOf('} catch (error)'));
    expect(catchBlock).not.toContain('resetFormAfterDurableSave');
  });

  test('no developer wording or generic offline alert remains', () => {
    expect(recordSrc).not.toContain('Queued for later (offline)');
    expect(recordSrc).not.toContain('Pull Saved Locally');
    expect(recordSrc).not.toContain('uploadResult.error ||');
    expect(recordSrc).toContain("'Saved on this phone'");
    expect(recordSrc).toContain("will send automatically when you're back online.");
  });

  test('future-time modal remains a blocking alert with action buttons', () => {
    const gate = submitBody.slice(submitBody.indexOf('!timeGate.ok'), submitBody.indexOf('!timeGate.ok') + 700);
    expect(gate).toContain("alert.show('Future time detected'");
    expect(gate).toContain("'Fix date/time'");
    expect(gate).toContain("'Use current time'");
    expect(gate).not.toContain('showSyncToast');
  });

  test('attention-required edit outcome stays blocking; routine outcomes are toasts', () => {
    expect(submitBody).toMatch(/alert\.show\(\s*'Edit Needs Attention'/);
    expect(submitBody).toContain("title: 'Pull updated'");
    expect(submitBody).toContain("title: 'Edit saved'");
  });
});

describe('SyncToast — branded, truthful, nonblocking', () => {
  test('auto-dismisses after ~3 s and never blocks touches', () => {
    expect(toastSrc).toContain('SYNC_TOAST_DURATION_MS = 3000');
    expect(toastSrc).toContain('pointerEvents="none"');
  });

  test('wording is truthful: submitted until processed confirms; Delivered only on confirmation', () => {
    expect(toastSrc).toContain('submitted. Waiting for confirmation.');
    expect(toastSrc).toMatch(/confirmedSent > 0[\s\S]{0,200}Delivered/);
    expect(toastSrc).not.toMatch(/pulls? uploaded/i);
    expect(toastSrc).not.toMatch(/title: 'Sent'/);
  });

  test('carries the WB mark and navy/gold/teal/blue brand surface', () => {
    expect(toastSrc).toContain("require('../../assets/images/icon.png')");
    expect(toastSrc).toContain('#10131c');
    expect(toastSrc).toContain('#eab308');
    expect(toastSrc).toContain('#14b8a6');
    expect(toastSrc).toContain('#3b82f6');
  });

  test('no generic native success Alert remains anywhere in the sync feedback chain', () => {
    expect(toastSrc).not.toContain('Alert.alert');
    expect(layoutSrc).not.toContain('SyncConfirmation');
    expect(fs.existsSync(path.join(__dirname, '../../components/OfflineStatusBar.tsx'))).toBe(false);
  });
});

describe('badge — route-aware and immediately fresh', () => {
  test('uses route placement, hides via placement, and left/right offsets', () => {
    expect(badgeSrc).toContain('badgePlacementForRoute(pathname)');
    expect(badgeSrc).toContain("placement === 'hidden'");
    expect(badgeSrc).toContain('badgeLeftOffset(insets.left)');
    expect(badgeSrc).toContain('badgeRightOffset(insets.right)');
  });

  test('refreshes immediately on reconcile results', () => {
    expect(badgeSrc).toContain('onReconcileResult(');
  });
});

describe('sync-status screen — freshness wiring', () => {
  test('reconciles on focus/mount, polls only while submitted entries are visible, cleans up on blur', () => {
    expect(syncScreenSrc).toContain('useFocusEffect');
    expect(syncScreenSrc).toContain('load(true); // immediate pass on focus/mount');
    expect(syncScreenSrc).toContain("i.status === 'submitted' || i.status === 'edit_submitted'");
    expect(syncScreenSrc).toContain('clearInterval(timer)');
    expect(syncScreenSrc).toContain('unsubReconcile()');
    expect(syncScreenSrc).toContain('onReconcileResult(');
  });
});
