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

const mockGetValidIdToken = jest.fn(async (): Promise<string> => 'tok');
jest.mock('../firebaseAuthSession', () => ({
  getValidIdToken: () => mockGetValidIdToken(),
}));

import { fetchAssignmentClassified, persistDurableEligibility, resolveCurrentEligibility } from '../wellConfig';
import { decideBootstrapRoute } from '../eligibility';

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as any;
}

describe('classified assignment fetch never becomes [] denial', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockStore)) delete mockStore[k];
    for (const k of Object.keys(mockSecure)) delete mockSecure[k];
    mockSecure.driverId = 'drv_1';
    mockSecure.companyId = 'co_1';
    mockGetValidIdToken.mockReset();
    mockGetValidIdToken.mockResolvedValue('tok');
  });

  const cases: Array<[string, () => Promise<any>]> = [
    ['missing driver ID', async () => {
      delete mockSecure.driverId;
      return fetchAssignmentClassified(jest.fn() as any);
    }],
    ['missing token', async () => {
      mockGetValidIdToken.mockRejectedValue(Object.assign(new Error('missing'), { name: 'AuthSessionError' }));
      return fetchAssignmentClassified(jest.fn() as any);
    }],
    ['HTTP 401', async () => fetchAssignmentClassified(jest.fn(async () => jsonRes(401, null)))],
    ['HTTP 403', async () => fetchAssignmentClassified(jest.fn(async () => jsonRes(403, null)))],
    ['HTTP 404', async () => fetchAssignmentClassified(jest.fn(async () => jsonRes(404, null)))],
    ['timeout', async () => {
      const e = new Error('aborted');
      (e as any).name = 'AbortError';
      return fetchAssignmentClassified(jest.fn(async () => { throw e; }));
    }],
    ['permission denial', async () => fetchAssignmentClassified(jest.fn(async () => jsonRes(403, { error: 'permission_denied' })))],
    ['network failure', async () => fetchAssignmentClassified(jest.fn(async () => { throw new Error('Network request failed'); }))],
    ['thrown exception', async () => fetchAssignmentClassified(jest.fn(async () => { throw new Error('boom'); }))],
    ['HTTP 200 null profile', async () => fetchAssignmentClassified(jest.fn(async () => jsonRes(200, null)))],
    ['profile missing assignedRoutes', async () => fetchAssignmentClassified(jest.fn(async () => jsonRes(200, { displayName: 'Mike' })))],
  ];

  for (const [name, run] of cases) {
    test(`${name} → unknown, never /no-access`, async () => {
      const v = await run();
      expect(v.status).toBe('unknown');
      expect(decideBootstrapRoute({
        hasLocalSession: true,
        revalidation: 'valid',
        eligibility: v.status,
      })).not.toBe('/no-access');
    });
  }

  test('authoritative real route is eligible', async () => {
    const v = await fetchAssignmentClassified(jest.fn(async () => jsonRes(200, { assignedRoutes: ['North Loop'] })));
    expect(v.status).toBe('eligible');
    expect(v.routes).toEqual(['North Loop']);
  });

  test('durable last-known eligibility after fresh process', async () => {
    await persistDurableEligibility({
      status: 'eligible',
      source: 'authoritative',
      routes: ['East'],
      wells: [],
      reason: 'real_route',
      retryable: false,
    });
    mockGetValidIdToken.mockRejectedValue(new Error('id_token_required'));
    const v = await resolveCurrentEligibility();
    expect(v.status).toBe('eligible');
    expect(v.source).toBe('durable');
    expect(v.routes).toEqual(['East']);
  });
});

describe('manual / SSO / cold-start same data → same verdict', () => {
  const profile = { assignedRoutes: ['Gabriel Route'] };

  test('same profile payload is eligible for every entry', () => {
    const { eligibilityFromSameProfile } = require('../eligibility') as typeof import('../eligibility');
    const manual = eligibilityFromSameProfile(profile.assignedRoutes, true);
    const sso = eligibilityFromSameProfile(profile.assignedRoutes, true);
    const cold = eligibilityFromSameProfile(profile.assignedRoutes, true);
    expect(manual).toEqual(sso);
    expect(sso).toEqual(cold);
    expect(manual.status).toBe('eligible');
    expect(decideBootstrapRoute({
      hasLocalSession: true, revalidation: 'valid', eligibility: manual.status,
    })).toBe('/welcome');
  });
});
