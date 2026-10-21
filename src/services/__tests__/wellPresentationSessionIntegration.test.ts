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
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'Spinner', AppState: { addEventListener: () => ({ remove() {} }) } }));
jest.mock('../../../modules/wellbuilt-platform/index', () => ({ addListener: () => ({ remove() {} }) }));
jest.mock('../../../modules/wellbuilt-platform/delivery', () => ({ subscribePending: () => () => {} }));
jest.mock('expo-splash-screen', () => ({ hideAsync: async () => {} }));
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
  it('a real account-gate cold route waits for SDK restore, then reaches the actual history request without another tap', async () => {
    const React = require('react') as typeof import('react');
    const Renderer = require('react-test-renderer');
    const Gate = require('../../../modules/wellbuilt-platform/AccountGate');
    const ts = require('typescript') as typeof import('typescript');
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const source = ts.createSourceFile('well-data.tsx', fs.readFileSync(path.resolve(__dirname, '../../../app/well-data.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let loader!: import('typescript').Node, effect!: import('typescript').Node;
    const visit = (node: import('typescript').Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'fetchData') loader = node.initializer!;
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('fetchData(false)')) effect = node;
      ts.forEachChild(node, visit);
    };
    visit(source);
    const compile = (node: import('typescript').Node) => new Function('scope', 'with(scope){' + ts.transpileModule('return ' + node.getText(source) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText + '}');
    const makeLoader = compile(loader), runEffect = compile(effect);
    const setData = jest.fn(), setError = jest.fn();
    let release!: (value: string) => void;
    const restore = new Promise<string>(resolve => { release = resolve; });
    // SDK restoration is a native edge. All persisted owner keys and bootstrap
    // still come from the real completeAuthenticatedSession in beforeEach.
    mockAuth.currentUser = null;
    function Probe() {
      const platformAccountReady = Gate.useAccountReady();
      const request = React.useRef(0);
      const no = () => {};
      const scope: any = { platformAccountReady, useCallback: React.useCallback, useEffect: React.useEffect,
        historyRequest: request, getSessionGeneration: require('../wbmSessionFence').getSessionGeneration,
        wellName: 'Well A', loadWellHistoryPresentation: history.loadWellHistoryPresentation,
        setData, setError, setLoading: no, setTotalRowsAvailable: no, setCachedRows: no, setSavedHistory: no, setRefreshingSavedHistory: no, t: (key: string) => key };
      scope.fetchData = makeLoader(scope); runEffect(scope);
      return React.createElement('Probe');
    }
    let rendered: any;
    await Renderer.act(async () => { rendered = Renderer.create(React.createElement(Gate, { restore: () => restore }, React.createElement(Probe))); });
    expect(setError).not.toHaveBeenCalled(); expect(setData).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    await Renderer.act(async () => {
      mockAuth.currentUser = mockSignedUser; release('current');
      for (let i = 0; i < 180; i++) await Promise.resolve();
    });
    expect(setData).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', rows: [expect.objectContaining({ packetId: 'source-child-key' })] }));
    expect(setError.mock.calls.some(([error]) => error)).toBe(false);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/getDriverWellHistory'))).toHaveLength(1);
    await Renderer.act(async () => rendered.unmount());
  });
});
