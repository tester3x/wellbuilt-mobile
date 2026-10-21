/** Integration regression: use the real Firebase session writer, real bootstrap
 * envelope and real history/cache modules. Only the SDK/native/network edges
 * are faked; no test is allowed to invent the persisted auth key. */
const mockSecure: Record<string, string> = {};
const mockStore: Record<string, string> = {};
const mockSignedUser = { uid: 'uid-a', refreshToken: 'refresh-a', getIdToken: jest.fn(async () => 'sdk-token') };
const mockAuth: { currentUser: typeof mockSignedUser | null } = { currentUser: null };
const mockApp = { options: { projectId: 'wellbuilt-sync' } };
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecure[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockSecure[key] = value; }),
  deleteItemAsync: jest.fn(async (key: string) => { delete mockSecure[key]; }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
  removeItem: jest.fn(async (key: string) => { delete mockStore[key]; }),
} }));
jest.mock('firebase/app', () => ({ getApps: () => [mockApp], initializeApp: () => mockApp }));
jest.mock('firebase/auth', () => ({
  initializeAuth: () => mockAuth, getAuth: () => mockAuth, getReactNativePersistence: () => ({}),
  signInWithCustomToken: jest.fn(async () => { mockAuth.currentUser = mockSignedUser; return { user: mockSignedUser }; }),
  signOut: jest.fn(async () => { mockAuth.currentUser = null; }),
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => { queueMicrotask(() => callback(mockAuth.currentUser)); return () => {}; },
}));
jest.mock('firebase/database', () => ({ getDatabase: () => ({}) }));
jest.mock('../platformDelivery', () => ({ platformDelivery: {} }));
jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn() }));
jest.mock('expo-device', () => ({ modelName: 'test' }));
jest.mock('../deliveryStatus', () => ({ notifyAuthenticated: jest.fn() }));
jest.mock('../deviceAccount', () => ({ publishMobileDeviceAccount: jest.fn(async () => {}) }));

const snapshot = {
  ok: true, driverId: 'driver-a', companyId: 'company-a', active: true,
  assignedRoutes: ['Route A'], assignedWells: [], assignmentRevision: 1, assignmentDigest: 'digest-a',
  eligibilityStatus: 'eligible', eligibilityReason: 'scope_ok',
  wells: { 'Well A': { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Route A' } }, wellCount: 1,
};

describe('real Mobile session persistence to cached presentation and exact-well history', () => {
  const previousFetch = global.fetch;
  let auth: typeof import('../firebaseAuthSession'), config: typeof import('../wellConfig');
  let presentation: typeof import('../wellPresentation'), history: typeof import('../wellHistoryPresentation');
  let fetcher: jest.Mock;
  let completeLogin: typeof import('../driverAuth').completeAuthenticatedSession;
  beforeEach(async () => {
    jest.resetModules();
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    for (const key of Object.keys(mockSecure)) delete mockSecure[key];
    mockAuth.currentUser = null; mockSignedUser.getIdToken.mockClear();
    auth = require('../firebaseAuthSession'); config = require('../wellConfig');
    presentation = require('../wellPresentation'); history = require('../wellHistoryPresentation');
    let stalledBootstrap = false;
    fetcher = jest.fn(async (url: string) => {
      if (url.endsWith('/bootstrapWbmSession')) {
        return stalledBootstrap ? new Promise(() => {}) : { ok: true, status: 200, json: async () => ({ result: snapshot }) };
      }
      return { ok: true, status: 200, json: async () => ({ result: { ok: true, wellName: 'Well A', packets: {
        'source-child-key': { wellName: 'Well A', companyId: 'company-a', dateTimeUTC: '2026-10-21T08:00:00Z', dateTime: '10/21/2026 3:00 AM', tankLevelFeet: 7, bblsTaken: 185 },
      } } }) };
    });
    global.fetch = fetcher;
    completeLogin = require('../driverAuth').completeAuthenticatedSession;
    await completeLogin({ customToken: 'custom-token', driverId: 'driver-a', displayName: 'Driver A', companyId: 'company-a', authMethod: 'sso', assignedRoutes: ['Route A'] });
    // All owner keys and the envelope above came from the production login composition.
    stalledBootstrap = true;
    fetcher.mockClear();
    jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { global.fetch = previousFetch; jest.restoreAllMocks(); });
  it('the actual session writer unlocks a scoped view and reaches the exact-well callable despite a stalled background bootstrap', async () => {
    expect(mockSecure.wb_auth_uid).toBe('uid-a'); expect(mockSecure.authUid).toBeUndefined();
    const view = await presentation.loadWellPresentation(); expect(view!.envelope.driverId).toBe('driver-a');
    const first = await history.loadWellHistoryPresentation('Well A');
    expect(first!.source).toBe('server'); expect(first!.response!.rows[0].packetId).toBe('source-child-key');
    const cached = await history.loadWellHistoryPresentation('Well A');
    expect(cached!.source).toBe('saved'); expect(cached!.response!.rows).toEqual(first!.response!.rows);
    const calls = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/getDriverWellHistory'));
    expect(calls).toHaveLength(1); expect(JSON.parse(calls[0][1].body)).toEqual({ data: { wellName: 'Well A' } });
  });
  it('an invented authUid key cannot substitute for the real persisted session owner', async () => {
    delete mockSecure.wb_auth_uid; mockSecure.authUid = 'uid-a';
    expect(await presentation.loadWellPresentation()).toBeNull(); expect(await history.loadWellHistoryPresentation('Well A')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('SDK account change and actual logout stop old-owner presentation without clearing its saved records', async () => {
    await history.loadWellHistoryPresentation('Well A');
    mockAuth.currentUser = { ...mockSignedUser, uid: 'uid-b' };
    expect(await history.loadWellHistoryPresentation('Well A')).toBeNull();
    await auth.clearAuthSession(); expect(mockSecure.wb_auth_uid).toBeUndefined();
    expect(await presentation.loadWellPresentation()).toBeNull();
    expect(Object.keys(mockStore).some(key => key.startsWith('@wbm/well-history-view/'))).toBe(true);
  });
});
