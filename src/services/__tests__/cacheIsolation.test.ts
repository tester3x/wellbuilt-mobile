jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
      setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
      removeItem: jest.fn(async (k: string) => { delete store[k]; }),
    },
  };
});

const mockSecure: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => (k in mockSecure ? mockSecure[k] : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockSecure[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockSecure[k]; }),
}));

const mockCallable = jest.fn();
jest.mock('../firebaseAuthSession', () => ({
  authorizedCallable: (...args: unknown[]) => mockCallable(...args),
  clearAuthSession: jest.fn(async () => undefined),
}));

import {
  cacheMatchesSession,
  clearWellConfigCache,
  loadWellConfig,
  peekWellConfigCacheForTests,
  resetWellConfigCacheForTests,
  seedWellConfigCacheForTests,
  scopeDigest,
  WellConfigUnavailableError,
} from '../wellConfig';

describe('WB-M cache isolation', () => {
  beforeEach(() => {
    resetWellConfigCacheForTests();
    for (const k of Object.keys(mockSecure)) delete mockSecure[k];
    mockCallable.mockReset();
  });

  it('binder matching is exact on driverId, companyId, and digest', () => {
    const a = { driverId: 'A', companyId: 'lg', digest: scopeDigest(['Gabriels'], []) };
    expect(cacheMatchesSession(a, a)).toBe(true);
    expect(cacheMatchesSession(a, { ...a, driverId: 'B' })).toBe(false);
    expect(cacheMatchesSession(a, { ...a, digest: scopeDigest([], []) })).toBe(false);
  });

  it('Driver B cannot inherit Driver A wells when live fetch is unavailable', async () => {
    seedWellConfigCacheForTests(
      { 'Gabriel 1': { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Gabriels' } },
      { driverId: 'driver-a', companyId: 'liquid-gold', digest: scopeDigest(['Gabriels'], []) },
    );
    mockSecure.driverId = 'driver-a';
    mockSecure.companyId = 'liquid-gold';

    await clearWellConfigCache();
    expect(peekWellConfigCacheForTests().config).toBeNull();

    mockSecure.driverId = 'driver-b';
    mockSecure.companyId = 'liquid-gold';
    mockCallable.mockRejectedValue(new Error('failed-precondition: scope_missing'));
    await expect(loadWellConfig(true)).rejects.toBeInstanceOf(WellConfigUnavailableError);
    expect(peekWellConfigCacheForTests().config).toBeNull();
  });
});
