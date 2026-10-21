const mockStore: Record<string, string> = {};
let mockUser = { uid: 'uid-a' };
let mockCurrent = true;
let mockGeneration = 0;
let mockEnvelope: any;
const mockQuery = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
} }));
jest.mock('../firebaseAuthSession', () => ({ getFirebaseAuth: () => ({ currentUser: mockUser }) }));
jest.mock('../wellPresentation', () => ({ loadWellPresentation: jest.fn(async () => {
  const generation = mockGeneration;
  return mockCurrent ? { envelope: mockEnvelope, isCurrent: () => mockCurrent && generation === mockGeneration } : null;
}) }));
jest.mock('../wbmSessionFence', () => ({ getSessionGeneration: () => mockGeneration }));
jest.mock('../firebase', () => ({ requestWellHistory: (...args: unknown[]) => mockQuery(...args) }));
function response(wellName = 'Well A', rows: any[] = []) { return { wellName, status: 'success', rows, rowCount: rows.length, totalRows: rows.length, timestamp: '10/21/2026', timestampUTC: '2026-10-21T00:00:00Z' }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 50; i++) await Promise.resolve(); }
describe('exact owner and well history presentation cache', () => {
  let api: typeof import('../wellHistoryPresentation'), now: number;
  beforeEach(() => {
    jest.resetModules(); for (const key of Object.keys(mockStore)) delete mockStore[key];
    mockUser = { uid: 'uid-a' }; mockCurrent = true; mockGeneration = 0;
    mockEnvelope = { driverId: 'driver-a', companyId: 'company-a', assignmentRevision: 1, assignmentDigest: 'digest-a' };
    mockQuery.mockReset(); now = 100000; jest.spyOn(Date, 'now').mockImplementation(() => now);
    api = require('../wellHistoryPresentation');
  });
  afterEach(() => jest.restoreAllMocks());
  it('returns exact saved rows immediately while authenticated refresh is stalled and shares the refresh', async () => {
    const row = { packetId: 'packet-a', dateTime: '10/21/2026 01:00 AM', topLevel: "7'4\"", bbls: '185' };
    mockQuery.mockResolvedValue(response('Well A', [row])); await api.loadWellHistoryPresentation('Well A');
    now += 31000; const network = deferred<any>(); mockQuery.mockReturnValue(network.promise);
    const saved = await api.loadWellHistoryPresentation('Well A'); expect(saved!.source).toBe('saved'); expect(saved!.response!.rows).toEqual([row]);
    expect(saved!.refresh).not.toBeNull(); await api.loadWellHistoryPresentation('Well A'); expect(mockQuery).toHaveBeenCalledTimes(2);
    network.resolve(response('Well A', [row, { ...row, packetId: 'packet-b' }])); expect((await saved!.refresh)!.rows).toHaveLength(2);
  });
  it('manual refresh bypasses the saved snapshot and the short refresh cooldown', async () => {
    mockQuery.mockResolvedValue(response()); await api.loadWellHistoryPresentation('Well A');
    const network = deferred<any>(); mockQuery.mockReturnValue(network.promise);
    let settled = false; const fresh = api.loadWellHistoryPresentation('Well A', true).then(view => { settled = true; return view; });
    await flush(); expect(settled).toBe(false); expect(mockQuery).toHaveBeenCalledTimes(2);
    network.resolve(response()); expect((await fresh)!.source).toBe('server');
  });
  it('cached data cannot cross literal well, owner/company or assignment revision boundaries', async () => {
    mockQuery.mockResolvedValue(response()); await api.loadWellHistoryPresentation('Well A');
    mockQuery.mockResolvedValue(response('Well B')); expect((await api.loadWellHistoryPresentation('Well B'))!.source).toBe('server');
    mockUser = { uid: 'uid-b' }; mockEnvelope = { driverId: 'driver-b', companyId: 'company-b', assignmentRevision: 2, assignmentDigest: 'digest-b' };
    mockQuery.mockResolvedValue(response()); expect((await api.loadWellHistoryPresentation('Well A'))!.source).toBe('server');
    mockEnvelope = { ...mockEnvelope, assignmentRevision: 3, assignmentDigest: 'digest-new' };
    expect((await api.loadWellHistoryPresentation('Well A'))!.source).toBe('server'); expect(mockQuery).toHaveBeenCalledTimes(4);
  });
  it('SDK/account change during an authenticated read cannot publish or cache its old response', async () => {
    const network = deferred<any>(); mockQuery.mockReturnValue(network.promise);
    const pending = api.loadWellHistoryPresentation('Well A'); await flush(); mockUser = { uid: 'uid-b' };
    network.resolve(response()); expect(await pending).toBeNull(); expect(Object.keys(mockStore)).toEqual([]);
    mockCurrent = false; expect(await api.loadWellHistoryPresentation('Well A')).toBeNull();
  });
  it('a new generation or SDK user object cannot join an old in-flight query', async () => {
    const oldNetwork = deferred<any>(), newNetwork = deferred<any>();
    mockQuery.mockReturnValueOnce(oldNetwork.promise).mockReturnValueOnce(newNetwork.promise);
    const old = api.loadWellHistoryPresentation('Well A'); await flush();
    mockGeneration++; mockUser = { uid: 'uid-a' };
    const fresh = api.loadWellHistoryPresentation('Well A'); await flush();
    expect(mockQuery).toHaveBeenCalledTimes(2);
    oldNetwork.resolve(response()); expect(await old).toBeNull();
    newNetwork.resolve(response()); expect((await fresh)!.source).toBe('server');
    expect(Object.keys(mockStore)).toHaveLength(1);
  });
  it('a corrupt or mismatched successful response is never accepted as cached history', async () => {
    mockQuery.mockResolvedValue(response('Other Well')); const bad = await api.loadWellHistoryPresentation('Well A');
    expect(bad!.response).toBeNull(); expect(Object.keys(mockStore)).toEqual([]);
    mockQuery.mockResolvedValue(response()); await api.loadWellHistoryPresentation('Well A');
    const key = Object.keys(mockStore)[0]; mockStore[key] = 'corrupt-json';
    expect((await api.loadWellHistoryPresentation('Well A'))!.source).toBe('server');
  });
  it('old cached read remains available for display when background query fails without inventing a fresh record', async () => {
    mockQuery.mockResolvedValue(response()); await api.loadWellHistoryPresentation('Well A');
    now += 31000; mockQuery.mockRejectedValue(Error('offline'));
    const saved = await api.loadWellHistoryPresentation('Well A'); expect(saved!.source).toBe('saved');
    await expect(saved!.refresh).rejects.toThrow('offline'); expect(saved!.response).toEqual(response());
  });
});
const ts = require('typescript') as typeof import('typescript');
const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');

