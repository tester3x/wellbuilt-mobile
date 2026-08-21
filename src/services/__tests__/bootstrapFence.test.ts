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

const mockCallable = jest.fn();
jest.mock('../firebaseAuthSession', () => ({
  authorizedCallable: (...args: unknown[]) => mockCallable(...args),
  getFirebaseAuth: () => ({ currentUser: { uid: 'u' } }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
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
  persistBootstrapEnvelope,
  resetWellConfigCacheForTests,
  seedWellConfigCacheForTests,
  setHasAuthSessionForTests,
  WBM_ENVELOPE_KEY,
} from '../wellConfig';
import { snapshotToEnvelope, type WbmBootstrapSnapshot } from '../wbmBootstrapCache';

const asyncStore = (AsyncStorage as unknown as { __store: Record<string, string> }).__store;

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

function resetAsyncMocks() {
  for (const k of Object.keys(asyncStore)) delete asyncStore[k];
  (AsyncStorage.getItem as jest.Mock).mockReset();
  (AsyncStorage.setItem as jest.Mock).mockReset();
  (AsyncStorage.removeItem as jest.Mock).mockReset();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (k: string) => (
    k in asyncStore ? asyncStore[k] : null
  ));
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (k: string, v: string) => {
    asyncStore[k] = v;
  });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (k: string) => {
    delete asyncStore[k];
  });
}

async function waitForMockCalls(fn: jest.Mock, n: number, turns = 80) {
  for (let i = 0; i < turns; i += 1) {
    if (fn.mock.calls.length >= n) return;
    await Promise.resolve();
  }
  throw new Error(`timed out waiting for mock calls (have ${fn.mock.calls.length}, want ${n})`);
}

describe('in-flight bootstrap generation fence', () => {
  beforeEach(() => {
    resetWellConfigCacheForTests();
    resetAsyncMocks();
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

  it('A bootstrap passes the initial check, then its AsyncStorage write is deferred; switch to B; A is neither returned, cached, nor persisted', async () => {
    mockSecure.driverId = 'driver-a';
    mockSecure.companyId = 'liquid-gold';
    mockCallable.mockResolvedValue(snap('driver-a'));

    let releaseSet: () => void = () => undefined;
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce((k: string, v: string) => new Promise((resolve) => {
      releaseSet = () => {
        asyncStore[k] = v;
        resolve(undefined);
      };
    }));

    const pendingA = loadWellConfig();
    await waitForMockCalls(AsyncStorage.setItem as jest.Mock, 1);

    mockSecure.driverId = 'driver-b';
    bumpSessionGeneration();

    releaseSet();
    await expect(pendingA).rejects.toThrow(/stale_bootstrap/);
    expect(peekWellConfigCacheForTests().envelope?.driverId).not.toBe('driver-a');
    expect(peekWellConfigCacheForTests().config?.['driver-a-well']).toBeUndefined();
    const raw = asyncStore[WBM_ENVELOPE_KEY];
    if (raw) {
      const env = JSON.parse(raw) as { driverId?: string };
      expect(env.driverId).not.toBe('driver-a');
    }
  });

  it('stale_bootstrap encounters an existing durable A envelope during transition to B; A is not used as fallback', async () => {
    mockSecure.driverId = 'driver-a';
    mockSecure.companyId = 'liquid-gold';
    const envA = snapshotToEnvelope(snap('driver-a'));
    asyncStore[WBM_ENVELOPE_KEY] = JSON.stringify(envA);

    let releaseA: (v: WbmBootstrapSnapshot) => void = () => undefined;
    mockCallable.mockImplementationOnce(() => new Promise((resolve) => {
      releaseA = resolve as (v: WbmBootstrapSnapshot) => void;
    }));

    const pendingA = loadWellConfig();
    await waitForMockCalls(mockCallable, 1);
    mockSecure.driverId = 'driver-b';
    bumpSessionGeneration();
    // Durable A remains. Stale A must not be returned as last-known fallback.
    releaseA(snap('driver-a'));
    await expect(pendingA).rejects.toThrow(/stale_bootstrap/);
    expect(peekWellConfigCacheForTests().envelope?.driverId).not.toBe('driver-a');
    expect(JSON.parse(asyncStore[WBM_ENVELOPE_KEY]).driverId).toBe('driver-a');
  });

  it('B writes a new envelope while stale A cleanup is pending; A cleanup does not remove B', async () => {
    mockSecure.driverId = 'driver-a';
    mockSecure.companyId = 'liquid-gold';
    mockCallable.mockResolvedValue(snap('driver-a'));

    let releaseSet: () => void = () => undefined;
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce((k: string, v: string) => new Promise((resolve) => {
      releaseSet = () => {
        asyncStore[k] = v;
        resolve(undefined);
      };
    }));

    const pendingA = loadWellConfig();
    await waitForMockCalls(AsyncStorage.setItem as jest.Mock, 1);

    mockSecure.driverId = 'driver-b';
    bumpSessionGeneration();

    const getItem = AsyncStorage.getItem as jest.Mock;
    const getCountBeforeCleanup = getItem.mock.calls.length;
    let releaseGet: () => void = () => undefined;
    getItem.mockImplementationOnce((k: string) => new Promise((resolve) => {
      releaseGet = () => resolve(k in asyncStore ? asyncStore[k] : null);
    }));

    releaseSet();
    await waitForMockCalls(getItem, getCountBeforeCleanup + 1);

    mockSecure.driverId = 'driver-b';
    await persistBootstrapEnvelope(snap('driver-b'));
    expect(JSON.parse(asyncStore[WBM_ENVELOPE_KEY]).driverId).toBe('driver-b');

    releaseGet();
    await expect(pendingA).rejects.toThrow(/stale_bootstrap/);
    expect(JSON.parse(asyncStore[WBM_ENVELOPE_KEY]).driverId).toBe('driver-b');
    expect(peekWellConfigCacheForTests().envelope?.driverId).toBe('driver-b');
  });
});
