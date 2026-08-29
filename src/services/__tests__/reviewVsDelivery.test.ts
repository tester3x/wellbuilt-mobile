// Phase-1 regression freeze (2026-08-29): review tags are INFORMATION, never
// transport status. A pull flagged Late Entry / Anomaly / Potential Duplicate /
// Needs Review is still a successfully delivered pull; the badges must never
// feed the delivery counts, mark an entry failed, or trigger a retry.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true, type: 'cellular' })),
    addEventListener: jest.fn(() => () => undefined),
  },
}));
jest.mock('../firebase', () => ({
  uploadTankPacket: jest.fn(),
  uploadEditPacket: jest.fn(),
  mintPacketId: jest.fn(() => 'pid_mock'),
}));
jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => null),
  getDriverName: jest.fn(async () => null),
}));

import { computeDeliveryCounts } from '../deliveryStatus';
import { hasReviewSignals, reviewSignalsFromPacket } from '../../utils/reviewSignals';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');

function sentEntry(over: Record<string, unknown> = {}) {
  return {
    id: 'h1',
    packetId: '20260828_150000_Gabriel1_4p2ds2',
    packetTimestamp: '20260829_011114',
    wellName: 'Gabriel 1',
    dateTime: '8/28/2026 10:00 AM',
    tankLevelFeet: 10.4,
    bblsTaken: 140,
    sentAt: NOW - 60_000,
    status: 'sent' as const,
    syncStatus: 'sent' as const,
    ...over,
  } as any;
}

describe('review signals never contaminate delivery state', () => {
  test('a fully-flagged delivered pull contributes ZERO to every attention count', () => {
    const flagged = sentEntry({
      lateEntry: true, anomaly: true, potentialDuplicate: true, needsReview: true,
    });
    const counts = computeDeliveryCounts([], [flagged], NOW);
    expect(counts.pending).toBe(0);
    expect(counts.failed).toBe(0);
    expect(counts.submittedTooLong).toBe(0);
    expect(counts.rejected).toBe(0);
  });

  test('signals read defensively: only explicit true counts; absence means unflagged', () => {
    expect(reviewSignalsFromPacket({ lateEntry: true })).toEqual({
      lateEntry: true, anomaly: false, potentialDuplicate: false, needsReview: false,
    });
    expect(reviewSignalsFromPacket({ lateEntry: 'yes', anomaly: 1 } as any)).toEqual({
      lateEntry: false, anomaly: false, potentialDuplicate: false, needsReview: false,
    });
    expect(hasReviewSignals(reviewSignalsFromPacket(undefined))).toBe(false);
  });

  test('badge visibility is driven by review signals alone — not by syncStatus', () => {
    const rejectedButUnflagged = { lateEntry: false, anomaly: false, potentialDuplicate: false, needsReview: false };
    expect(hasReviewSignals(rejectedButUnflagged)).toBe(false); // a rejected packet is not "needs review" by transport
    expect(hasReviewSignals({ potentialDuplicate: true })).toBe(true);
  });
});
