let mockUser: { uid: string } | null = { uid: 'uid-a' };
let mockGeneration = 0;
const mockToken = jest.fn();
const mockConfig = jest.fn();
jest.mock('../firebaseAuthSession', () => ({ getFirebaseAuth: () => ({ currentUser: mockUser }), getValidIdToken: () => mockToken() }));
jest.mock('../wbmSessionFence', () => ({ getSessionGeneration: () => mockGeneration }));
jest.mock('../driverAuth', () => ({ getDriverSession: jest.fn(async () => ({ companyId: 'company-a' })) }));
jest.mock('../wellConfig', () => ({ getWellConfig: (...args: unknown[]) => mockConfig(...args) }));
jest.mock('../platformDelivery', () => ({ platformDelivery: {} }));
const never = () => new Promise<any>(() => {});
async function flush() { for (let i = 0; i < 50; i++) await Promise.resolve(); }

describe('actual well-history token / fetch / body read deadline', () => {
  let request: typeof import('../firebase').requestWellHistory;
  let fetcher: jest.Mock;
  const priorFetch = global.fetch;
  beforeEach(() => {
    jest.resetModules(); jest.useFakeTimers();
    mockUser = { uid: 'uid-a' }; mockGeneration = 0;
    mockToken.mockReset().mockResolvedValue('token'); mockConfig.mockReset().mockResolvedValue({});
    fetcher = jest.fn(async () => ({ ok: true, json: async () => ({}) })); global.fetch = fetcher;
    request = require('../firebase').requestWellHistory;
    jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { global.fetch = priorFetch; jest.useRealTimers(); jest.restoreAllMocks(); });
  async function expire(pending: ReturnType<typeof request>) {
    await flush(); jest.advanceTimersByTime(15_001); await flush();
    const result = await pending; expect(result!.status).toBe('error'); expect(result!.errorMessage).toContain('timed out');
    return result;
  }
  it('bounds stalled token acquisition before any HTTP request', async () => {
    mockToken.mockImplementation(never); await expire(request('Well A', 50)); expect(fetcher).not.toHaveBeenCalled();
  });
  it('aborts stalled HTTP fetch and reports an error rather than an invented empty success', async () => {
    fetcher.mockImplementation(never); const pending = request('Well A', 50); await flush();
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal; expect(signal.aborted).toBe(false);
    await expire(pending); expect(signal.aborted).toBe(true);
  });
  it('bounds stalled response body decoding and dependent config', async () => {
    fetcher.mockResolvedValue({ ok: true, json: never }); await expire(request('Well A', 50));
    mockConfig.mockImplementation(never); fetcher.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expire(request('Well A', 50));
  });
  it('rejects a late SDK or generation change and retains the successful empty-read contract', async () => {
    let resolve!: (value: unknown) => void;
    fetcher.mockResolvedValue({ ok: true, json: () => new Promise(yes => { resolve = yes; }) });
    const pending = request('Well A', 50); await flush(); mockGeneration++; mockUser = { uid: 'uid-b' }; resolve({});
    const result = await pending; expect(result!.status).toBe('error'); expect(result!.errorMessage).toContain('account changed');
    fetcher.mockResolvedValue({ ok: true, json: async () => ({}) });
    const fresh = await request('Well A', 50); expect(fresh!.status).toBe('success'); expect(fresh!.rows).toEqual([]);
  });
  it('preserves permission failures and performs no request without an SDK session', async () => {
    fetcher.mockResolvedValue({ ok: false, status: 403 });
    expect((await request('Well A', 50))!.errorMessage).toContain('403');
    fetcher.mockClear(); mockUser = null;
    expect((await request('Well A', 50))!.status).toBe('error'); expect(fetcher).not.toHaveBeenCalled();
  });
});
