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
  getFirebaseAuth: () => ({ currentUser: { uid: 'u' } }),
}));

import {
  bootstrapResponseAdmissible,
  bumpSessionGeneration,
  captureBootstrapTicket,
  getSessionGeneration,
  resetSessionGenerationForTests,
} from '../wbmSessionFence';
import {
  clearWellConfigCache,
  getWellConfigSync,
  installBootstrapSnapshot,
  loadWellConfig,
  peekWellConfigCacheForTests,
  resetWellConfigCacheForTests,
  seedWellConfigCacheForTests,
  setHasAuthSessionForTests,
} from '../wellConfig';
import { snapshotToEnvelope, type WbmBootstrapSnapshot } from '../wbmBootstrapCache';

function snap(driverId: string, extra: Partial<WbmBootstrapSnapshot> = {}): WbmBootstrapSnapshot {
  return {
    ok: true,
    driverId,
    companyId: extra.companyId ?? 'liquid-gold',
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
    ...extra,
  };
}

describe('in-flight bootstrap generation fence', () => {
  beforeEach(() => {
    resetWellConfigCacheForTests();
    setHasAuthSessionForTests(() => true);
    for (const k of Object.keys(mockSecure)) delete mockSecure[k];
    mockCallable.mockReset();
  });

  it('deferred A response after B switch is discarded', async () => {
    mockSecure.driverId = 'driver-a';
    mockSecure.companyId = 'liquid-gold';
    let releaseA: (v: WbmBootstrapSnapshot) => void = () => undefined;
    mockCallable.mockImplementationOnce(() => new Promise((resolve) => {
      releaseA = resolve as (v: WbmBootstrapSnapshot) => void;
    }));

    const pendingA = loadWellConfig();
    mockSecure.driverId = 'driver-b';
    await clearWellConfigCache();
    expect(getWellConfigSync('driver-a-well').route).toBeUndefined();

    mockCallable.mockRejectedValue(new Error('scope_missing'));
    await expect(loadWellConfig()).rejects.toThrow();

    releaseA(snap('driver-a'));
    await expect(pendingA).rejects.toThrow(/stale_bootstrap/);
    const peek = peekWellConfigCacheForTests();
    expect(peek.envelope?.driverId).not.toBe('driver-a');
    expect(peek.config?.['driver-a-well']).toBeUndefined();
  });

  it('logout while bootstrap is in flight discards the response', async () => {
    mockSecure.driverId = 'driver-a';
    mockSecure.companyId = 'liquid-gold';
    let release: (v: WbmBootstrapSnapshot) => void = () => undefined;
    mockCallable.mockImplementationOnce(() => new Promise((resolve) => {
      release = resolve as (v: WbmBootstrapSnapshot) => void;
    }));
    const pending = loadWellConfig();
    await clearWellConfigCache();
    setHasAuthSessionForTests(() => false);
    release(snap('driver-a'));
    await expect(pending).rejects.toThrow(/stale_bootstrap/);
    expect(peekWellConfigCacheForTests().envelope).toBeNull();
  });

  it('same identity with a newer generation is rejected', async () => {
    mockSecure.driverId = 'driver-a';
    mockSecure.companyId = 'liquid-gold';
    const ticket = captureBootstrapTicket({ driverId: 'driver-a', companyId: 'liquid-gold' });
    bumpSessionGeneration();
    const installed = await installBootstrapSnapshot(snap('driver-a'), ticket);
    expect(installed).toBeNull();
  });

  it('same driverId but changed company is rejected', () => {
    resetSessionGenerationForTests();
    const ticket = captureBootstrapTicket({ driverId: 'driver-a', companyId: 'liquid-gold' });
    expect(bootstrapResponseAdmissible({
      ticket,
      snapshot: { driverId: 'driver-a', companyId: 'other-co' },
      current: { driverId: 'driver-a', companyId: 'other-co' },
      hasAuthSession: true,
    })).toBe(false);
  });

  it('stale response cannot recreate the durable envelope', async () => {
    mockSecure.driverId = 'driver-b';
    mockSecure.companyId = 'liquid-gold';
    seedWellConfigCacheForTests(snapshotToEnvelope(snap('driver-b')));
    const oldGen = getSessionGeneration();
    const ticket = { generation: oldGen, driverId: 'driver-a', companyId: 'liquid-gold' };
    const installed = await installBootstrapSnapshot(snap('driver-a'), ticket);
    expect(installed).toBeNull();
    expect(peekWellConfigCacheForTests().envelope?.driverId).toBe('driver-b');
  });
});
