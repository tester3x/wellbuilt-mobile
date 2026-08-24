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

let mockUser: { uid: string } | null = { uid: 'uid-a' };
const mockCallable = jest.fn();
const mocks = {
  clearAuthSession: jest.fn(async () => {
    mockUser = null;
    delete mockSecure.wb_auth_uid;
  }),
  clearAuthSessionVerified: jest.fn(async () => {
    mockUser = null;
    delete mockSecure.wb_auth_uid;
  }),
  persistCustomTokenSession: jest.fn(async (token: string) => {
    const uid = String(token).includes('b') ? 'uid-b' : 'uid-a';
    mockUser = { uid };
    mockSecure.wb_auth_uid = uid;
    return { idToken: `id-${uid}`, refreshToken: 'rt' };
  }),
};
jest.mock('../firebaseAuthSession', () => ({
  clearAuthSession: () => mocks.clearAuthSession(),
  clearAuthSessionVerified: () => mocks.clearAuthSessionVerified(),
  persistCustomTokenSession: (token: string) => mocks.persistCustomTokenSession(token),
  authorizedCallable: (...args: unknown[]) => mockCallable(...args),
  getFirebaseAuth: () => ({ currentUser: mockUser }),
}));

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  captureCurrentSessionPermit,
  clearDriverSession,
  completeAuthenticatedSession,
  performPermittedLogout,
  setAfterSignInPauseForTests,
  setLogoutAfterRereadPauseForTests,
  setLogoutDuringNthLiveReadPauseForTests,
  setSaveSessionWritePauseForTests,
} from '../driverAuth';
import { checkCanonicalSsoLogout } from '../ssoLogout';
import {
  bumpSessionGeneration,
  getSessionGeneration,
  persistBootstrapEnvelopeForTests,
  peekWellConfigCacheForTests,
  removeEnvelopeIfExact,
  resetWellConfigCacheForTests,
  seedWellConfigCacheForTests,
  setEnvelopeRemovePauseForTests,
  setHasAuthSessionForTests,
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

function profile(driverId: string) {
  return {
    driverId,
    companyId: 'liquid-gold',
    displayName: driverId,
    legalName: driverId,
    companyName: 'Liquid Gold',
    isAdmin: false,
    isViewer: false,
    roles: ['driver'],
    tier: 'field',
    assignedRoutes: [`route-${driverId}`],
    assignedCustomers: null,
    dashboardUid: null,
    dashboardRole: null,
    defaultPackageId: null,
    active: true as const,
  };
}

function installA() {
  mockUser = { uid: 'uid-a' };
  mockSecure.driverId = 'driver-a';
  mockSecure.companyId = 'liquid-gold';
  mockSecure.authMethod = 'sso';
  mockSecure.driverVerifiedAt = String(verified);
  mockSecure.wb_auth_uid = 'uid-a';
  mockSecure.driverName = 'driver-a';
  mockSecure.assignedRoutes = JSON.stringify(['route-driver-a']);
  seedWellConfigCacheForTests(snapshotToEnvelope(snap('driver-a')));
}

async function durableDriverId(): Promise<string | undefined> {
  const raw = asyncStore[WBM_ENVELOPE_KEY];
  if (!raw) return undefined;
  return (JSON.parse(raw) as { driverId?: string }).driverId;
}

function loginB() {
  return completeAuthenticatedSession({
    customToken: 'tok-b',
    driverId: 'driver-b',
    displayName: 'driver-b',
    companyId: 'liquid-gold',
    companyName: 'Liquid Gold',
    authMethod: 'sso',
    roles: ['driver'],
    assignedRoutes: ['route-driver-b'],
  });
}

describe('end-to-end session ownership', () => {
  beforeEach(async () => {
    resetWellConfigCacheForTests();
    setHasAuthSessionForTests(() => !!mockUser);
    setSaveSessionWritePauseForTests(null);
    setLogoutAfterRereadPauseForTests(null);
    setLogoutDuringNthLiveReadPauseForTests(0, null);
    setAfterSignInPauseForTests(null);
    setEnvelopeRemovePauseForTests(null);
    for (const k of Object.keys(asyncStore)) delete asyncStore[k];
    for (const k of Object.keys(mockSecure)) delete mockSecure[k];
    mocks.clearAuthSession.mockReset();
    mocks.clearAuthSession.mockImplementation(async () => {
      mockUser = null;
      delete mockSecure.wb_auth_uid;
    });
    mocks.clearAuthSessionVerified.mockReset();
    mocks.clearAuthSessionVerified.mockImplementation(async () => {
      mockUser = null;
      delete mockSecure.wb_auth_uid;
    });
    mocks.persistCustomTokenSession.mockReset();
    mocks.persistCustomTokenSession.mockImplementation(async (token: string) => {
      const uid = String(token).includes('b') ? 'uid-b' : 'uid-a';
      mockUser = { uid };
      mockSecure.wb_auth_uid = uid;
      return { idToken: `id-${uid}`, refreshToken: 'rt' };
    });
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
      mockSecure[k] = v;
    });
    mockCallable.mockReset();
    mockCallable.mockImplementation(async (name: string) => {
      if (name === 'bootstrapWbmSession') {
        const id = mockSecure.driverId || 'driver-b';
        return snap(id);
      }
      throw new Error(`unexpected callable ${name}`);
    });
    installA();
    await persistBootstrapEnvelopeForTests(snap('driver-a'));
  });

  it('real B login pauses after Firebase sign-in; concurrent logout waits; final state is entirely B', async () => {
    let releaseAfterSignIn: () => void = () => undefined;
    setAfterSignInPauseForTests(() => new Promise((resolve) => {
      releaseAfterSignIn = () => resolve();
    }));

    const permitA = await captureCurrentSessionPermit();
    expect(permitA?.driverId).toBe('driver-a');

    const pendingB = loginB();
    for (let i = 0; i < 80 && mocks.persistCustomTokenSession.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(mocks.persistCustomTokenSession).toHaveBeenCalled();
    expect(mockUser?.uid).toBe('uid-b');

    const pendingLogout = performPermittedLogout(permitA!);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();

    releaseAfterSignIn();
    await pendingB;
    const loggedOut = await pendingLogout;

    expect(loggedOut).toBe(false);
    expect(mockUser?.uid).toBe('uid-b');
    expect(mockSecure.driverId).toBe('driver-b');
    expect(mockSecure.companyId).toBe('liquid-gold');
    expect(mockSecure.authMethod).toBe('sso');
    expect(mockSecure.wb_auth_uid).toBe('uid-b');
    expect(await durableDriverId()).toBe('driver-b');
    expect(peekWellConfigCacheForTests().envelope?.driverId).toBe('driver-b');
    expect(peekWellConfigCacheForTests().envelope?.eligibility.routes).toEqual(['route-driver-b']);
  });

  it('real B login pauses during each saveDriverSession write; queued logout cannot mix or delete B', async () => {
    const waiters: Array<() => void> = [];
    const keys: string[] = [];
    setSaveSessionWritePauseForTests(async (key) => {
      keys.push(key);
      await new Promise<void>((resolve) => { waiters.push(resolve); });
    });

    const permitA = await captureCurrentSessionPermit();
    const pendingB = loginB();
    for (let i = 0; i < 80 && waiters.length === 0; i += 1) await Promise.resolve();
    expect(keys[0]).toBe('driverId');

    const pendingLogout = performPermittedLogout(permitA!);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();

    for (let n = 0; n < 40; n += 1) {
      const before = waiters.length;
      waiters.splice(0).forEach((r) => r());
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      expect(mocks.clearAuthSession).not.toHaveBeenCalled();
      if (mockSecure.driverId === 'driver-b') {
        expect(mockUser?.uid).toBe('uid-b');
        expect(mockSecure.wb_auth_uid).toBe('uid-b');
      }
      if (before === waiters.length && waiters.length === 0) break;
    }
    await pendingB;
    const loggedOut = await pendingLogout;
    expect(loggedOut).toBe(false);
    expect(mockSecure.driverId).toBe('driver-b');
    expect(mockSecure.authMethod).toBe('sso');
    expect(mockUser?.uid).toBe('uid-b');
    expect(await durableDriverId()).toBe('driver-b');
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
  });

  it('saveDriverSession failure after Firebase sign-in rolls back Auth, SecureStore, memory, and envelope', async () => {
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (k: string, v: string) => {
      if (k === 'driverName') throw new Error('secure_store_write_failed');
      mockSecure[k] = v;
    });

    await expect(loginB()).rejects.toThrow(/secure_store_write_failed/);
    expect(mockUser).toBeNull();
    expect(mockSecure.wb_auth_uid).toBeUndefined();
    expect(mockSecure.driverId).toBeUndefined();
    expect(mockSecure.driverName).toBeUndefined();
    expect(mockSecure.authMethod).toBeUndefined();
    expect(mockSecure.driverVerifiedAt).toBeUndefined();
    expect(peekWellConfigCacheForTests()).toEqual({ config: null, envelope: null });
    expect(await durableDriverId()).toBeUndefined();
  });

  it('generation change while performPermittedLogout awaits live fields rejects with zero destruction', async () => {
    const permit = await captureCurrentSessionPermit();
    let releasePause: () => void = () => undefined;
    setLogoutAfterRereadPauseForTests(() => new Promise((resolve) => {
      releasePause = () => resolve();
    }));

    const pending = performPermittedLogout(permit!);
    for (let i = 0; i < 80; i += 1) await Promise.resolve();
    bumpSessionGeneration();
    releasePause();
    await expect(pending).resolves.toBe(false);
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
    expect(mockSecure.driverId).toBe('driver-a');
    expect(mockSecure.authMethod).toBe('sso');
    expect(mockUser?.uid).toBe('uid-a');
    expect(await durableDriverId()).toBe('driver-a');
    expect(peekWellConfigCacheForTests().envelope?.driverId).toBe('driver-a');
  });

  it('generation change during the final live-session reread rejects logout with zero destruction', async () => {
    const permit = await captureCurrentSessionPermit();
    const genBefore = getSessionGeneration();
    const memoryBefore = peekWellConfigCacheForTests();
    let paused = false;
    let releasePause: () => void = () => undefined;
    setLogoutDuringNthLiveReadPauseForTests(2, () => new Promise((resolve) => {
      paused = true;
      releasePause = () => resolve();
    }));

    const pending = performPermittedLogout(permit!);
    for (let i = 0; i < 80 && !paused; i += 1) await Promise.resolve();
    expect(paused).toBe(true);
    bumpSessionGeneration();
    expect(mockSecure.driverId).toBe('driver-a');
    expect(mockSecure.authMethod).toBe('sso');
    releasePause();
    await expect(pending).resolves.toBe(false);
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
    expect(mockUser?.uid).toBe('uid-a');
    expect(mockSecure.driverId).toBe('driver-a');
    expect(mockSecure.companyId).toBe('liquid-gold');
    expect(mockSecure.authMethod).toBe('sso');
    expect(mockSecure.driverVerifiedAt).toBe(String(verified));
    expect(mockSecure.wb_auth_uid).toBe('uid-a');
    expect(getSessionGeneration()).toBe(genBefore + 1);
    expect(peekWellConfigCacheForTests()).toEqual(memoryBefore);
    expect(await durableDriverId()).toBe('driver-a');
  });

  it('completed login followed by a valid same-session logout clears exactly that session', async () => {
    await loginB();
    expect(mockSecure.driverId).toBe('driver-b');
    expect(mockUser?.uid).toBe('uid-b');
    mockCallable.mockImplementation(async (name: string) => {
      if (name === 'bootstrapWbmSession') {
        return { ...snap('driver-b'), logoutAt: Date.now() + 60_000 };
      }
      return profile('driver-b');
    });
    const permit = await checkCanonicalSsoLogout();
    expect(permit?.driverId).toBe('driver-b');
    expect(permit?.authUid).toBe('uid-b');
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
    await loginB();
    await clearDriverSession();
    expect(mockSecure.driverId).toBeUndefined();
    expect(mockSecure.companyId).toBeUndefined();
    expect(mockSecure.authMethod).toBeUndefined();
    expect(mockSecure.wb_auth_uid).toBeUndefined();
    expect(mockUser).toBeNull();
    expect(await durableDriverId()).toBeUndefined();
    expect(peekWellConfigCacheForTests()).toEqual({ config: null, envelope: null });
  });

  it('explicit logout releases a retained pre-contract session that cannot form a permit', async () => {
    delete mockSecure.authMethod;
    expect(await captureCurrentSessionPermit()).toBeNull();

    await expect(clearDriverSession()).resolves.toBe(true);

    expect(mocks.clearAuthSessionVerified).toHaveBeenCalledTimes(1);
    expect(mockUser).toBeNull();
    expect(mockSecure.driverId).toBeUndefined();
    expect(mockSecure.driverName).toBeUndefined();
    expect(mockSecure.companyId).toBeUndefined();
    expect(mockSecure.wb_auth_uid).toBeUndefined();
    expect(await durableDriverId()).toBeUndefined();
    expect(peekWellConfigCacheForTests()).toEqual({ config: null, envelope: null });
  });

  it('unbound logout sign-out failure is truthful and retains local identity for retry', async () => {
    delete mockSecure.authMethod;
    mocks.clearAuthSessionVerified.mockRejectedValueOnce(new Error('firebase_signout_failed'));

    await expect(clearDriverSession()).rejects.toThrow('firebase_signout_failed');

    expect(mockSecure.driverId).toBe('driver-a');
    expect(mockSecure.companyId).toBe('liquid-gold');
    expect(mockUser?.uid).toBe('uid-a');
    expect(await durableDriverId()).toBe('driver-a');
  });

  it('A permit is rejected after B authentication begins; B remains intact', async () => {
    const permitA = await captureCurrentSessionPermit();
    await loginB();
    const loggedOut = await performPermittedLogout(permitA!);
    expect(loggedOut).toBe(false);
    expect(mockSecure.driverId).toBe('driver-b');
    expect(mockUser?.uid).toBe('uid-b');
    expect(await durableDriverId()).toBe('driver-b');
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
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
