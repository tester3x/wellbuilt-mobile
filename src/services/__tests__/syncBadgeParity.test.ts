// Badge ↔ Sync Status parity (field bug): wells showed a red
// "3 need attention" badge while Sync Status said "All pulls are
// confirmed synced. Nothing needs attention." One canonical actionable
// selector must power BOTH surfaces: the badge count equals exactly the
// attention rows the screen shows, zero hides the badge, and completed
// history (sent pulls, successfully 'edited' operations — even ones that
// crossed the transport-failure threshold before succeeding) is never
// counted. Pure derivations — deterministic across refresh/reconnect/
// restart because they read only the persisted stores.

const mockStore: Record<string, string> = {};
const mockOnline = { value: true };

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
  default: {
    fetch: jest.fn(async () => ({
      isConnected: mockOnline.value,
      isInternetReachable: mockOnline.value,
      type: 'cellular',
    })),
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
  getDeliveryCounts,
  getDeliveryItems,
} from '../deliveryStatus';
import { EDIT_FAILED_THRESHOLD, EditOperation } from '../editDelivery';
import { QueuedPacket, SYNC_FAILED_THRESHOLD } from '../packetQueue';
import { PullHistoryEntry } from '../pullHistory';

const NOW = 1_769_200_000_000;

function queued(over: Partial<QueuedPacket> = {}): QueuedPacket {
  return {
    id: `q_${Math.random().toString(36).slice(2, 8)}`,
    type: 'pull',
    data: { wellName: 'Atlas 2-19', dateTime: '7/23/2026 6:10 AM', bblsTaken: 120 },
    createdAt: NOW - 60_000,
    retryCount: 0,
    packetId: `pid_${Math.random().toString(36).slice(2, 8)}`,
    lastAttemptAt: NOW - 30_000,
    ...over,
  };
}