/** Execute the actual screen callback, without replacing it with a test copy. */
function screenCallback(deps: Record<string, unknown>): (force?: boolean) => Promise<void> {
  const file = ts.createSourceFile('well-data.tsx', fs.readFileSync(path.join(__dirname, '../../../app/well-data.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: import('typescript').Node | undefined;
  const visit = (node: import('typescript').Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'fetchData' && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!callback) throw Error('fetchData callback not found');
  const compiled = ts.transpileModule(`module.exports = ${callback.getText(file)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: undefined as unknown };
  new Function('module', ...Object.keys(deps), compiled)(module, ...Object.values(deps));
  return module.exports as (force?: boolean) => Promise<void>;
}

describe('actual well-data screen callback', () => {
  function fixture() {
    const refresh = deferred<any>(), request = { current: 0 };
    let generation = 0, current = true;
    const row = { packetId: 'packet-a', dateTime: '10/21/2026 01:00 AM', topLevel: "7'4\"", bbls: '185' };
    const deps = {
      historyRequest: request, getSessionGeneration: () => generation,
      loadWellHistoryPresentation: jest.fn(async () => ({ response: response('Well A', [row]), source: 'saved', refresh: refresh.promise, isCurrent: () => current })),
      wellName: 'Well A', t: (key: string) => key,
      setData: jest.fn(), setError: jest.fn(), setCachedRows: jest.fn(), setTotalRowsAvailable: jest.fn(),
      setSavedHistory: jest.fn(), setRefreshingSavedHistory: jest.fn(),
      console: { log: jest.fn(), error: jest.fn() },
    };
    return { deps, refresh, row, run: screenCallback(deps), invalidate: () => { generation++; current = false; } };
  }
  it('shows saved rows and completes the awaited mount callback before refresh settles', async () => {
    const f = fixture(); await f.run(false);
    expect(f.deps.setCachedRows).toHaveBeenLastCalledWith([f.row]);
    expect(f.deps.setSavedHistory).toHaveBeenLastCalledWith(true);
    expect(f.deps.setRefreshingSavedHistory).toHaveBeenLastCalledWith(true);
    f.refresh.resolve(response('Well A', [f.row, { ...f.row, packetId: 'packet-b' }])); await flush();
    expect(f.deps.setCachedRows.mock.calls[1][0]).toHaveLength(2);
    expect(f.deps.setSavedHistory).toHaveBeenLastCalledWith(false);
    expect(f.deps.setRefreshingSavedHistory).toHaveBeenLastCalledWith(false);
  });
  it('a rejected local owner lease is not presented as a network timeout', async () => {
    const f = fixture(); f.deps.loadWellHistoryPresentation.mockResolvedValueOnce(null as any);
    await f.run(false); expect(f.deps.setError).toHaveBeenLastCalledWith('wellData.errorSession');
    expect(f.deps.setCachedRows).not.toHaveBeenCalled();
  });
  it('a late refresh cannot update screen rows after navigation/account invalidation', async () => {
    const f = fixture(); await f.run(false); f.invalidate();
    f.refresh.resolve(response('Well A', [f.row, { ...f.row, packetId: 'packet-b' }])); await flush();
    expect(f.deps.setData).toHaveBeenCalledTimes(1); expect(f.deps.setCachedRows).toHaveBeenCalledTimes(1);
  });
});
