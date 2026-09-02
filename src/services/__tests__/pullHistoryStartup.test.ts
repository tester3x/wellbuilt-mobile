// Startup-hang regression tests for pullHistory's Firebase backfill.
//
// The production defect: getPullHistory() → loadPullHistory() → backfillAndMerge()
// → backfillFromFirebase() did a bare `await fetch(packets/processed?companyId=…)`
// (a large company-wide scan) with NO timeout, ON the awaited path a screen needs
// for first render. On a cold start that hung Pull History / startup for minutes.
//
// These tests prove the fixed contract:
//  - local history renders FIRST (never gated on the network scan),
//  - the scan is bounded (AbortController timeout) and never throws / never drops local,
//  - failure modes are classified distinctly (offline / auth / permission / timeout /
//    server), local history preserved on every one,
//  - concurrent callers share a single in-flight scan (single-flight),
//  - a successful scan merges cross-app pulls, local-authoritative on shared fields.

const mockStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
    removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
  },
}));

let mockNetConnected = true;
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ isConnected: mockNetConnected, isInternetReachable: mockNetConnected, type: 'cellular' })) },
}));

let mockIdToken: () => Promise<string> = async () => 'tok_ok';
jest.mock('../firebaseAuthSession', () => ({
  __esModule: true,
  getValidIdToken: jest.fn(() => mockIdToken()),
  AuthSessionError: class AuthSessionError extends Error {},
}));

jest.mock('../driverAuth', () => ({
  __esModule: true,
  getDriverId: jest.fn(async () => 'driver-123'),
  getDriverName: jest.fn(async () => 'Test Driver'),
  getDriverSession: jest.fn(async () => ({ companyId: 'co-1' })),
}));

jest.mock('../wellConfig', () => ({
  __esModule: true,
  getTrustedHistoryDriverIds: jest.fn(() => []),
}));

import {
  PullHistoryEntry,
  getPullHistory,
  loadPullHistory,
  clearPullHistory,
  getLastBackfillStatus,
  refreshFromServer,
  __setBackfillTimingForTests,
  __resetBackfillStateForTests,
} from '../pullHistory';

const RECENT = Date.now() - 60 * 60 * 1000; // 1h ago, well inside the 7-day window

const localEntry = (over: Partial<PullHistoryEntry> = {}): PullHistoryEntry => ({
  id: 'A',
  wellName: 'Alpha 1',
  dateTime: '9/1/2026 3:10 PM',
  tankLevelFeet: 10,
  bblsTaken: 100,
  wellDown: false,
  sentAt: RECENT,
  packetTimestamp: '20260901_151000',
  packetId: 'A',
  status: 'sent',
  ...over,
});

const seedLocal = (entries: PullHistoryEntry[]) => {
  mockStore['@wellbuilt_pull_history'] = JSON.stringify(entries);
};

const readStored = (): PullHistoryEntry[] => {
  const raw = mockStore['@wellbuilt_pull_history'];
  return raw ? JSON.parse(raw) : [];
};

// A fetch mock whose promise NEVER resolves on its own but honors abort → AbortError.
const neverResolvingFetch = () =>
  jest.fn((_url: string, opts: any) => new Promise((_res, reject) => {
    const signal = opts?.signal;
    if (signal) signal.addEventListener('abort', () => {
      const e: any = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e);
    });
  }));

// A fetch mock returning a fixed HTTP status / JSON body.
const httpFetch = (status: number, body: any = {}) =>
  jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body } as any));

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  __resetBackfillStateForTests();
  // Deterministic + fast: 40ms timeout, NO retry unless a test opts in.
  __setBackfillTimingForTests({ timeoutMs: 40, backoffMs: [] });
  mockNetConnected = true;
  mockIdToken = async () => 'tok_ok';
  (global as any).fetch = httpFetch(200, {});
});

afterEach(async () => {
  // Drain any in-flight scan so no timers leak between tests.
  try { await refreshFromServer(); } catch { /* never throws anyway */ }
  await clearPullHistory();
});

