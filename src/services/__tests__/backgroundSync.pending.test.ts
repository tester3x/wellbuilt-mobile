const saveLevelSnapshot = jest.fn(async () => undefined);
const clearPendingPull = jest.fn(async () => undefined);
const getPendingPull = jest.fn(async () => null);
const getLevelSnapshotSync = jest.fn(() => null);

jest.mock('../wellHistory', () => ({
  saveLevelSnapshot: (...args: unknown[]) => saveLevelSnapshot(...args),
  clearPendingPull: (...args: unknown[]) => clearPendingPull(...args),
  getPendingPull: (...args: unknown[]) => getPendingPull(...args),
  getLevelSnapshotSync: (...args: unknown[]) => getLevelSnapshotSync(...args),
}));

jest.mock('../firebaseListener', () => ({
  subscribeToOutgoing: jest.fn(),
  unsubscribeAll: jest.fn(),
  isListening: jest.fn(() => false),
  watchIncomingVersion: jest.fn(),
}));

import { processResponsePacket } from '../backgroundSync';

const pending = {
  wellName: 'Gabriel 1',
  packetId: '20260822_101500_Gab1_newpkt',
  topLevel: 12,
  bblsTaken: 140,
  packetTimestamp: '20260822_101500',
  timestamp: Date.now(),
};

const basePacket = {
  wellName: 'Gabriel 1',
  currentLevel: "8'3\"",
  flowRate: 'N/A',
  timeTillPull: 'N/A',
  nextPullTime: 'N/A',
  bbls24hrs: '0',
  status: 'ok',
  timestamp: '08/22/2026 10:20 AM',
  timestampUTC: '2026-08-22T15:20:00.000Z',
};

describe('processResponsePacket pending-packet identity', () => {
  beforeEach(() => {
    saveLevelSnapshot.mockClear();
    clearPendingPull.mockClear();
    getPendingPull.mockReset();
    getLevelSnapshotSync.mockReset();
  });

  it('stale previous response cannot overwrite a new pending snapshot or clear it', async () => {
    getPendingPull.mockResolvedValue(pending);
    await processResponsePacket({
      ...basePacket,
      lastPullPacketId: '20260821_090000_Gab1_oldpkt',
    });
    expect(saveLevelSnapshot).not.toHaveBeenCalled();
    expect(clearPendingPull).not.toHaveBeenCalled();
  });

  it('exact matching response applies and clears pending', async () => {
    getPendingPull.mockResolvedValue(pending);
    await processResponsePacket({
      ...basePacket,
      lastPullPacketId: pending.packetId,
    });
    expect(saveLevelSnapshot).toHaveBeenCalled();
    expect(clearPendingPull).toHaveBeenCalledWith('Gabriel 1');
  });

  it('a response for another well still processes normally', async () => {
    getPendingPull.mockImplementation(async (wellName: string) => (
      wellName === 'Gabriel 1' ? pending : null
    ));
    await processResponsePacket({
      ...basePacket,
      wellName: 'Gabriel 2',
      currentLevel: "10'0\"",
      lastPullPacketId: 'other-well-packet',
    });
    expect(saveLevelSnapshot).toHaveBeenCalled();
    expect(clearPendingPull).toHaveBeenCalledWith('Gabriel 2');
  });
});
