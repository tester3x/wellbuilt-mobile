// Route Me client contract (WB-M Phase 1 visual-only pilot):
// fail-closed fetch, always-disabled DDJD, non-selectable muted/assigned wells.

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
