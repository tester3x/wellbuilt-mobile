jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      __store: store,
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
  clearAuthSession: jest.fn(async () => {
    mockUser = null;
    delete mockSecure.wb_auth_uid;
  }),
};
let mockUser: { uid: string } | null = { uid: 'uid-a' };
const mockCallable = jest.fn();
jest.mock('../firebaseAuthSession', () => ({
  clearAuthSession: () => mocks.clearAuthSession(),
  authorizedCallable: (...args: unknown[]) => mockCallable(...args),
  getFirebaseAuth: () => ({ currentUser: mockUser }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  captureCurrentSessionPermit,
  clearDriverSession,
  performPermittedLogout,
} from '../driverAuth';
import { checkCanonicalSsoLogout } from '../ssoLogout';
import {
  beginLoginTransition,
  bumpSessionGeneration,
  getSessionGeneration,
  persistBootstrapEnvelopeForTests,
  peekWellConfigCacheForTests,
  removeEnvelopeIfExact,
  resetWellConfigCacheForTests,
  seedWellConfigCacheForTests,
  setEnvelopeRemovePauseForTests,
  WBM_ENVELOPE_KEY,
} from '../wellConfig';
import { snapshotToEnvelope, type WbmBootstrapSnapshot } from '../wbmBootstrapCache';

const asyncStore = (AsyncStorage as unknown as { __store: Record<string, string> }).__store;
const verified = Date.parse('2026-08-21T17:00:00.000Z');
const newer = Date.parse('2026-08-21T18:00:00.000Z');

function snap(driverId: string): WbmBootstrapSnapshot {
  return {
    ok: true,
    driverId,
    companyId: 'liquid-gold',
    active: true,
    assignedRoutes: [`route-${driverId}`],
    assignedWells: [`${driverId}-well`],
    assignmentRevision: 1,
    assignmentDigest: `dig-${driverId}`,
    eligibilityStatus: 'eligible',
    eligibilityReason: 'scope_ok',
    wells: {
      [`${driverId}-well`]: { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: `route-${driverId}` },
    },
    wellCount: 1,
    logoutAt: null,
  };
}

function installA() {
  mockUser = { uid: 'uid-a' };
  mockSecure.driverId = 'driver-a';
  mockSecure.companyId = 'liquid-gold';
  mockSecure.authMethod = 'sso';
  mockSecure.driverVerifiedAt = String(verified);
  mockSecure.wb_auth_uid = 'uid-a';
  mockSecure.assignedRoutes = JSON.stringify(['route-driver-a']);
  const env = snapshotToEnvelope(snap('driver-a'));
  seedWellConfigCacheForTests(env);
}

async function durableDriverId(): Promise<string | undefined> {
  const raw = asyncStore[WBM_ENVELOPE_KEY];
  if (!raw) return undefined;
  return (JSON.parse(raw) as { driverId?: string }).driverId;
}

describe('end-to-end session ownership', () => {
  beforeEach(async () => {
    resetWellConfigCacheForTests();
    for (const k of Object.keys(asyncStore)) delete asyncStore[k];
    for (const k of Object.keys(mockSecure)) delete mockSecure[k];
    mocks.clearAuthSession.mockReset();
    mocks.clearAuthSession.mockImplementation(async () => {
      mockUser = null;
      delete mockSecure.wb_auth_uid;
    });
    mockCallable.mockReset();
    installA();
    await persistBootstrapEnvelopeForTests(snap('driver-a'));
  });

  it('A permit is rejected after B authentication begins; B remains intact', async () => {
    mockCallable.mockResolvedValue({
      driverId: 'driver-a',
      companyId: 'liquid-gold',
      logoutAt: newer,
    });
    const permit = await checkCanonicalSsoLogout();
    expect(permit?.driverId).toBe('driver-a');
    expect(permit?.authUid).toBe('uid-a');

    await beginLoginTransition(async () => {
      mockUser = { uid: 'uid-b' };
      mockSecure.driverId = 'driver-b';
      mockSecure.companyId = 'liquid-gold';
      mockSecure.authMethod = 'sso';
      mockSecure.driverVerifiedAt = String(verified + 1);
      mockSecure.wb_auth_uid = 'uid-b';
      mockSecure.assignedRoutes = JSON.stringify(['route-driver-b']);
      await persistBootstrapEnvelopeForTests(snap('driver-b'));
    });

    const loggedOut = await performPermittedLogout(permit!);
    expect(loggedOut).toBe(false);
    expect(mockSecure.driverId).toBe('driver-b');
    expect(mockSecure.companyId).toBe('liquid-gold');
    expect(mockSecure.authMethod).toBe('sso');
    expect(mockSecure.driverVerifiedAt).toBe(String(verified + 1));
    expect(mockSecure.wb_auth_uid).toBe('uid-b');
    expect(mockUser?.uid).toBe('uid-b');
    expect(await durableDriverId()).toBe('driver-b');
    expect(peekWellConfigCacheForTests().envelope?.driverId).toBe('driver-b');
    expect(peekWellConfigCacheForTests().envelope?.eligibility.routes).toEqual(['route-driver-b']);
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
  });

  it('A logout with deferred signOut serializes behind B login; final state is completely B', async () => {
    const permit = await captureCurrentSessionPermit();
    expect(permit?.driverId).toBe('driver-a');
    const genBefore = getSessionGeneration();

    let releaseSignOut: () => void = () => undefined;
    mocks.clearAuthSession.mockImplementationOnce(() => new Promise((resolve) => {
      releaseSignOut = () => {
        mockUser = null;
        delete mockSecure.wb_auth_uid;
        resolve(undefined);
      };
    }));

    const pendingLogout = performPermittedLogout(permit!);
    for (let i = 0; i < 40 && mocks.clearAuthSession.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(mocks.clearAuthSession).toHaveBeenCalled();
    expect(getSessionGeneration()).toBe(genBefore + 1);
    expect(peekWellConfigCacheForTests().envelope).toBeNull();
    expect(mockSecure.driverId).toBe('driver-a');

    const pendingB = beginLoginTransition(async () => {
      mockUser = { uid: 'uid-b' };
      mockSecure.driverId = 'driver-b';
      mockSecure.companyId = 'liquid-gold';
      mockSecure.authMethod = 'sso';
      mockSecure.driverVerifiedAt = String(verified + 5);
      mockSecure.wb_auth_uid = 'uid-b';
      mockSecure.assignedRoutes = JSON.stringify(['route-driver-b']);
      await persistBootstrapEnvelopeForTests(snap('driver-b'));
    });

    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(mockSecure.driverId).toBe('driver-a');
    expect(await durableDriverId()).toBe('driver-a');

    releaseSignOut();
    const loggedOut = await pendingLogout;
    await pendingB;

    expect(loggedOut).toBe(true);
    expect(mockUser?.uid).toBe('uid-b');
    expect(mockSecure.driverId).toBe('driver-b');
    expect(mockSecure.companyId).toBe('liquid-gold');
    expect(mockSecure.authMethod).toBe('sso');
    expect(mockSecure.driverVerifiedAt).toBe(String(verified + 5));
    expect(mockSecure.wb_auth_uid).toBe('uid-b');
    expect(getSessionGeneration()).toBe(genBefore + 2);
    expect(await durableDriverId()).toBe('driver-b');
    expect(peekWellConfigCacheForTests().envelope?.driverId).toBe('driver-b');
    expect(peekWellConfigCacheForTests().envelope?.eligibility.wells).toEqual(['driver-b-well']);
    expect(peekWellConfigCacheForTests().envelope?.eligibility.routes).toEqual(['route-driver-b']);
  });

  it('generation change after live reread and before destructive logout performs no logout', async () => {
    mockCallable.mockResolvedValue({
      driverId: 'driver-a',
      companyId: 'liquid-gold',
      logoutAt: newer,
    });
    const permit = await checkCanonicalSsoLogout();
    expect(permit).toBeTruthy();
    bumpSessionGeneration();
    const loggedOut = await performPermittedLogout(permit!);
    expect(loggedOut).toBe(false);
    expect(mockSecure.driverId).toBe('driver-a');
    expect(mockSecure.authMethod).toBe('sso');
    expect(mockUser?.uid).toBe('uid-a');
    expect(await durableDriverId()).toBe('driver-a');
    expect(peekWellConfigCacheForTests().envelope?.driverId).toBe('driver-a');
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
  });

  it('same-session A with matching logoutAt still logs out normally', async () => {
    mockCallable.mockResolvedValue({
      driverId: 'driver-a',
      companyId: 'liquid-gold',
      logoutAt: newer,
    });
    const permit = await checkCanonicalSsoLogout();
    const loggedOut = await performPermittedLogout(permit!);
    expect(loggedOut).toBe(true);
    expect(mockSecure.driverId).toBeUndefined();
    expect(mockSecure.authMethod).toBeUndefined();
    expect(mockSecure.driverVerifiedAt).toBeUndefined();
    expect(mockUser).toBeNull();
    expect(await durableDriverId()).toBeUndefined();
    expect(peekWellConfigCacheForTests().envelope).toBeNull();
  });

  it('manual logout still works and clears its own exact current session', async () => {
    await clearDriverSession();
    expect(mockSecure.driverId).toBeUndefined();
    expect(mockSecure.companyId).toBeUndefined();
    expect(mockSecure.authMethod).toBeUndefined();
    expect(mockSecure.driverVerifiedAt).toBeUndefined();
    expect(mockSecure.wb_auth_uid).toBeUndefined();
    expect(mockUser).toBeNull();
    expect(await durableDriverId()).toBeUndefined();
    expect(peekWellConfigCacheForTests()).toEqual({ config: null, envelope: null });
  });

  it('stale A cleanup pauses before removal; B writes; B envelope remains', async () => {
    let releasePause: () => void = () => undefined;
    let paused = false;
    setEnvelopeRemovePauseForTests(() => new Promise((resolve) => {
      paused = true;
      releasePause = () => resolve();
    }));

    const envA = peekWellConfigCacheForTests().envelope;
    expect(envA?.driverId).toBe('driver-a');
    const pendingCleanup = removeEnvelopeIfExact(envA!);

    for (let i = 0; i < 80 && !paused; i += 1) await Promise.resolve();
    expect(paused).toBe(true);
    expect(await durableDriverId()).toBe('driver-a');

    const pendingB = persistBootstrapEnvelopeForTests(snap('driver-b'));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(await durableDriverId()).toBe('driver-a');

    releasePause();
    await pendingCleanup;
    await pendingB;
    expect(await durableDriverId()).toBe('driver-b');
    expect(peekWellConfigCacheForTests().envelope?.driverId).toBe('driver-b');
  });
});
