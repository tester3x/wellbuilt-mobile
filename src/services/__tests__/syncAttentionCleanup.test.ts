// Packet 83214 — WB-M Sync Status attention cleanup.
// Locks in the field-evidence fixes: the Gabriel 5 pull EDIT failing with
// unsupported_field_command:edit must be PARKED (dependency_blocked) — no Retry
// button, not counted as attention, no raw coding string — and attempts must
// never manufacture attention "tickets".
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
  buildDeliveryItems,
  computeDeliveryCounts,
  selectDeliveryItems,
} from '../deliveryStatus';
import { diagnoseThrown, formatDiagnosis } from '../connectionDiagnosis';
import { isDependencyBlockedEdit, isPermanentEditFailure, shouldAutoAttemptEdit } from '../editDelivery';

const NOW = Date.parse('2026-08-24T18:00:00.000Z');
const GAB5_EDIT_PID = '20260823_112404_Gabriel5_seexdp';

function unsupportedEditOp(over: Record<string, unknown> = {}) {
  // The parked shape editDelivery produces for an unsupported edit.
  return {
    opId: 'editop_' + GAB5_EDIT_PID,
    originalPacketId: GAB5_EDIT_PID,
    wellName: 'Gabriel 5',
    payload: { originalPacketId: GAB5_EDIT_PID, wellName: 'Gabriel 5', dateTime: '8/23/2026 11:24 AM', bblsTaken: 90 },
    state: 'edit_blocked' as const,
    blockedReason: 'Edit saved — it will send once the server supports pull edits.',
    blockedCode: 'edit_unsupported',
    createdAt: NOW - 3_600_000,
    updatedAt: NOW - 60_000,
    attempts: 6,
    lastAttemptAt: NOW - 60_000,
    lastError: 'Edit saved — it will send once the server supports pull edits.',
    ...over,
  } as any;
}

describe('packet 83214 — unsupported pull edit is parked, not a retryable ticket', () => {
  it('diagnoses unsupported_field_command(:edit) as dependency_blocked, not retryable', () => {
    for (const msg of ['unsupported_field_command:edit', 'unsupported_field_command', 'retryable [unclassified]: unsupported_field_command:edit']) {
      const d = diagnoseThrown(new Error(msg));
      expect(d.kind).toBe('dependency_blocked');
      expect(d.retryable).toBe(false);
    }
    expect(isPermanentEditFailure('unsupported_field_command:edit')).toBe(true);
    expect(isDependencyBlockedEdit('unsupported_field_command:edit')).toBe(true);
  });

  it('parks (no auto-retry loop) — both by permanent-error and by parked state', () => {
    // Before parking: the raw unsupported error halts auto-retry.
    expect(shouldAutoAttemptEdit(
      unsupportedEditOp({ state: 'edit_pending', lastError: 'unsupported_field_command:edit' }), NOW + 1e9,
    )).toBe(false);
    // After parking: state edit_blocked is never auto-attempted.
    expect(shouldAutoAttemptEdit(unsupportedEditOp(), NOW + 1e9)).toBe(false);
  });

  it('the Gabriel 5 edit is VISIBLE, PRESERVED, NOT attention, has NO retry action, and shows NO raw string', () => {
    const items = buildDeliveryItems([], [], [unsupportedEditOp()], NOW);
    const row = items.find(i => i.packetId === GAB5_EDIT_PID);
    expect(row).toBeTruthy();
    // Identity preserved (not deleted / not reminted).
    expect(row!.packetId).toBe(GAB5_EDIT_PID);
    // Parked — not a driver-attention ticket.
    expect(row!.needsAttention).toBe(false);
    // No Retry button.
    expect(row!.action).toBeNull();
    // Classified as dependency_blocked, not a retryable error.
    expect(row!.errorKind).toBe('dependency_blocked');
    // No raw coding string surfaced anywhere on the row.
    expect(JSON.stringify(row)).not.toMatch(/unsupported_field_command/);
    // The attention badge does not count it.
    const counts = computeDeliveryCounts([], [], NOW, [unsupportedEditOp()]);
    expect(counts.attention).toBe(0);
  });

  it('two logical pulls + the parked edit never produce an inflated attention count', () => {
    // Field scenario: only a stale parked edit exists; the driver made no
    // WB-M pulls today → the "needs attention" banner must be 0, not 8 or 3.
    const items = buildDeliveryItems([], [], [unsupportedEditOp()], NOW);
    expect(selectDeliveryItems(items, 'attention')).toHaveLength(0);
    // Repeated attempts on the parked edit do not change the count.
    const many = computeDeliveryCounts([], [], NOW, [unsupportedEditOp({ attempts: 99 })]);
    expect(many.attention).toBe(0);
  });

  it('formatDiagnosis of a dependency_blocked diagnosis carries no secret and a stable code', () => {
    const d = diagnoseThrown(new Error('unsupported_field_command:edit'));
    expect(formatDiagnosis(d)).toBe('dependency_blocked [edit_unsupported]');
  });
});
