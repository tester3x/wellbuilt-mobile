const mockToken = jest.fn(async () => 'sdk-token');
jest.mock('../firebaseAuthSession', () => ({ getValidIdToken: () => mockToken() }));
import { fetchWellHistoryPackets } from '../wellHistoryClient';
import type { WellHistoryRead } from '../wellHistoryRead';

describe('exact-well history callable transport', () => {
  const priorFetch = global.fetch;
  let fetcher: jest.Mock, controller: AbortController, read: WellHistoryRead;
  beforeEach(() => {
    mockToken.mockClear(); controller = new AbortController();
    read = { signal: controller.signal, wait: stage => stage() };
    fetcher = jest.fn(); global.fetch = fetcher;
  });
  afterEach(() => { global.fetch = priorFetch; });
  function reply(result: unknown, status = 200) { fetcher.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => ({ result }) }); }
  it('sends only literal well identity with SDK bearer authentication and the existing deadline signal', async () => {
    reply({ ok: true, wellName: 'Well A', packets: {} });
    await fetchWellHistoryPackets('Well A', read);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://us-central1-wellbuilt-sync.cloudfunctions.net/getDriverWellHistory');
    expect(init.method).toBe('POST'); expect(JSON.parse(init.body)).toEqual({ data: { wellName: 'Well A' } });
    expect(init.headers.Authorization).toBe('Bearer sdk-token'); expect(init.signal).toBe(controller.signal);
  });
  it('preserves the full original well packet map, including child keys, edit lineage and review markers', async () => {
    const packets: Record<string, any> = {};
    for (let i = 0; i < 150; i++) packets[`original-child-key-${i}`] = { wellName: 'Well A', companyId: 'company-a', packetId: `different-packet-id-${i}`, originalPacketId: 'lineage-a', tankLevelFeet: 8, bblsTaken: 185, lateEntry: i === 0, customPreservedField: i };
    reply({ ok: true, wellName: 'Well A', packets });
    expect(await fetchWellHistoryPackets('Well A', read)).toBe(packets);
  });
  it('keeps a real authorized empty history distinct from denied or malformed replies', async () => {
    reply({ ok: true, wellName: 'Well A', packets: {} }); expect(await fetchWellHistoryPackets('Well A', read)).toEqual({});
    fetcher.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { status: 'PERMISSION_DENIED', message: 'well_out_of_scope' } }) });
    await expect(fetchWellHistoryPackets('Well A', read)).rejects.toMatchObject({ message: 'well_out_of_scope', callableStatus: 'PERMISSION_DENIED', httpStatus: 403 });
  });
  it.each([
    { ok: true, wellName: 'Other', packets: {} },
    { ok: true, wellName: 'Well A', packets: [] },
    { ok: true, wellName: 'Well A', packets: { bad: { wellName: 'Other' } } },
    { wellName: 'Well A', packets: {} },
  ])('rejects an unverifiable response without a broad fallback: %p', async result => {
    reply(result); await expect(fetchWellHistoryPackets('Well A', read)).rejects.toThrow('could not be verified'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
