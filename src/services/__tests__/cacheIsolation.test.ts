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
  clearWellConfigCache,
  envelopeMatchesSession,
  loadWellConfig,
  parseBootstrapEnvelope,
  peekWellConfigCacheForTests,
  persistBootstrapEnvelope,
  resetWellConfigCacheForTests,
  seedWellConfigCacheForTests,
} from '../wellConfig';
import { snapshotToEnvelope, type WbmBootstrapSnapshot } from '../wbmBootstrapCache';

function snap(partial: Partial<WbmBootstrapSnapshot> & Pick<WbmBootstrapSnapshot, 'driverId' | 'assignmentRevision' | 'assignmentDigest'>): WbmBootstrapSnapshot {
  return {
    ok: true,
    companyId: 'liquid-gold',
    active: true,
    assignedRoutes: ['Gabriels'],
    assignedWells: [],
    eligibilityStatus: 'eligible',
    eligibilityReason: 'scope_ok',
    wells: { 'Gabriel 1': { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Gabriels' } },
    wellCount: 1,
    ...partial,
  };
}

describe('WB-M versioned bootstrap cache', () => {
  beforeEach(() => {
    resetWellConfigCacheForTests();
    for (const k of Object.keys(mockSecure)) delete mockSecure[k];
    mockCallable.mockReset();
  });

  it('rejects malformed or unversioned old cache', () => {
    expect(parseBootstrapEnvelope({ status: 'eligible', routes: ['Gabriels'] })).toBeNull();
    expect(parseBootstrapEnvelope({ schemaVersion: 0, driverId: 'A', companyId: 'c' })).toBeNull();
    expect(parseBootstrapEnvelope(null)).toBeNull();
  });

  it('Driver B cannot inherit Driver A after identity switch without logout', async () => {
    const a = snap({ driverId: 'driver-a', assignmentRevision: 1, assignmentDigest: 'dig-a' });
    seedWellConfigCacheForTests(snapshotToEnvelope(a));
    mockSecure.driverId = 'driver-b';
    mockSecure.companyId = 'liquid-gold';
    mockCallable.mockRejectedValue(new Error('failed-precondition: scope_missing'));
    await expect(loadWellConfig()).rejects.toThrow(/scope_missing|well_config_unavailable/);
    expect(peekWellConfigCacheForTests().config).toBeNull();
  });

  it('same driver, new assignment revision rejects the old catalog', async () => {
    mockSecure.driverId = 'driver-a';
    mockSecure.companyId = 'liquid-gold';
    await persistBootstrapEnvelope(snap({
      driverId: 'driver-a',
      assignmentRevision: 1,
      assignmentDigest: 'dig-1',
      wells: { 'Old Well': { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Gabriels' } },
    }));
    mockCallable.mockResolvedValue(snap({
      driverId: 'driver-a',
      assignmentRevision: 2,
      assignmentDigest: 'dig-2',
      wells: { 'New Well': { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Watford' } },
    }));
    const wells = await loadWellConfig();
    expect(Object.keys(wells || {})).toEqual(['New Well']);
    expect(peekWellConfigCacheForTests().envelope?.assignmentRevision).toBe(2);
  });

  it('same identity + revision falls back when live fetch fails', async () => {
    mockSecure.driverId = 'driver-a';
    mockSecure.companyId = 'liquid-gold';
    const env = snapshotToEnvelope(snap({
      driverId: 'driver-a',
      companyId: 'liquid-gold',
      assignmentRevision: 1,
      assignmentDigest: 'dig-1',
    }));
    seedWellConfigCacheForTests(env);
    mockCallable.mockRejectedValue(new Error('unavailable'));
    const wells = await loadWellConfig(false);
    expect(Object.keys(wells || {})).toEqual(['Gabriel 1']);
  });

  it('logout clears every WB-M authorization/cache key', async () => {
    mockSecure.driverId = 'driver-a';
    await persistBootstrapEnvelope(snap({ driverId: 'driver-a', assignmentRevision: 1, assignmentDigest: 'd' }));
    await clearWellConfigCache();
    expect(peekWellConfigCacheForTests()).toEqual({ config: null, envelope: null });
    expect(envelopeMatchesSession(null, 'driver-a', 'liquid-gold')).toBe(false);
  });
});
