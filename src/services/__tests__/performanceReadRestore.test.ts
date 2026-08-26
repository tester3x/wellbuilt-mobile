// Behavioral proof (2026-08-25): the tank-performance read is restored to the
// authenticated RTDB path performance/{wellKey}. Data still written there by the
// CF is parsed into rows (populated state); an empty/absent node yields an empty
// result (empty state); a failed read is swallowed to empty (no crash) — never
// the undeployed getDriverWellPerformance callable.
const mockStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
    removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
  },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })), addEventListener: jest.fn(() => () => undefined) },
}));
jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn(async () => 'hash'), CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, CryptoEncoding: { HEX: 'hex' } }));
jest.mock('expo-device', () => ({ osName: 'Android', modelName: 'Test', deviceName: 'Test' }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: {} } }));
jest.mock('../firebaseAuthSession', () => ({
  getValidIdToken: jest.fn(async () => 'tok_test'),
  authorizedCallable: jest.fn(async () => { throw new Error('Callable getDriverWellPerformance failed (404)'); }),
}));

import { getRawWellData } from '../firebase';

const PERF = {
  wellName: 'Gabriel 1',
  updated: '2026-08-24T12:00:00.000Z',
  rows: {
    r1: { d: '2026-08-20', a: 90, p: 88 },
    r2: { d: '2026-08-22', a: 60, p: 64 },
    bad: { d: '2026-08-23', a: 0, p: 10 }, // a<=0 rejected
  },
};

function mockFetchOnce(body: unknown, ok = true) {
  (global as any).fetch = jest.fn(async (url: string) => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    _url: url,
  }));
}

describe('restored tank-performance RTDB read', () => {
  it('reads performance/{wellKey} directly and parses valid rows (populated)', async () => {
    mockFetchOnce(PERF);
    const raw = await getRawWellData('Gabriel 1');
    // The authenticated RTDB path was requested (space → underscore in the key).
    const call = (global as any).fetch.mock.calls[0][0] as string;
    expect(call).toMatch(/performance\/Gabriel_1\.json\?auth=tok_test/);
    // The undeployed callable was NOT used.
    const { authorizedCallable } = jest.requireMock('../firebaseAuthSession');
    expect(authorizedCallable).not.toHaveBeenCalled();
    // Valid rows parsed; the a<=0 row rejected.
    expect(raw.totalPulls).toBe(2);
    expect(raw.rows.map((r) => r.d)).toEqual(['2026-08-20', '2026-08-22']);
    expect(raw.wellName).toBe('Gabriel 1');
    expect(raw.updated).toBe('2026-08-24T12:00:00.000Z');
  });

  it('empty/absent performance node → empty result (empty state, no crash)', async () => {
    mockFetchOnce(null);
    const raw = await getRawWellData('Gabriel 1');
    expect(raw.totalPulls).toBe(0);
    expect(raw.rows).toEqual([]);
  });

  it('a failed read is swallowed to an empty result (never throws to the screen)', async () => {
    mockFetchOnce({ error: 'Permission denied' }, false);
    const raw = await getRawWellData('Gabriel 1');
    expect(raw.totalPulls).toBe(0);
    expect(raw.rows).toEqual([]);
  });
});
