const mockOnline = { connected: true, reachable: true as boolean | null };

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({
      isConnected: mockOnline.connected,
      isInternetReachable: mockOnline.reachable,
      type: 'cellular',
    })),
    addEventListener: jest.fn(() => () => undefined),
  },
}));

jest.mock('../debugLog', () => ({ debugLog: jest.fn() }));
jest.mock('../systemLog', () => ({ systemLog: jest.fn() }));
const mockGetValidIdToken = jest.fn(async (): Promise<string> => {
  throw Object.assign(new Error('missing'), { name: 'AuthSessionError' });
});
jest.mock('../firebaseAuthSession', () => ({
  getValidIdToken: () => mockGetValidIdToken(),
}));

import { checkFirebaseConnectivity, getFirebaseStatus, refreshFirebaseStatus } from '../firebaseStatus';

describe('firebase status classification', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    mockOnline.connected = true;
    mockOnline.reachable = true;
    mockGetValidIdToken.mockReset();
    mockGetValidIdToken.mockImplementation(async () => {
      throw Object.assign(new Error('missing'), { name: 'AuthSessionError' });
    });
  });

  test('disconnected NetInfo is no_network, not auth', async () => {
    mockOnline.connected = false;
    const ok = await refreshFirebaseStatus();
    expect(ok).toBe(false);
    expect(getFirebaseStatus().kind).toBe('no_network');
    expect(getFirebaseStatus().code).toBe('netinfo_disconnected');
  });

  test('host 401 with live network is auth_session and not offline', async () => {
    global.fetch = jest.fn(async () => ({ status: 401 })) as any;
    const ok = await refreshFirebaseStatus();
    expect(ok).toBe(true);
    expect(getFirebaseStatus().isOnline).toBe(true);
    expect(getFirebaseStatus().kind).toBe('auth_session');
  });

  test('host 403 is permission, not connectivity loss', async () => {
    mockGetValidIdToken.mockResolvedValueOnce('id-token-for-test');
    global.fetch = jest.fn(async () => ({ status: 403 })) as any;
    const ok = await refreshFirebaseStatus();
    expect(ok).toBe(true);
    expect(getFirebaseStatus().kind).toBe('permission');
  });

  test('abort is timeout', async () => {
    global.fetch = jest.fn(async () => {
      const e = new Error('aborted');
      (e as any).name = 'AbortError';
      throw e;
    }) as any;
    const ok = await refreshFirebaseStatus();
    expect(ok).toBe(false);
    expect(getFirebaseStatus().kind).toBe('timeout');
  });

  test('throwing fetch with no network wording is unreachable/timeout, not auth', async () => {
    global.fetch = jest.fn(async () => { throw new Error('Cannot reach WellBuilt server'); }) as any;
    const ok = await refreshFirebaseStatus();
    expect(ok).toBe(false);
    expect(getFirebaseStatus().kind).toBe('unreachable');
  });
});
