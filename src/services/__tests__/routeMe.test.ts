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
  setDriverIdentityForTests,
  clearInFlightDispatchesForTests,
  STORAGE_KEY_DRIVER_DISPATCHES,
  STORAGE_KEY_PENDING_DISPATCH_ATTEMPTS,
  type RouteMePlannedJob,
} from '../routeMe';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('Route Me Day Planning Surface', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    setGovernedRevisionForTests(null);
    setDriverIdentityForTests(null);
    clearInFlightDispatchesForTests();
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

  test('createWbmDriverDispatch fails closed on definite offline error without creating phantom cards', async () => {
    setGovernedRevisionForTests(3);
    mockCallable.mockRejectedValueOnce(new Error('Device is offline'));

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

  test('lost response then retry reconciles with stable dispatchId: exactly one server dispatch and one local card', async () => {
    setGovernedRevisionForTests(3);
    const serverDispatches = new Map<string, any>();
    let callCount = 0;

    mockCallable.mockImplementation(async (method: string, payload: any) => {
      if (method === 'createDriverDispatchIfAbsent') {
        callCount++;
        const { dispatchId, record } = payload;
        if (serverDispatches.has(dispatchId)) {
          return { ok: true, result: 'already_exists', dispatchId };
        }
        // First attempt: Server creates the record, then response is dropped / times out
        serverDispatches.set(dispatchId, record);
        throw new Error('deadline-exceeded: Response timed out after server commit');
      }
      return { ok: true };
    });

    // 1. First attempt: call times out with ambiguous outcome
    const res1 = await createWbmDriverDispatch({
      wellName: 'TIMEOUT WELL',
      operator: 'OPERATOR A',
      jobType: 'pw',
      disposal: 'HYDRO CLEAR SWD',
      eligibleDisposals: ['HYDRO CLEAR SWD'],
    });

    expect(res1.ok).toBe(false);
    expect(res1.status).toBe('unknown');
    expect(res1.error).toMatch(/unknown_outcome/);

    // Assert: No phantom card saved locally
    const rawAfterAttempt1 = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
    const localCards1 = JSON.parse(rawAfterAttempt1 || '[]');
    expect(localCards1.find((c: any) => c.wellName === 'TIMEOUT WELL')).toBeUndefined();

    // Assert: Server has exactly 1 dispatch
    expect(serverDispatches.size).toBe(1);
    const originalDispatchId = Array.from(serverDispatches.keys())[0];

    // 2. Retry: User retries building the same well
    const res2 = await createWbmDriverDispatch({
      wellName: 'TIMEOUT WELL',
      operator: 'OPERATOR A',
      jobType: 'pw',
      disposal: 'HYDRO CLEAR SWD',
      eligibleDisposals: ['HYDRO CLEAR SWD'],
    });

    expect(res2.ok).toBe(true);
    expect(res2.status).toBe('already_exists');
    expect(res2.dispatchId).toBe(originalDispatchId);

    // Assert: Exactly ONE server dispatch (idempotency preserved, did not create second card)
    expect(serverDispatches.size).toBe(1);
    expect(callCount).toBe(2);

    // Assert: Exactly ONE local card saved with confirmed status
    const rawAfterAttempt2 = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
    const localCards2 = JSON.parse(rawAfterAttempt2 || '[]');
    const savedCard = localCards2.find((c: any) => c.wellName === 'TIMEOUT WELL');
    expect(savedCard).toBeDefined();
    expect(savedCard.dispatchId).toBe(originalDispatchId);
    expect(savedCard.status).toBe('pending');
    expect(savedCard.syncStatus).toBe('confirmed');
    expect(localCards2.filter((c: any) => c.wellName === 'TIMEOUT WELL')).toHaveLength(1);
  });

  test('createWbmDriverDispatch validates server result shape before local persistence', async () => {
    setGovernedRevisionForTests(3);
    mockCallable.mockResolvedValueOnce({ ok: true, result: 'unexpected_result_status' });

    const res = await createWbmDriverDispatch({
      wellName: 'BAD SHAPE WELL',
      jobType: 'pw',
      disposal: 'HYDRO CLEAR SWD',
      eligibleDisposals: ['HYDRO CLEAR SWD'],
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_server_result_shape');

    // No local card saved
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
    const stored = JSON.parse(raw || '[]');
    expect(stored.find((d: any) => d.wellName === 'BAD SHAPE WELL')).toBeUndefined();
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

  test('failure window: aborts before server call when pending attempt cannot be persisted to storage', async () => {
    setGovernedRevisionForTests(3);
    const origSetItem = AsyncStorage.setItem;
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(async (key: string) => {
      if (key === STORAGE_KEY_PENDING_DISPATCH_ATTEMPTS) {
        throw new Error('disk_full: cannot write pending attempt');
      }
    });

    const res = await createWbmDriverDispatch({
      wellName: 'STORAGE FAIL WELL',
      jobType: 'pw',
      disposal: 'HYDRO CLEAR SWD',
      eligibleDisposals: ['HYDRO CLEAR SWD'],
    });

    // Aborts and fails closed
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/storage_failure/);

    // Server was NOT called
    expect(mockCallable).not.toHaveBeenCalled();

    // No local card saved
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
    expect(raw).toBeNull();
  });

  test('account switch: different driver identities get distinct dispatch IDs and isolated attempts', async () => {
    setGovernedRevisionForTests(3);

    // Driver A attempts dispatch, which encounters a network timeout
    mockCallable.mockRejectedValueOnce(new Error('deadline-exceeded: timeout'));
    const resA = await createWbmDriverDispatch({
      wellName: 'SHARED WELL',
      jobType: 'pw',
      disposal: 'HYDRO CLEAR SWD',
      eligibleDisposals: ['HYDRO CLEAR SWD'],
      driverId: 'driver_A',
    });
    expect(resA.ok).toBe(false);
    expect(resA.status).toBe('unknown');
    const dispatchIdA = resA.dispatchId;
    expect(dispatchIdA).toBeTruthy();

    // Now Driver B logs in and attempts dispatch on the same well
    mockCallable.mockResolvedValueOnce({ ok: true, result: 'created', dispatchId: 'disp_driver_B' });
    const resB = await createWbmDriverDispatch({
      wellName: 'SHARED WELL',
      jobType: 'pw',
      disposal: 'HYDRO CLEAR SWD',
      eligibleDisposals: ['HYDRO CLEAR SWD'],
      driverId: 'driver_B',
    });
    expect(resB.ok).toBe(true);
    expect(resB.dispatchId).toBe('disp_driver_B');

    // Verify Driver B's call used a distinct dispatchId sent to server, NOT Driver A's ID
    expect(mockCallable).toHaveBeenLastCalledWith('createDriverDispatchIfAbsent', expect.objectContaining({
      dispatchId: expect.not.stringMatching(dispatchIdA!),
    }));
  });

  test('changed payload: allocates a fresh dispatch ID rather than reusing the ID for different details', async () => {
    setGovernedRevisionForTests(3);

    // First attempt with disposal 1 encounters a timeout
    mockCallable.mockRejectedValueOnce(new Error('deadline-exceeded: timeout'));
    const res1 = await createWbmDriverDispatch({
      wellName: 'CHANGED PAYLOAD WELL',
      jobType: 'pw',
      disposal: 'DISPOSAL 1 SWD',
      eligibleDisposals: ['DISPOSAL 1 SWD', 'DISPOSAL 2 SWD'],
      driverId: 'driver_X',
    });
    expect(res1.ok).toBe(false);
    expect(res1.status).toBe('unknown');
    const origDispatchId = res1.dispatchId;
    expect(origDispatchId).toBeTruthy();

    // User changes disposal to DISPOSAL 2 SWD and attempts again
    mockCallable.mockResolvedValueOnce({ ok: true, result: 'created', dispatchId: 'fresh_disp_id' });
    const res2 = await createWbmDriverDispatch({
      wellName: 'CHANGED PAYLOAD WELL',
      jobType: 'pw',
      disposal: 'DISPOSAL 2 SWD',
      eligibleDisposals: ['DISPOSAL 1 SWD', 'DISPOSAL 2 SWD'],
      driverId: 'driver_X',
    });
    expect(res2.ok).toBe(true);

    // The call to the server must NOT have reused origDispatchId because the payload changed
    expect(mockCallable).toHaveBeenLastCalledWith('createDriverDispatchIfAbsent', expect.objectContaining({
      dispatchId: expect.not.stringMatching(origDispatchId!),
      record: expect.objectContaining({
        disposal: 'DISPOSAL 2 SWD',
      }),
    }));
  });

  test('concurrent createWbmDriverDispatch calls for the same intent share one durable ID and call server once', async () => {
    setGovernedRevisionForTests(3);
    let callableCalls = 0;
    mockCallable.mockImplementation(async () => {
      callableCalls++;
      // Simulate asynchronous server round-trip latency
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { ok: true, result: 'created', dispatchId: 'shared_concurrent_disp_id' };
    });

    const [res1, res2] = await Promise.all([
      createWbmDriverDispatch({
        wellName: 'CONCURRENT WELL',
        jobType: 'pw',
        disposal: 'HYDRO CLEAR SWD',
        eligibleDisposals: ['HYDRO CLEAR SWD'],
      }),
      createWbmDriverDispatch({
        wellName: 'CONCURRENT WELL',
        jobType: 'pw',
        disposal: 'HYDRO CLEAR SWD',
        eligibleDisposals: ['HYDRO CLEAR SWD'],
      }),
    ]);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(res1.dispatchId).toBe('shared_concurrent_disp_id');
    expect(res2.dispatchId).toBe('shared_concurrent_disp_id');
    expect(callableCalls).toBe(1);

    // Exactly one card saved in local storage
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
    const stored = JSON.parse(raw || '[]');
    expect(stored.filter((d: any) => d.wellName === 'CONCURRENT WELL')).toHaveLength(1);
  });

  test('failure window: local confirmed persistence failure preserves pending attempt for retry', async () => {
    setGovernedRevisionForTests(3);
    mockCallable.mockResolvedValueOnce({ ok: true, result: 'created', dispatchId: 'wbm_disp_recov' });

    // Mock AsyncStorage.setItem to fail only when saving STORAGE_KEY_DRIVER_DISPATCHES
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, val: string) => {
      if (key === STORAGE_KEY_DRIVER_DISPATCHES) {
        throw new Error('sqlite_write_error: disk write failed');
      }
      mockStore[key] = val;
    });

    const res = await createWbmDriverDispatch({
      wellName: 'RECOVERY WELL',
      jobType: 'pw',
      disposal: 'HYDRO CLEAR SWD',
      eligibleDisposals: ['HYDRO CLEAR SWD'],
      dispatchId: 'wbm_disp_recov',
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBe('unknown');
    expect(res.error).toMatch(/local_persistence_failed/);

    // Restore setItem
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, val: string) => {
      mockStore[key] = val;
    });

    // Verify pending attempt was NOT cleared (preserved for retry)
    const rawAttempts = await AsyncStorage.getItem(STORAGE_KEY_PENDING_DISPATCH_ATTEMPTS);
    expect(rawAttempts).toBeTruthy();
    expect(rawAttempts).toContain('wbm_disp_recov');

    // On retry, server says 'already_exists', local storage succeeds
    mockCallable.mockResolvedValueOnce({ ok: true, result: 'already_exists', dispatchId: 'wbm_disp_recov' });
    const retryRes = await createWbmDriverDispatch({
      wellName: 'RECOVERY WELL',
      jobType: 'pw',
      disposal: 'HYDRO CLEAR SWD',
      eligibleDisposals: ['HYDRO CLEAR SWD'],
    });

    expect(retryRes.ok).toBe(true);
    expect(retryRes.status).toBe('already_exists');
    expect(retryRes.dispatchId).toBe('wbm_disp_recov');

    // Local card is now confirmed and saved
    const rawDispatches = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
    const stored = JSON.parse(rawDispatches || '[]');
    expect(stored.find((d: any) => d.dispatchId === 'wbm_disp_recov')).toBeDefined();

    // Pending attempt is now cleared
    const rawAttemptsAfter = await AsyncStorage.getItem(STORAGE_KEY_PENDING_DISPATCH_ATTEMPTS);
    expect(rawAttemptsAfter).not.toContain('wbm_disp_recov');
  });
});
