import { shouldApplyOutgoingResponse } from '../outgoingPendingGuard';

const pending = { wellName: 'Gabriel 1', packetId: '20260822_101500_Gab1_newpkt' };
const stale = {
  wellName: 'Gabriel 1',
  lastPullPacketId: '20260821_090000_Gab1_oldpkt',
  currentLevel: "12'0\"",
};
const matching = {
  wellName: 'Gabriel 1',
  lastPullPacketId: pending.packetId,
  currentLevel: "8'3\"",
};
const otherWell = {
  wellName: 'Gabriel 2',
  lastPullPacketId: '20260822_101500_Gab2_zzzzzz',
  currentLevel: "10'0\"",
};

describe('shouldApplyOutgoingResponse', () => {
  it('stale previous response cannot overwrite a new pending snapshot', () => {
    expect(shouldApplyOutgoingResponse(pending, stale)).toBe(false);
  });

  it('stale previous response cannot clear a new pending packet', () => {
    expect(shouldApplyOutgoingResponse(pending, { wellName: 'Gabriel 1' })).toBe(false);
    expect(shouldApplyOutgoingResponse(pending, { ...stale, lastPullPacketId: undefined })).toBe(false);
  });

  it('exact matching response applies and clears pending', () => {
    expect(shouldApplyOutgoingResponse(pending, matching)).toBe(true);
  });

  it('a response for another well still processes normally', () => {
    expect(shouldApplyOutgoingResponse(null, otherWell)).toBe(true);
    expect(shouldApplyOutgoingResponse(undefined, otherWell)).toBe(true);
  });

  it('does not use date/well/BBL fuzzy matching', () => {
    expect(
      shouldApplyOutgoingResponse(
        pending,
        { wellName: 'Gabriel 1', lastPullPacketId: 'totally-different-id' },
      ),
    ).toBe(false);
  });
});
