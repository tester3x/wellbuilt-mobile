const mockStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    __store: mockStore,
    getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
    removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
    clear: jest.fn(async () => {
      for (const k of Object.keys(mockStore)) delete mockStore[k];
    }),
  },
}));

const mockCallable = jest.fn();
jest.mock('../firebaseAuthSession', () => ({
  __esModule: true,
  authorizedCallable: (...args: unknown[]) => mockCallable(...args),
}));

import {
  fetchRouteMe,
  deniedRouteMe,
  ddjdButtonState,
  isSelectableForDdjd,
  DEFAULT_DDJD_PILOT_REASON,
  ROUTE_ME_PHASE,
  type RouteMeCapabilities,
  type RouteMeWell,
} from '../routeMe';

beforeEach(() => mockCallable.mockReset());

const caps = (over: Partial<RouteMeCapabilities> = {}): RouteMeCapabilities => ({
  canViewRouteMe: true, canCreateWbmPull: true, canCreateDdjd: true,
  ddjdUnavailableReason: DEFAULT_DDJD_PILOT_REASON, ...over,
});
const well = (over: Partial<RouteMeWell> = {}): RouteMeWell => ({
  wellName: 'W', companyId: 'c1', wellId: 'id1', levelDisplay: "7'", timeTillPull: '2h',
  priorityState: 'approaching', predictedReadyAtMs: 1, assignmentState: 'unassigned',
  muted: false, recommendedDisposal: 'SWD A', ...over,
});

test('Phase 1 constant is 1', () => { expect(ROUTE_ME_PHASE).toBe(1); });

test('deniedRouteMe fails closed — no entitlement, no wells, honest reason', () => {
  const r = deniedRouteMe('nope');
  expect(r.ok).toBe(false);
  expect(r.capabilities.canViewRouteMe).toBe(false);
  expect(r.capabilities.canCreateDdjd).toBe(false);
  expect(r.wells).toEqual([]);
  expect(r.unavailableReason).toBe('nope');
});

test('ddjdButtonState is ALWAYS disabled in Phase 1, with honest reason', () => {
  const a = ddjdButtonState(caps({ canCreateDdjd: true }), 3);
  expect(a.disabled).toBe(true);          // even when server says canCreateDdjd
  expect(a.label).toBe('Load DDJD (3)');
  const b = ddjdButtonState(caps({ canCreateDdjd: false, ddjdUnavailableReason: 'WB-T not enabled' }), 0);
  expect(b.disabled).toBe(true);
  expect(b.reason).toBe('WB-T not enabled');
});

test('only unassigned + unmuted wells are selectable for DDJD (UX preview)', () => {
  expect(isSelectableForDdjd(well({ assignmentState: 'unassigned', muted: false }))).toBe(true);
  expect(isSelectableForDdjd(well({ assignmentState: 'assigned_other', muted: true }))).toBe(false);
  expect(isSelectableForDdjd(well({ assignmentState: 'assigned_self' }))).toBe(false);
  expect(isSelectableForDdjd(well({ assignmentState: 'in_ddjd' }))).toBe(false);
  expect(isSelectableForDdjd(well({ assignmentState: 'unassigned', muted: true }))).toBe(false);
});

test('fetchRouteMe passes through a valid server result (self scope, no client identity)', async () => {
  mockCallable.mockResolvedValueOnce({ ok: true, capabilities: caps(), wells: [well()], asOfMs: 123 });
  const r = await fetchRouteMe();
  expect(mockCallable).toHaveBeenCalledWith('getDriverRouteMe', {}); // self mode — empty payload
  expect(r.capabilities.canViewRouteMe).toBe(true);
  expect(r.wells).toHaveLength(1);
});

test('fetchRouteMe fails closed when the endpoint is not deployed (not-found)', async () => {
  const err = Object.assign(new Error('x'), { callableStatus: 'not-found' });
  mockCallable.mockRejectedValueOnce(err);
  const r = await fetchRouteMe();
  expect(r.capabilities.canViewRouteMe).toBe(false);
  expect(r.wells).toEqual([]);
  expect(r.unavailableReason).toMatch(/being enabled/);
});

test('fetchRouteMe fails closed on a generic error (read failure, not empty route)', async () => {
  mockCallable.mockRejectedValueOnce(new Error('network'));
  const r = await fetchRouteMe();
  expect(r.capabilities.canViewRouteMe).toBe(false);
  expect(r.unavailableReason).toMatch(/temporarily unavailable/);
});

test('fetchRouteMe fails closed when server denies entitlement (canViewRouteMe false)', async () => {
  mockCallable.mockResolvedValueOnce({ ok: true, capabilities: caps({ canViewRouteMe: false }), wells: [], asOfMs: null });
  const r = await fetchRouteMe();
  expect(r.capabilities.canViewRouteMe).toBe(false);
});

// ── Day Planning Tests ──

