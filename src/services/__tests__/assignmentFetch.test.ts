const mockStore: Record<string, string> = {};
const mockSecure: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
    removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => (k in mockSecure ? mockSecure[k] : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockSecure[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockSecure[k]; }),
}));

jest.mock('../firebaseAuthSession', () => ({
  getValidIdToken: jest.fn(async () => { throw Object.assign(new Error('missing'), { name: 'AuthSessionError' }); }),
  authorizedCallable: jest.fn(async () => { throw new Error('no_live'); }),
}));

import { bumpSessionGeneration, fetchAssignmentClassified, persistBootstrapEnvelopeForTests, resetWellConfigCacheForTests, resolveCurrentEligibility, seedWellConfigCacheForTests } from '../wellConfig';
import { decideBootstrapRoute, decidePostAuthRoute } from '../eligibility';
import { authorizeEstablishedSession } from '../postAuthGate';
import { snapshotToEnvelope, type WbmBootstrapSnapshot } from '../wbmBootstrapCache';

function snap(routes: string[] | null, extra: Partial<WbmBootstrapSnapshot> = {}): WbmBootstrapSnapshot {
  return {
    ok: true,
    driverId: 'drv_1',
    companyId: 'co_1',
    active: true,
    assignedRoutes: routes,
    assignedWells: extra.assignedWells ?? (routes ? [] : null),
    assignmentRevision: 1,
    assignmentDigest: 'dig',
    eligibilityStatus: extra.eligibilityStatus ?? (routes && routes.some((r) => !r.startsWith('Unrouted') && r.length) ? 'eligible' : (routes && routes.length === 0 ? 'ineligible' : 'unknown')),
    eligibilityReason: extra.eligibilityReason ?? 'scope_ok',
    wells: extra.wells ?? {},
    wellCount: 0,
    ...extra,
  };
}

describe('classified assignment fetch never becomes [] denial', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockStore)) delete mockStore[k];
    for (const k of Object.keys(mockSecure)) delete mockSecure[k];
    mockSecure.driverId = 'drv_1';
    mockSecure.companyId = 'co_1';
    resetWellConfigCacheForTests();
  });

  const failCases: Array<[string, () => Promise<unknown>]> = [
    ['missing driver ID', async () => {
      delete mockSecure.driverId;
      return fetchAssignmentClassified(async () => { throw new Error('unused'); });
    }],
    ['callable failure', async () => fetchAssignmentClassified(async () => { throw new Error('unavailable'); })],
    ['timeout', async () => {
      const e = new Error('aborted');
      (e as any).name = 'AbortError';
      return fetchAssignmentClassified(async () => { throw e; });
    }],
  ];

  for (const [name, run] of failCases) {
    test(`${name} → unknown, never /no-access`, async () => {
      const v = await run() as { status: string };
      expect(v.status).toBe('unknown');
      expect(decideBootstrapRoute({
        hasLocalSession: true,
        revalidation: 'valid',
        eligibility: v.status as 'unknown',
      })).not.toBe('/no-access');
    });
  }

  test('authoritative real route is eligible', async () => {
    const v = await fetchAssignmentClassified(async () => snap(['North Loop'], { eligibilityStatus: 'eligible', eligibilityReason: 'scope_ok' }));
    expect(v.status).toBe('eligible');
    expect(v.routes).toEqual(['North Loop']);
  });

  test('same exact identity re-tickets a successful bootstrap after session publication advances generation', async () => {
    const v = await fetchAssignmentClassified(async () => {
      bumpSessionGeneration();
      return snap(['Gabriels'], {
        eligibilityStatus: 'eligible',
        eligibilityReason: 'scope_ok',
        wells: { 'Canonical Well': { route: 'Gabriels' } },
      });
    });
    expect(v).toMatchObject({
      status: 'eligible',
      source: 'authoritative',
      routes: ['Gabriels'],
    });
  });

  test('generation retry remains fail-closed when the current company changes', async () => {
    const v = await fetchAssignmentClassified(async () => {
      bumpSessionGeneration();
      mockSecure.companyId = 'foreign-company';
      return snap(['Gabriels'], { eligibilityStatus: 'eligible' });
    });
    expect(v).toMatchObject({ status: 'unknown', reason: 'stale_bootstrap' });
  });

  test('durable last-known eligibility after bootstrap envelope', async () => {
    const env = snapshotToEnvelope(snap(['East'], { eligibilityStatus: 'eligible', eligibilityReason: 'scope_ok' }));
    seedWellConfigCacheForTests(env);
    await persistBootstrapEnvelopeForTests(snap(['East'], { eligibilityStatus: 'eligible', eligibilityReason: 'scope_ok' }));
    const v = await resolveCurrentEligibility();
    expect(v.status).toBe('eligible');
    expect(v.routes).toEqual(['East']);
  });

  test('authorizeEstablishedSession: durable eligible + live fail still grants', async () => {
    await persistBootstrapEnvelopeForTests(snap(['East'], { eligibilityStatus: 'eligible', eligibilityReason: 'scope_ok' }));
    const manual = await authorizeEstablishedSession({ eligibleDestination: '/welcome', revalidation: 'valid' });
    expect(manual).toBe('/welcome');
  });

  test('authorizeEstablishedSession: explicit empty routes → /no-access', async () => {
    const v = await fetchAssignmentClassified(async () => snap([], {
      eligibilityStatus: 'ineligible',
      eligibilityReason: 'scope_empty',
    }));
    expect(v.status).toBe('ineligible');
    expect(decidePostAuthRoute({
      hasLocalSession: true, revalidation: 'valid', eligibility: v.status, eligibleDestination: '/welcome',
    })).toBe('/no-access');
  });
});
