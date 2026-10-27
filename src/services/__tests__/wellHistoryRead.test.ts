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
const emptyResponse = () => ({ result: { ok: true, wellName: 'Well A', packets: {} } });
async function flush() { for (let i = 0; i < 50; i++) await Promise.resolve(); }

describe('actual well-history token / fetch / body read deadline', () => {
  let request: typeof import('../firebase').requestWellHistory;
  let fetcher: jest.Mock;
  const priorFetch = global.fetch;
  beforeEach(() => {
    jest.resetModules(); jest.useFakeTimers();
    mockUser = { uid: 'uid-a' }; mockGeneration = 0;
    mockToken.mockReset().mockResolvedValue('token'); mockConfig.mockReset().mockResolvedValue({});
    fetcher = jest.fn(async () => ({ ok: true, json: async () => emptyResponse() })); global.fetch = fetcher;
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
    mockConfig.mockImplementation(never); fetcher.mockResolvedValue({ ok: true, json: async () => emptyResponse() });
    await expire(request('Well A', 50));
  });
  it('rejects a late SDK or generation change and retains the successful empty-read contract', async () => {
    let resolve!: (value: unknown) => void;
    fetcher.mockResolvedValue({ ok: true, json: () => new Promise(yes => { resolve = yes; }) });
    const pending = request('Well A', 50); await flush(); mockGeneration++; mockUser = { uid: 'uid-b' }; resolve(emptyResponse());
    const result = await pending; expect(result!.status).toBe('error'); expect(result!.errorMessage).toContain('account changed');
    fetcher.mockResolvedValue({ ok: true, json: async () => emptyResponse() });
    const fresh = await request('Well A', 50); expect(fresh!.status).toBe('success'); expect(fresh!.rows).toEqual([]);
  });
  it('cancels an outstanding companion HTTP read when config fails early', async () => {
    let rejectConfig!: (reason: Error) => void;
    mockConfig.mockReturnValue(new Promise((_, reject) => { rejectConfig = reject; }));
    fetcher.mockImplementation(never); const pending = request('Well A', 50); await flush();
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    rejectConfig(Error('config unavailable')); expect((await pending)!.status).toBe('error'); expect(signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('retains existing full-well chronology, source keys, edit lineage and review flags before limiting rows', async () => {
    const base = { wellName: 'Well A', companyId: 'company-a', requestType: 'pull', driverName: 'Test Driver' };
    const packets = {
      'older-child-key': { ...base, packetId: 'different-embedded-id', dateTimeUTC: '2026-10-21T08:00:00Z', dateTime: '10/21/2026 3:00 AM', tankLevelFeet: 7, bblsTaken: 140 },
      'newer-child-key': { ...base, dateTimeUTC: '2026-10-21T10:00:00Z', dateTime: '10/21/2026 5:00 AM', tankLevelFeet: 8, bblsTaken: 185, requestType: 'edit', originalPacketId: 'older-child-key', lateEntry: true },
      deleted: { ...base, deleted: true, dateTimeUTC: '2026-10-21T11:00:00Z', tankLevelFeet: 9, bblsTaken: 140 },
    };
    fetcher.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: { ok: true, wellName: 'Well A', packets } }) });
    const result = await request('Well A', 1);
    expect(result!.status).toBe('success'); expect(result!.totalRows).toBe(2); expect(result!.rows).toHaveLength(1);
    expect(result!.rows[0]).toMatchObject({ packetId: 'newer-child-key', topLevel: `8'0"`, bbls: '185', isEdit: true, originalPacketId: 'older-child-key', lateEntry: true, originalData: { topLevel: `7'0"`, bbls: '140' } });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ data: { wellName: 'Well A' } });
  });
  it('preserves permission failures and performs no request without an SDK session', async () => {
    fetcher.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    expect((await request('Well A', 50))!.errorMessage).toContain('403');
    fetcher.mockClear(); mockUser = null;
    expect((await request('Well A', 50))!.status).toBe('error'); expect(fetcher).not.toHaveBeenCalled();
  });
});
