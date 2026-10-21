import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const mockStore: Record<string, string> = {};
const mockSecure: Record<string, string> = {};
let mockUser: { uid: string } | null = { uid: 'uid-a' };
const mockCallable = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
  removeItem: jest.fn(async (key: string) => { delete mockStore[key]; }),
} }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecure[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockSecure[key] = value; }),
  deleteItemAsync: jest.fn(async (key: string) => { delete mockSecure[key]; }),
}));
jest.mock('../firebaseAuthSession', () => ({
  getFirebaseAuth: () => ({ currentUser: mockUser }),
  authorizedCallable: (...args: unknown[]) => mockCallable(...args),
}));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 100; i++) await Promise.resolve(); }
function snapshot(driverId = 'driver-a', revision = 1) {
  return { ok: true, driverId, companyId: 'company-a', active: true, assignedRoutes: ['Route A'], assignedWells: [],
    assignmentRevision: revision, assignmentDigest: `digest-${driverId}-${revision}`, eligibilityStatus: 'eligible', eligibilityReason: 'scope_ok',
    wells: { [`${driverId}-well-${revision}`]: { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Route A' } }, wellCount: 1 };
}
describe('owner-fenced Summary and History presentation', () => {
  let config: typeof import('../wellConfig');
  let presentation: typeof import('../wellPresentation');
  beforeEach(() => {
    jest.resetModules();
    for (const key of Object.keys(mockStore)) delete mockStore[key];
    for (const key of Object.keys(mockSecure)) delete mockSecure[key];
    Object.assign(mockSecure, { driverId: 'driver-a', companyId: 'company-a', authUid: 'uid-a' });
    mockUser = { uid: 'uid-a' }; mockCallable.mockReset();
    config = require('../wellConfig'); presentation = require('../wellPresentation');
  });
  it('renders the actual scoped durable envelope before a never-resolving bootstrap and coalesces background refresh', async () => {
    await config.persistBootstrapEnvelopeForTests(snapshot() as any);
    mockCallable.mockImplementation(() => new Promise(() => {}));
    const first = await presentation.loadWellPresentation();
    expect(Object.keys(first!.envelope.wells)).toEqual(['driver-a-well-1']); expect(first!.isCurrent()).toBe(true);
    await presentation.loadWellPresentation(); await presentation.loadWellPresentation(); await flush();
    expect(mockCallable).toHaveBeenCalledTimes(1);
  });
  it('manual refresh still waits for the newly verified server envelope', async () => {
    await config.persistBootstrapEnvelopeForTests(snapshot() as any);
    const network = deferred<any>(); mockCallable.mockReturnValue(network.promise);
    let finished = false; const fresh = presentation.loadWellPresentation(true).then(view => { finished = true; return view; });
    await flush(); expect(finished).toBe(false); expect(mockCallable).toHaveBeenCalledTimes(1);
    network.resolve(snapshot('driver-a', 2)); expect((await fresh)!.envelope.assignmentRevision).toBe(2);
  });
  it('a generation/account change invalidates the visible view and rejects a delayed old refresh', async () => {
    await config.persistBootstrapEnvelopeForTests(snapshot() as any);
    const network = deferred<any>(); mockCallable.mockReturnValue(network.promise);
    const view = await presentation.loadWellPresentation(); await flush();
    config.claimSessionGeneration(); Object.assign(mockSecure, { driverId: 'driver-b', authUid: 'uid-b' }); mockUser = { uid: 'uid-b' };
    expect(view!.isCurrent()).toBe(false);
    network.resolve(snapshot()); await flush();
    expect(config.peekWellConfigCacheForTests().envelope?.driverId).not.toBe('driver-b');
  });
  it('cannot show old saved-driver data under a different SDK user or without Auth', async () => {
    await config.persistBootstrapEnvelopeForTests(snapshot() as any);
    mockUser = { uid: 'other-uid' }; expect(await presentation.loadWellPresentation()).toBeNull();
    mockUser = null; expect(await presentation.loadWellPresentation()).toBeNull(); expect(mockCallable).not.toHaveBeenCalled();
  });
  it('does not turn an unscoped legacy config or unknown eligibility into cached access', async () => {
    mockStore['@wellbuilt_well_config'] = JSON.stringify({ 'foreign-well': { route: 'Other' } });
    mockCallable.mockRejectedValue(Error('unavailable'));
    await expect(presentation.loadWellPresentation()).rejects.toThrow();
    await config.persistBootstrapEnvelopeForTests({ ...snapshot(), eligibilityStatus: 'unknown' } as any);
    await expect(presentation.loadWellPresentation()).rejects.toThrow();
  });
  it('a confirmed empty/ineligible assignment remains empty after cached rendering', async () => {
    await config.persistBootstrapEnvelopeForTests({ ...snapshot(), assignedRoutes: [], eligibilityStatus: 'ineligible', eligibilityReason: 'scope_empty' } as any);
    mockCallable.mockImplementation(() => new Promise(() => {}));
    const view = await presentation.loadWellPresentation();
    expect(config.scopedWellsForDisplay(view!.envelope.wells as any, { ...view!.envelope.eligibility, routes: view!.envelope.eligibility.routes || [], wells: view!.envelope.eligibility.wells || [] })).toEqual({});
  });
  it('Summary and History consume the presentation boundary and manual refresh stays explicit', () => {
    const summary = readFileSync(resolve(__dirname, '../../../app/summary.tsx'), 'utf8');
    const history = readFileSync(resolve(__dirname, '../../../app/history.tsx'), 'utf8');
    for (const source of [summary, history]) {
      expect(source).toContain('loadWellPresentation(forceRefresh)'); expect(source).not.toMatch(/await loadWellConfig\(/);
      expect(source).toMatch(/presentation\??\.isCurrent\(\)/);
    }
    expect(summary).toContain('loadSummaryData(true)'); expect(history).toContain('loadHistory(true)');
    expect(summary).not.toContain('await fetchDriverRouteAssignment()'); expect(history).not.toContain('await getAllWellNames()');
  });
});