function historyEntry(over: Partial<PullHistoryEntry> = {}): PullHistoryEntry {
  const pid = over.packetId ?? `pid_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: pid,
    wellName: 'Gunslinger 3',
    dateTime: '7/23/2026 5:40 AM',
    tankLevelFeet: 12.4,
    bblsTaken: 140,
    wellDown: false,
    sentAt: NOW - 60 * 60 * 1000,
    packetTimestamp: '20260723_054000',
    packetId: pid,
    status: 'sent',
    syncStatus: 'sent',
    ...over,
  } as PullHistoryEntry;
}

function editOp(over: Partial<EditOperation> = {}): EditOperation {
  return {
    opId: `edit_${Math.random().toString(36).slice(2, 8)}`,
    originalPacketId: `pid_${Math.random().toString(36).slice(2, 8)}`,
    wellName: 'Maverick 1',
    payload: { dateTime: '7/23/2026 4:15 AM', bblsTaken: 95 } as EditOperation['payload'],
    state: 'edited',
    createdAt: NOW - 2 * 60 * 60 * 1000,
    updatedAt: NOW - 60 * 60 * 1000,
    attempts: 0,
    lastError: null,
    ...over,
  };
}

/** THE invariant: one canonical selector powers both surfaces. */
function assertParity(
  queue: QueuedPacket[],
  history: PullHistoryEntry[],
  editOps: EditOperation[],
) {
  const counts = computeDeliveryCounts(queue, history, NOW, editOps);
  const items = buildDeliveryItems(queue, history, editOps, NOW);
  const attentionRows = items.filter(i => i.needsAttention);
  expect(counts.attention).toBe(attentionRows.length);
  return { counts, items, attentionRows };
}

describe('badge ↔ Sync Status parity', () => {
  test('1. no actionable records → zero badge and a clean status list', () => {
    const { counts, items } = assertParity(
      [],
      [historyEntry(), historyEntry({ status: 'edited', syncStatus: 'sent' })],
      [editOp(), editOp({ attempts: 2 })],
    );
    expect(counts.attention).toBe(0);
    expect(counts.pending).toBe(0); // badge fully hidden
    expect(items).toHaveLength(0); // "Nothing needs attention" is truthful
  });

  test('2. three actionable records → badge 3 and exactly those three visible rows', () => {
    const stuck = historyEntry({
      syncStatus: 'submitted',
      submittedAt: NOW - SUBMITTED_ATTENTION_MS - 60_000,
      wellName: 'Well A',
    });
    const rejected = historyEntry({ syncStatus: 'rejected', rejectionReason: 'DUPLICATE_PACKET: already processed', wellName: 'Well B' });
    const failing = queued({ retryCount: SYNC_FAILED_THRESHOLD, data: { wellName: 'Well C', dateTime: 'x', bblsTaken: 1 } });
    const { counts, attentionRows } = assertParity([failing], [stuck, rejected], []);
    expect(counts.attention).toBe(3);
    expect(attentionRows.map(r => r.wellName).sort()).toEqual(['Well A', 'Well B', 'Well C']);
    // …and each row says WHY it needs attention.
    for (const row of attentionRows) expect(row.lastError ?? row.status).toBeTruthy();
  });

  test('3. successful reconciliation clears the badge (sent pulls stop being actionable)', () => {
    const before = assertParity(
      [],
      [historyEntry({ syncStatus: 'submitted', submittedAt: NOW - SUBMITTED_ATTENTION_MS - 1 })],
      [],
    );
    expect(before.counts.attention).toBe(1);
    const after = assertParity(
      [],
      [historyEntry({ syncStatus: 'sent', sentConfirmedAt: NOW - 1000 })],
      [],
    );
    expect(after.counts.attention).toBe(0);
    expect(after.items).toHaveLength(0);
  });

  test('4./5. recomputation is deterministic — reconnects and restarts cannot resurrect cleared warnings', async () => {
    const queue: QueuedPacket[] = [];
    const history = [historyEntry({ syncStatus: 'sent' })];
    const ops = [editOp({ attempts: EDIT_FAILED_THRESHOLD + 3 })]; // healed after a rough patch
    const a = computeDeliveryCounts(queue, history, NOW, ops);
    const b = computeDeliveryCounts(queue, history, NOW + 5 * 60_000, ops); // later, post-reconnect
    expect(a).toEqual(b);
    expect(a.attention).toBe(0);

    // Restart path: derive through the persisted stores (mocked storage is
    // empty → same derivation, zero state) — no cached badge count exists.
    const restartCounts = await getDeliveryCounts(NOW);
    const restartItems = await getDeliveryItems(NOW);
    expect(restartCounts.attention).toBe(restartItems.filter(i => i.needsAttention).length);
  });

  test('6. hidden/non-actionable history is never counted — THE field bug', () => {
    // An edit that failed transport past the threshold and then SUCCEEDED:
    // state 'edited', attempts frozen above EDIT_FAILED_THRESHOLD. The old
    // badge counted these forever while Sync Status (rightly) hid them —
    // "3 need attention" over an empty list, one ghost per edited well.
    const ghosts = [
      editOp({ state: 'edited', attempts: EDIT_FAILED_THRESHOLD, wellName: 'Well 1' }),
      editOp({ state: 'edited', attempts: EDIT_FAILED_THRESHOLD + 2, wellName: 'Well 2' }),
      editOp({ state: 'edited', attempts: EDIT_FAILED_THRESHOLD + 7, wellName: 'Well 3' }),
    ];
    const { counts, items } = assertParity([], [historyEntry()], ghosts);
    expect(items).toHaveLength(0); // the list is right…
    expect(counts.attention).toBe(0); // …and the badge must agree
  });

  test('a queued packet that is also rejected in history is one row, counted once', () => {
    const pid = 'pid_shared_1';
    const q = queued({ packetId: pid, retryCount: SYNC_FAILED_THRESHOLD });
    const h = historyEntry({ packetId: pid, syncStatus: 'rejected', rejectionReason: 'STALE' });
    const { counts, attentionRows } = assertParity([q], [h], []);
    expect(attentionRows).toHaveLength(1); // the live queue row wins
    expect(counts.attention).toBe(1); // never double-counted
  });

  test('still-failing edits and blocked/rejected edits remain visible AND counted', () => {
    const ops = [
      editOp({ state: 'edit_pending', attempts: EDIT_FAILED_THRESHOLD }), // transport-failing
      editOp({ state: 'edit_blocked', blockedReason: 'original rejected' }),
      editOp({ state: 'edit_rejected', rejectionReason: 'REJECTED: bad time' }),
      editOp({ state: 'edit_pending', attempts: 1 }), // normal dependent wait — NOT attention
    ];
    const { counts, attentionRows, items } = assertParity([], [], ops);
    expect(counts.attention).toBe(3);
    expect(attentionRows).toHaveLength(3);
    expect(items).toHaveLength(4); // the pending edit is visible but not flagged
  });
});