describe('pullHistory startup-hang fix', () => {
  test('fetch that NEVER resolves → getPullHistory returns local promptly; scan aborts on timeout; local preserved', async () => {
    seedLocal([localEntry()]);
    (global as any).fetch = neverResolvingFetch();

    const result = await getPullHistory();
    // Rendered LOCAL history without waiting on the (hanging) network scan:
    expect(result.map(e => e.packetId)).toEqual(['A']);

    // The kicked-off scan is the in-flight one; awaiting it proves bounded abort.
    const status = await refreshFromServer();
    expect(status).toBe('timeout');
    expect(getLastBackfillStatus()).toBe('timeout');

    // Local history is completely intact.
    expect(readStored().map(e => e.packetId)).toEqual(['A']);
    expect((await getPullHistory()).map(e => e.bblsTaken)).toEqual([100]);
  });

  test('delayed auth (slow getValidIdToken) does NOT block local render', async () => {
    seedLocal([localEntry()]);
    let tokenResolved = false;
    mockIdToken = () => new Promise<string>(res => setTimeout(() => { tokenResolved = true; res('tok_slow'); }, 120));

    const result = await getPullHistory();
    // Returned before the auth token even resolved.
    expect(tokenResolved).toBe(false);
    expect(result.map(e => e.packetId)).toEqual(['A']);

    // Let it settle; a slow-but-fine token still ends 'ok' and never loses local.
    await refreshFromServer();
    expect(readStored().map(e => e.packetId)).toEqual(['A']);
  });

  test('offline startup → returns local, classifies offline, no throw, no fetch', async () => {
    seedLocal([localEntry()]);
    mockNetConnected = false;
    const spy = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({}) } as any));
    (global as any).fetch = spy;

    const result = await getPullHistory();
    expect(result.map(e => e.packetId)).toEqual(['A']);

    const status = await refreshFromServer();
    expect(status).toBe('offline');
    expect(spy).not.toHaveBeenCalled(); // never opened the company scan while offline
    expect(readStored().map(e => e.packetId)).toEqual(['A']);
  });

  test('permission refusal (403) → classified permission, local preserved', async () => {
    seedLocal([localEntry()]);
    (global as any).fetch = httpFetch(403, {});

    const result = await getPullHistory();
    expect(result.map(e => e.packetId)).toEqual(['A']);

    const status = await refreshFromServer();
    expect(status).toBe('permission');
    expect(readStored().map(e => e.packetId)).toEqual(['A']);
  });

  test('5xx server error → classified server, local preserved', async () => {
    seedLocal([localEntry()]);
    (global as any).fetch = httpFetch(503, {});

    const result = await getPullHistory();
    expect(result.map(e => e.packetId)).toEqual(['A']);

    const status = await refreshFromServer();
    expect(status).toBe('server');
    expect(readStored().map(e => e.packetId)).toEqual(['A']);
  });

  test('auth-session failure (getValidIdToken throws) → classified auth, local preserved', async () => {
    seedLocal([localEntry()]);
    mockIdToken = async () => { const e: any = new Error('revoked'); e.name = 'AuthSessionError'; throw e; };

    const result = await getPullHistory();
    expect(result.map(e => e.packetId)).toEqual(['A']);

    const status = await refreshFromServer();
    expect(status).toBe('auth');
    expect(readStored().map(e => e.packetId)).toEqual(['A']);
  });

  test('concurrent callers / repeated opens → SINGLE-FLIGHT (fetch called at most once)', async () => {
    seedLocal([localEntry()]);
    let fetchCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>(res => { release = res; });
    // Return a NON-empty matching body so the (legitimate) nameless-fallback second
    // fetch is not taken — this isolates the single-flight assertion to one scan.
    const body = { A: { companyId: 'co-1', driverId: 'driver-123', wellName: 'Alpha 1', dateTime: '9/1/2026 3:10 PM', dateTimeUTC: new Date(RECENT).toISOString(), bblsTaken: 100 } };
    (global as any).fetch = jest.fn(async () => {
      fetchCalls++;
      await gate; // hold the scan open while all callers pile in
      return { ok: true, status: 200, json: async () => body } as any;
    });

    // Five concurrent scans requested at once.
    const scans = [refreshFromServer(), refreshFromServer(), refreshFromServer(), refreshFromServer(), refreshFromServer()];
    // Also drive it via the render path a couple of times — must not add scans.
    await getPullHistory();
    await loadPullHistory();

    release();
    await Promise.all(scans);
    expect(fetchCalls).toBe(1); // exactly one company scan despite many callers
  });

  test('restart (session/module state reset) → local history loads from storage', async () => {
    seedLocal([localEntry({ packetId: 'A', bblsTaken: 77 }), localEntry({ id: 'B', packetId: 'B', wellName: 'Beta 2', bblsTaken: 42 })]);
    // Simulate a fresh session: nothing cached in-module yet.
    __resetBackfillStateForTests();
    (global as any).fetch = httpFetch(200, {}); // empty scan, nothing to merge

    const loaded = await loadPullHistory();
    expect(loaded.map(e => e.packetId).sort()).toEqual(['A', 'B']);
    expect(loaded.find(e => e.packetId === 'A')?.bblsTaken).toBe(77);
  });

  test('eventual successful merge → slow-but-OK scan adds cross-app entry; local wins on shared fields', async () => {
    const original = localEntry({ packetId: 'A', bblsTaken: 100, dateTime: '9/1/2026 3:10 PM', sentAt: RECENT });
    seedLocal([original]);

    const serverBody = {
      // Existing A, edited server-side to 150 bbls with a DIFFERENT server dateTime.
      A: {
        companyId: 'co-1', driverId: 'driver-123', wellName: 'Alpha 1',
        dateTime: '1/1/2000 12:00 AM', dateTimeUTC: new Date(RECENT).toISOString(),
        tankLevelFeet: 12, bblsTaken: 150, wellDown: false, editCount: 1, editedAt: '2026-09-01T20:00:00Z',
      },
      // New cross-app pull B (e.g. entered in WB T) not present locally.
      B: {
        companyId: 'co-1', driverId: 'driver-123', wellName: 'Beta 2',
        dateTime: '9/1/2026 4:00 PM', dateTimeUTC: new Date(RECENT + 1000).toISOString(),
        tankLevelFeet: 8, bblsTaken: 80, wellDown: false,
      },
    };
    (global as any).fetch = jest.fn(async () => {
      await new Promise(res => setTimeout(res, 30)); // slow but successful
      return { ok: true, status: 200, json: async () => serverBody } as any;
    });

    // First render still returns ONLY local, immediately.
    const firstRender = await getPullHistory();
    expect(firstRender.map(e => e.packetId)).toEqual(['A']);

    // After the scan lands…
    const status = await refreshFromServer();
    expect(status).toBe('ok');

    const merged = readStored();
    const a = merged.find(e => e.packetId === 'A')!;
    const b = merged.find(e => e.packetId === 'B')!;

    // Cross-app entry merged in:
    expect(b).toBeDefined();
    expect(b.bblsTaken).toBe(80);

    // Canonical measurement reconciled from server…
    expect(a.bblsTaken).toBe(150);
    expect(a.status).toBe('edited');
    // …but local-authoritative identity/time fields are PRESERVED (never downgraded).
    expect(a.dateTime).toBe('9/1/2026 3:10 PM');
    expect(a.sentAt).toBe(RECENT);
    expect(a.packetId).toBe('A');
  });
});
