// The reported field bug: a "⚠ 28 need attention" badge that opens an EMPTY list.
// Root cause: the badge showed a STALE snapshot of stuck-'submitted' pulls; when the
// Sync Status screen opened it reconciled them to 'sent' first, so the fresh list was
// empty. These pins prove the shared selector keeps count↔list in parity BEFORE and
// AFTER reconcile, that a resolved record leaves BOTH, and that badgeOpenFilter yields
// no destination once nothing is actionable (so the on-tap reconcile can never open an
// empty list). Review/provenance tags (Late Entry/Anomaly/…) are server-side and are
// NOT part of the client delivery model, so they can never inflate the transport count.
const mockStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in mockStore ? mockStore[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
    removeItem: jest.fn(async (k: string) => { delete mockStore[k]; }),
  },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true, type: 'cellular' })), addEventListener: jest.fn(() => () => undefined) },
}));
jest.mock('../firebase', () => ({ uploadTankPacket: jest.fn(), uploadEditPacket: jest.fn(), mintPacketId: jest.fn(() => 'pid_mock') }));
jest.mock('../driverAuth', () => ({ getDriverId: jest.fn(async () => null), getDriverName: jest.fn(async () => null) }));

import {
  SUBMITTED_ATTENTION_MS, badgeOpenFilter, buildDeliveryItems, computeDeliveryCounts, selectDeliveryItems,
} from '../deliveryStatus';
import type { PullHistoryEntry } from '../pullHistory';

const NOW = 1_769_200_000_000;
const stuckSubmitted = (i: number): PullHistoryEntry => ({
  id: `p${i}`, wellName: `Well ${i}`, dateTime: '7/23/2026 5:40 AM', tankLevelFeet: 12, bblsTaken: 140,
  wellDown: false, submittedAt: NOW - SUBMITTED_ATTENTION_MS - 60_000, packetTimestamp: `t${i}`,
  packetId: `p${i}`, status: 'submitted', syncStatus: 'submitted',
} as unknown as PullHistoryEntry);
const sent = (e: PullHistoryEntry): PullHistoryEntry => ({ ...e, status: 'sent', syncStatus: 'sent', sentAt: NOW });

const parity = (history: PullHistoryEntry[]) => {
  const counts = computeDeliveryCounts([], history, NOW, []);
  const items = buildDeliveryItems([], history, [], NOW);
  const list = selectDeliveryItems(items, 'attention');
  expect(counts.attention).toBe(list.length); // THE invariant
  return { counts, list };
};

describe('badge staleness ↔ reconcile parity (the 28→empty field bug)', () => {
  test('28 stuck-submitted pulls → badge 28 AND list 28 (parity before reconcile)', () => {
    const history = Array.from({ length: 28 }, (_, i) => stuckSubmitted(i));
    const { counts, list } = parity(history);
    expect(counts.attention).toBe(28);
    expect(list.length).toBe(28);
    expect(badgeOpenFilter(counts)).toBe('attention');
  });

  test('after reconcile marks them sent → badge 0 AND list 0 (parity after reconcile); no destination', () => {
    const reconciled = Array.from({ length: 28 }, (_, i) => sent(stuckSubmitted(i)));
    const { counts, list } = parity(reconciled);
    expect(counts.attention).toBe(0);
    expect(list.length).toBe(0);
    // The on-tap recount routes on THIS: no actionable → no navigation → no empty list.
    expect(badgeOpenFilter(counts)).toBeNull();
  });

  test('mixed: one still-stuck + 27 reconciled → badge 1 AND list 1 (exact parity)', () => {
    const history = [stuckSubmitted(0), ...Array.from({ length: 27 }, (_, i) => sent(stuckSubmitted(i + 1)))];
    const { counts, list } = parity(history);
    expect(counts.attention).toBe(1);
    expect(list.length).toBe(1);
    expect(list[0].packetId).toBe('p0');
  });

  test('a resolved (sent) record disappears from BOTH the count and the list', () => {
    const before = parity([stuckSubmitted(1)]);
    expect(before.counts.attention).toBe(1);
    const after = parity([sent(stuckSubmitted(1))]);
    expect(after.counts.attention).toBe(0);
    expect(after.list.length).toBe(0);
  });

  test('a FRESH submitted (<15min) is not attention — the reconciler resolves it silently', () => {
    const fresh: PullHistoryEntry = { ...stuckSubmitted(9), submittedAt: NOW - 60_000 }; // 1 min old
    const { counts, list } = parity([fresh]);
    expect(counts.attention).toBe(0);
    expect(list.length).toBe(0);
  });

  test('a completed sent pull with server-side review tags is NOT a delivery item (tags never inflate the count)', () => {
    // Review/provenance flags live on packets/processed (server), not on the client
    // delivery model. Even if a sent history row carried them, a 'sent' pull is never
    // actionable, so the transport-attention count is unaffected.
    const withTags = { ...sent(stuckSubmitted(3)), lateEntry: true, anomaly: true, potentialDuplicate: true, needsReview: true } as unknown as PullHistoryEntry;
    const { counts, list } = parity([withTags]);
    expect(counts.attention).toBe(0);
    expect(list.length).toBe(0);
  });

  test('a genuine rejected pull STAYS visible (evidence never hidden to zero the badge)', () => {
    const rejected = { ...stuckSubmitted(4), status: 'rejected', syncStatus: 'rejected', rejectionReason: 'bad well' } as unknown as PullHistoryEntry;
    const { counts, list } = parity([rejected]);
    expect(counts.attention).toBe(1);
    expect(list.length).toBe(1);
  });
});
