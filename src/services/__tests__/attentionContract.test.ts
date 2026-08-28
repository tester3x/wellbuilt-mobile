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

import {
  SUBMITTED_ATTENTION_MS,
  buildDeliveryItems,
  computeDeliveryCounts,
  selectDeliveryItems,
} from '../deliveryStatus';
import { SYNC_FAILED_THRESHOLD } from '../packetQueue';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const NOW = Date.parse('2026-08-22T16:00:00.000Z');
const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

function queued(over: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    type: 'pull' as const,
    packetId: 'pid_q',
    createdAt: NOW - 60_000,
    retryCount: 0,
    data: { wellName: 'Thor 1', dateTime: '8/22/2026 9:30 AM', bblsTaken: 80 },
    ...over,
  } as any;
}

function hist(over: Record<string, unknown> = {}) {
  return {
    id: 'h1',
    packetId: 'pid_h',
    packetTimestamp: '20260822_093000',
    wellName: 'Thor 1',
    dateTime: '8/22/2026 9:30 AM',
    tankLevelFeet: 6,
    bblsTaken: 80,
    wellDown: true,
    sentAt: NOW - 60_000,
    status: 'sent' as const,
    syncStatus: 'sent' as const,
    ...over,
  } as any;
}

describe('attention-state contract', () => {
  it('reports the existing submitted-attention threshold (15 minutes)', () => {
    expect(SUBMITTED_ATTENTION_MS).toBe(15 * 60 * 1000);
  });

  it('delivered / pending items do not create attention', () => {
    const counts = computeDeliveryCounts(
      [queued({ retryCount: 2 })],
      [hist({ syncStatus: 'sent' }), hist({ packetId: 'sub', syncStatus: 'submitted', submittedAt: NOW - 60_000 })],
      NOW,
      [],
    );
    expect(counts.attention).toBe(0);
    expect(counts.pending).toBe(1);
  });

  it('a queued transport failure at the threshold is background_pending, NOT attention (Blocker 3)', () => {
    // Field bug: reaching the retry threshold manufactured a "needs attention"
    // ticket. Attempts are diagnostic only — the system keeps retrying silently.
    const fail = queued({ retryCount: SYNC_FAILED_THRESHOLD, packetId: 'pid_fail', id: 'qf' });
    const items = buildDeliveryItems([fail], [hist({ syncStatus: 'sent' })], [], NOW);
    expect(selectDeliveryItems(items, 'attention')).toHaveLength(0);
    expect(computeDeliveryCounts([fail], [hist({ syncStatus: 'sent' })], NOW, []).attention).toBe(0);
  });

  it('one genuine problem (server-rejected pull) produces one badge and one visible row', () => {
    const rej = hist({ packetId: 'pid_rej', syncStatus: 'rejected', rejectionReason: 'quarantined' });
    const items = buildDeliveryItems([], [rej], [], NOW);
    const attention = selectDeliveryItems(items, 'attention');
    const counts = computeDeliveryCounts([], [rej], NOW, []);
    expect(counts.attention).toBe(1);
    expect(attention).toHaveLength(1);
    expect(attention[0].packetId).toBe('pid_rej');
  });

  it('clearing the problem removes the badge and the row together', () => {
    const rej = hist({ packetId: 'pid_rej', syncStatus: 'rejected', rejectionReason: 'q' });
    const before = computeDeliveryCounts([], [rej], NOW, []);
    expect(before.attention).toBe(1);
    const after = computeDeliveryCounts([], [hist({ syncStatus: 'sent' })], NOW, []);
    const rows = selectDeliveryItems(buildDeliveryItems([], [hist({ syncStatus: 'sent' })], [], NOW), 'attention');
    expect(after.attention).toBe(0);
    expect(rows).toHaveLength(0);
  });

  it('explains why four submitted rows older than 15 minutes previously qualified', () => {
    const four = [1, 2, 3, 4].map((n) => hist({
      id: `h${n}`,
      packetId: `pid_${n}`,
      wellName: `Well ${n}`,
      syncStatus: 'submitted',
      submittedAt: NOW - SUBMITTED_ATTENTION_MS - 1000,
    }));
    const counts = computeDeliveryCounts([], four, NOW, []);
    expect(counts.attention).toBe(4);
    expect(selectDeliveryItems(buildDeliveryItems([], four, [], NOW), 'attention')).toHaveLength(4);
  });
});

// The 'attention wiring' block (badge onPress/reconcile source-assertions) was
// removed with the tappable packet-status banner. The underlying delivery-count
// contract above (computeDeliveryCounts / selectDeliveryItems parity) is retained.
describe('packet-status tap banner is removed from the UI', () => {
  it('no SyncAttentionBadge component file exists', () => {
    expect(existsSync(join(__dirname, '../../components/SyncAttentionBadge.tsx'))).toBe(false);
  });
  it('the root layout neither imports nor renders a packet-status banner', () => {
    const layout = src('app/_layout.tsx');
    expect(layout).not.toMatch(/SyncAttentionBadge/);
  });
  it('the delivered-success toast is not shown', () => {
    expect(src('src/components/SyncToast.tsx')).not.toMatch(/title: 'Delivered'/);
  });
});
