import { confirmOutgoingForPacket, OUTGOING_CONFIRMATION_DELAYS_MS } from '../outgoingConfirmation';

describe('confirmOutgoingForPacket', () => {
  it('accepted online pull starts bounded confirmation and stops on exact packet ID', async () => {
    const sleeps: number[] = [];
    const apply = jest.fn(async () => undefined);
    const fetchStatus = jest.fn(async () => ({
      responses: [{ wellName: 'Gabriel 1', lastPullPacketId: 'pkt-new' }],
    }));
    const result = await confirmOutgoingForPacket({
      wellName: 'Gabriel 1',
      packetId: 'pkt-new',
      delaysMs: [1, 2, 4, 8],
      sleep: async (ms) => { sleeps.push(ms); },
      fetchStatus,
      applyResponse: apply,
    });
    expect(result).toBe('confirmed');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(sleeps[0]).toBe(1);
    expect(fetchStatus.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('offline queued pull does not claim confirmation without an accepted packet id', async () => {
    const apply = jest.fn(async () => undefined);
    const result = await confirmOutgoingForPacket({
      wellName: 'Gabriel 1',
      packetId: '',
      delaysMs: [1],
      sleep: async () => undefined,
      fetchStatus: async () => ({ responses: [{ wellName: 'Gabriel 1', lastPullPacketId: 'x' }] }),
      applyResponse: apply,
    });
    expect(result).toBe('timed_out');
    expect(apply).not.toHaveBeenCalled();
  });

  it('retry loop terminates at its bound', async () => {
    const sleeps: number[] = [];
    const fetchStatus = jest.fn(async () => ({
      responses: [{ wellName: 'Gabriel 1', lastPullPacketId: 'old' }],
    }));
    const apply = jest.fn(async () => undefined);
    const delays = [1, 2, 4, 8];
    const result = await confirmOutgoingForPacket({
      wellName: 'Gabriel 1',
      packetId: 'new',
      delaysMs: delays,
      sleep: async (ms) => { sleeps.push(ms); },
      fetchStatus,
      applyResponse: apply,
    });
    expect(result).toBe('timed_out');
    expect(sleeps).toEqual(delays);
    expect(fetchStatus).toHaveBeenCalledTimes(delays.length + 1);
    expect(apply).not.toHaveBeenCalled();
  });

  it('backdated pull uses the same exact-id behavior as a current-time pull', async () => {
    const apply = jest.fn(async () => undefined);
    const result = await confirmOutgoingForPacket({
      wellName: 'Gabriel 1',
      packetId: '20260701_030000_Gab1_backdt',
      delaysMs: [1],
      sleep: async () => undefined,
      fetchStatus: async () => ({
        responses: [{ wellName: 'Gabriel 1', lastPullPacketId: '20260701_030000_Gab1_backdt' }],
      }),
      applyResponse: apply,
    });
    expect(result).toBe('confirmed');
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('documents the production delay schedule', () => {
    expect([...OUTGOING_CONFIRMATION_DELAYS_MS]).toEqual([1000, 2000, 4000, 8000]);
  });
});