import {
  buildRouteMeDayPlanFromSummary,
  isCardAlreadyBuilt,
  reorderPlannedJobs,
  createWbmDriverDispatch,
  setGovernedRevisionForTests,
  STORAGE_KEY_DRIVER_DISPATCHES,
  type RouteMePlannedJob,
} from '../routeMe';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('Route Me Day Planning Surface', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setGovernedRevisionForTests(null);
  });

  test('buildRouteMeDayPlanFromSummary pins active/paused jobs at top, computes Summary metrics, and distinguishes unbuilt wells', () => {
    const wellConfig = {
      'GABRIEL 1-36-25H': { operator: 'CONTINENTAL', numTanks: 2, loadLine: 1.33, allowedBottom: 1.33, avgFlowRateMinutes: 60 },
      'DAHL 1-12H': { operator: 'HESS', numTanks: 1, loadLine: 1.33, allowedBottom: 1.33, avgFlowRateMinutes: 45 },
      'UNBUILT WELL 3': { operator: 'WHITING', numTanks: 2, loadLine: 1.33, allowedBottom: 1.33, avgFlowRateMinutes: 90 },
    };
    const now = Date.parse('2026-09-28T12:00:00Z');
    const snapshots = new Map<string, any>([
      ['GABRIEL 1-36-25H', { levelFeet: 10, lastPullBottomLevelFeet: 10, flowRateMinutes: 60, timestamp: now - 3600000, isDown: false }],
      ['DAHL 1-12H', { levelFeet: 8, lastPullBottomLevelFeet: 8, flowRateMinutes: 45, timestamp: now - 3600000, isDown: false }],
      ['UNBUILT WELL 3', { levelFeet: 6, lastPullBottomLevelFeet: 6, flowRateMinutes: 90, timestamp: now - 3600000, isDown: false }],
    ]);

    const existingDispatches = [
      { id: 'disp_act', wellName: 'GABRIEL 1-36-25H', status: 'active', jobType: 'pw' },
      { id: 'disp_pau', wellName: 'DAHL 1-12H', status: 'paused', jobType: 'sw' },
    ];

    const plan = buildRouteMeDayPlanFromSummary({
      wellConfig,
      snapshots,
      existingDispatches,
      pullBbls: 140,
      now,
    });

    // Pinned active / paused at top
    expect(plan.pinnedJobs).toHaveLength(2);
    expect(plan.pinnedJobs[0].wellName).toBe('GABRIEL 1-36-25H');
    expect(plan.pinnedJobs[0].status).toBe('active');
    expect(plan.pinnedJobs[1].wellName).toBe('DAHL 1-12H');
    expect(plan.pinnedJobs[1].status).toBe('paused');

    // Summary calculations on candidate wells
    const candG1 = plan.candidateWells.find(w => w.wellName === 'GABRIEL 1-36-25H');
    const candUnbuilt = plan.candidateWells.find(w => w.wellName === 'UNBUILT WELL 3');
    expect(candG1?.isCardBuilt).toBe(true);
    expect(candUnbuilt?.isCardBuilt).toBe(false);
    expect(candUnbuilt?.status).toBe('unbuilt');
    expect(candUnbuilt?.bblsAvailable).toBeGreaterThan(0);
    expect(candUnbuilt?.currentLevelDisplay).toBeTruthy();
    expect(candUnbuilt?.readyTimeDisplay).toBeTruthy();
  });

  test('reorderPlannedJobs permits SW and PW reordering but blocks split-ticket sequence violations', () => {
    const jobs: RouteMePlannedJob[] = [
      { id: '1', kind: 'pending_dispatch', wellName: 'WELL 1', jobType: 'pw', status: 'pending', isCardBuilt: true },
      { id: '2', kind: 'pending_dispatch', wellName: 'WELL 2', jobType: 'sw', status: 'pending', isCardBuilt: true },
      { id: '3', kind: 'pending_dispatch', wellName: 'SPLIT A', jobType: 'sw', status: 'pending', isCardBuilt: true, splitGroupId: 'grp1', splitSequence: 1 },
      { id: '4', kind: 'pending_dispatch', wellName: 'SPLIT B', jobType: 'sw', status: 'pending', isCardBuilt: true, splitGroupId: 'grp1', splitSequence: 2 },
    ];

    // Reorder non-split jobs
    const r1 = reorderPlannedJobs(jobs, 1, 0);
    expect(r1.ok).toBe(true);
    expect(r1.reordered[0].id).toBe('2');

    // Reorder split leg 2 before leg 1 -> BLOCKED
    const rInvalid = reorderPlannedJobs(jobs, 3, 2);
    expect(rInvalid.ok).toBe(false);
    expect(rInvalid.error).toMatch(/split_ticket_sequence_violation/);
  });

  test('createWbmDriverDispatch fails closed when packetRevision is unresolved', async () => {
    setGovernedRevisionForTests(null);
    mockCallable.mockResolvedValueOnce({ ok: true, governedPackageProfiles: [] });

    const res = await createWbmDriverDispatch({
      wellName: 'NEW WELL 1',
      disposal: 'HYDRO CLEAR SWD',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/packet_revision_unresolved/);

    // No local card created
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
    expect(raw).toBeNull();
  });

  test('createWbmDriverDispatch requires verified eligible drop-off for PW and rejects absent or ineligible disposal', async () => {
    setGovernedRevisionForTests(3);

    // 1. Missing disposal for PW
    const resMissing = await createWbmDriverDispatch({
      wellName: 'PW WELL 1',
      jobType: 'pw',
    });
    expect(resMissing.ok).toBe(false);
    expect(resMissing.error).toMatch(/disposal_required/);

    // 2. Ineligible disposal for PW
    const resIneligible = await createWbmDriverDispatch({
      wellName: 'PW WELL 1',
      jobType: 'pw',
      disposal: 'UNAPPROVED SWD',
      eligibleDisposals: ['HYDRO CLEAR SWD'],
    });
    expect(resIneligible.ok).toBe(false);
    expect(resIneligible.error).toBe('disposal_not_eligible');

    // 3. Service Work (SW) does NOT require an SWD drop-off and binds canonical jobTypeId: 'service-work'
    mockCallable.mockResolvedValueOnce({ ok: true, result: 'created', dispatchId: 'wbm_sw_1' });
    const resSw = await createWbmDriverDispatch({
      wellName: 'SW WELL 1',
      jobType: 'sw',
    });
    expect(resSw.ok).toBe(true);
    expect(resSw.status).toBe('created');
    expect(mockCallable).toHaveBeenCalledWith('createDriverDispatchIfAbsent', expect.objectContaining({
      packetRef: { packageId: 'water-hauling', revision: 3 },
      record: expect.objectContaining({
        wellName: 'SW WELL 1',
        jobType: 'service',
        jobTypeId: 'service-work',
      }),
    }));
  });

  test('createWbmDriverDispatch calls server callable FIRST and never shows a phantom card on failure', async () => {
    setGovernedRevisionForTests(3);
    mockCallable.mockRejectedValueOnce(new Error('failed-precondition: unscoped_driver'));

    const res = await createWbmDriverDispatch({
      wellName: 'PW WELL FAIL',
      jobType: 'pw',
      disposal: 'HYDRO CLEAR SWD',
      eligibleDisposals: ['HYDRO CLEAR SWD'],
    });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unscoped_driver/);

    // NO phantom card saved to local storage
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
    const stored = JSON.parse(raw || '[]');
    expect(stored.find((d: any) => d.wellName === 'PW WELL FAIL')).toBeUndefined();
  });

  test('createWbmDriverDispatch fails closed on offline network error without creating phantom cards', async () => {
    setGovernedRevisionForTests(3);
    mockCallable.mockRejectedValueOnce(new Error('Network request failed'));

    const res = await createWbmDriverDispatch({
      wellName: 'PW WELL OFFLINE',
      jobType: 'pw',
      disposal: 'HYDRO CLEAR SWD',
      eligibleDisposals: ['HYDRO CLEAR SWD'],
    });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/offline_unavailable/);

    // Stored dispatch doc is NOT created (no phantom cards)
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
    const stored = JSON.parse(raw || '[]');
    expect(stored.find((d: any) => d.wellName === 'PW WELL OFFLINE')).toBeUndefined();
  });

  test('createWbmDriverDispatch creates pending DDJD card with confirmed syncStatus on server success', async () => {
    setGovernedRevisionForTests(3);
    mockCallable.mockResolvedValueOnce({ ok: true, result: 'created', dispatchId: 'wbm_disp_123' });

    const res1 = await createWbmDriverDispatch({
      wellName: 'CONFIRMED WELL',
      operator: 'OPERATOR X',
      jobType: 'pw',
      disposal: 'HYDRO CLEAR SWD',
      eligibleDisposals: ['HYDRO CLEAR SWD'],
    });

    expect(res1.ok).toBe(true);
    expect(res1.status).toBe('created');
    expect(mockCallable).toHaveBeenCalledWith('createDriverDispatchIfAbsent', expect.objectContaining({
      packetRef: { packageId: 'water-hauling', revision: 3 },
      record: expect.objectContaining({
        wellName: 'CONFIRMED WELL',
        operator: 'OPERATOR X',
        jobType: 'pw',
        jobTypeId: 'pw',
        disposal: 'HYDRO CLEAR SWD',
      }),
    }));

    // Stored dispatch doc is pending with confirmed syncStatus
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
    const stored = JSON.parse(raw || '[]');
    const card = stored.find((d: any) => d.wellName === 'CONFIRMED WELL');
    expect(card).toBeDefined();
    expect(card.status).toBe('pending');
    expect(card.syncStatus).toBe('confirmed');
    expect(card.packetRevision).toBe(3);

    // Duplicate build is prevented
    const resDup = await createWbmDriverDispatch({
      wellName: 'CONFIRMED WELL',
      operator: 'OPERATOR X',
      jobType: 'pw',
      disposal: 'HYDRO CLEAR SWD',
    });
    expect(resDup.ok).toBe(false);
    expect(resDup.error).toBe('duplicate_card_exists');
  });
});
