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
jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn() }));
jest.mock('expo-device', () => ({ modelName: 'test' }));

const mocks = {
  clearAuthSession: jest.fn(async () => undefined),
};
let mockUser: { uid: string } | null = { uid: 'uid-a' };
jest.mock('../firebaseAuthSession', () => ({
  clearAuthSession: () => mocks.clearAuthSession(),
  authorizedCallable: jest.fn(),
  getFirebaseAuth: () => ({ currentUser: mockUser }),
}));

import { clearDriverSession } from '../driverAuth';
import {
  getSessionGeneration,
  peekWellConfigCacheForTests,
  resetWellConfigCacheForTests,
  seedWellConfigCacheForTests,
} from '../wellConfig';
import { snapshotToEnvelope, type WbmBootstrapSnapshot } from '../wbmBootstrapCache';

function snap(driverId: string): WbmBootstrapSnapshot {
  return {
    ok: true,
    driverId,
    companyId: 'liquid-gold',
    active: true,
    assignedRoutes: ['Gabriels'],
    assignedWells: [],
    assignmentRevision: 1,
    assignmentDigest: `dig-${driverId}`,
    eligibilityStatus: 'eligible',
    eligibilityReason: 'scope_ok',
    wells: {
      [`${driverId}-well`]: { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Gabriels' },
    },
    wellCount: 1,
    logoutAt: null,
  };
}

describe('clearDriverSession generation fence', () => {
  beforeEach(() => {
    resetWellConfigCacheForTests();
    mocks.clearAuthSession.mockReset();
    mockUser = { uid: 'uid-a' };
    for (const k of Object.keys(mockSecure)) delete mockSecure[k];
    mockSecure.driverId = 'driver-a';
    mockSecure.companyId = 'liquid-gold';
    mockSecure.authMethod = 'sso';
    mockSecure.driverVerifiedAt = '1000';
    mockSecure.wb_auth_uid = 'uid-a';
  });

  it('logout begins while signOut is deferred; generation is already incremented and memory already cleared', async () => {
    seedWellConfigCacheForTests(snapshotToEnvelope(snap('driver-a')));
    expect(peekWellConfigCacheForTests().config?.['driver-a-well']).toBeTruthy();
    const genBefore = getSessionGeneration();

    let releaseSignOut: () => void = () => undefined;
    mocks.clearAuthSession.mockImplementationOnce(() => new Promise((resolve) => {
      releaseSignOut = () => resolve(undefined);
    }));

    const pending = clearDriverSession();
    for (let i = 0; i < 40 && mocks.clearAuthSession.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(mocks.clearAuthSession).toHaveBeenCalled();
    expect(getSessionGeneration()).toBe(genBefore + 1);
    expect(peekWellConfigCacheForTests()).toEqual({ config: null, envelope: null });

    releaseSignOut();
    await pending;
    expect(getSessionGeneration()).toBe(genBefore + 1);
    expect(peekWellConfigCacheForTests()).toEqual({ config: null, envelope: null });
    expect(mockSecure.driverId).toBeUndefined();
  });
});
