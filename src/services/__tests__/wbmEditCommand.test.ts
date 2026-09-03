import {
  buildWbmEditCommand,
  commandOmitsOperationalTime,
  wbmEditIdempotencyKey,
} from '../wbmEditCommand';
import { confirmAppliedEdit } from '../editMarkers';
import {
  isPermanentEditFailure,
  processEditOperations,
  shouldAutoAttemptEdit,
  submitPullEdit,
} from '../editDelivery';
import { buildDeliveryItems, computeDeliveryCounts, selectDeliveryItems } from '../deliveryStatus';
import { diagnoseThrown } from '../connectionDiagnosis';
import { readFileSync } from 'fs';
import { join } from 'path';

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
  default: {
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true, type: 'cellular' })),
    addEventListener: jest.fn(() => () => undefined),
  },
}));

const mockedUploadEdit = jest.fn();
jest.mock('../firebase', () => ({
  uploadTankPacket: jest.fn(),
  uploadEditPacket: (...args: unknown[]) => mockedUploadEdit(...args),
  uploadEditPacketV3: (...a: unknown[]) => mockedUploadEdit(...(a as [])),
  mintPacketId: jest.fn(() => 'pid_mock'),
}));
jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => 'driver-a'),
  getDriverName: jest.fn(async () => 'Driver A'),
}));
jest.mock('../secureOperationalApi', () => ({
  getFieldCommandStatus: async () => { throw new Error('no_receipt'); },
}));

import { addPullToHistory, clearPullHistory, setPullSyncStatus } from '../pullHistory';

const PID = '20260823_112300_Gabriel2_abc123';
const EDIT_OPS_KEY = '@wellbuilt_edit_ops';
const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

const editParams = (bbls = 140) => ({
  originalPacketTimestamp: PID.slice(0, 15),
  originalPacketId: PID,
  wellName: 'Gabriel 2',
  dateTime: '',
  dateTimeUTC: '',
  tankLevelFeet: 10.5,
  bblsTaken: bbls,
  wellDown: false,
});

const makeFetch = (paths: Record<string, unknown>) =>
  jest.fn(async (url: string) => {
    const m = String(url).match(/firebaseio\.com\/(.+)\.json/);
    return { ok: true, json: async () => (m && m[1] in paths ? paths[m[1]] : null) } as any;
  }) as unknown as typeof fetch;

beforeEach(async () => {
  Object.keys(mockStore).forEach((k) => delete mockStore[k]);
  mockedUploadEdit.mockReset();
  await clearPullHistory();
  await addPullToHistory('Gabriel 2', '8/23/2026 11:23 AM', 10.5, 160, false, PID.slice(0, 15), PID);
  await setPullSyncStatus(PID, 'sent');
});

describe('edit command packet', () => {
  const EVID = 'editevt_00000000-0000-4000-8000-000000000001';

  const CORR = '2026-08-23T16:45:00.000Z';

  it('emits the governed v2 contract with an explicit editedFields mask + wellDown', () => {
    const cmd = buildWbmEditCommand({ ...editParams(), editEventId: EVID, correctionCreatedAtUTC: CORR });
    expect(Object.keys(cmd).sort()).toEqual([
      'bblsTaken', 'correctionCreatedAtUTC', 'editEventId', 'editedFields', 'idempotencyKey',
      'originalPacketId', 'packetId', 'requestType', 'schemaVersion', 'tankLevelFeet', 'wellDown', 'wellName',
    ]);
    expect(cmd.requestType).toBe('edit');
    expect(cmd.schemaVersion).toBe(2);
    expect(cmd.editEventId).toBe(EVID);
    expect(cmd.idempotencyKey).toBe(EVID);       // idempotencyKey === editEventId (per-correction)
    expect(cmd.correctionCreatedAtUTC).toBe(CORR);
    // The Well Down control is an explicit final-state assertion → always in the mask.
    expect(cmd.editedFields).toEqual(['tankLevelFeet', 'bblsTaken', 'wellDown']);
    expect(cmd.wellDown).toBe(false);            // explicit final-state boolean, never omitted
    expect(cmd.idempotencyKey).not.toBe(wbmEditIdempotencyKey(PID.slice(0, 15), 'Gabriel 2'));
  });

  it('wellDown is asserted explicitly for BOTH true and false (Thor 1: bring-online must be sendable)', () => {
    const online = buildWbmEditCommand({ ...editParams(), wellDown: false, editEventId: EVID, correctionCreatedAtUTC: CORR });
    expect(online.wellDown).toBe(false);
    expect(online.editedFields).toContain('wellDown');
    const down = buildWbmEditCommand({ ...editParams(), wellDown: true, editEventId: EVID, correctionCreatedAtUTC: CORR });
    expect(down.wellDown).toBe(true);
    expect(down.editedFields).toContain('wellDown');
  });

  it('operational time is declared in the mask only when the user set it', () => {
    const omitted = buildWbmEditCommand({ ...editParams(), editEventId: EVID, correctionCreatedAtUTC: CORR });
    expect(commandOmitsOperationalTime(omitted)).toBe(true);
    expect(omitted.editedFields).not.toContain('dateTimeUTC');
    const timed = buildWbmEditCommand({ ...editParams(), editEventId: EVID, correctionCreatedAtUTC: CORR, dateTimeUTC: '2026-08-23T16:40:00.000Z', dateTime: '8/23/2026 11:40 AM' });
    expect(timed.dateTimeUTC).toBe('2026-08-23T16:40:00.000Z');
    expect(timed.editedFields).toEqual(['tankLevelFeet', 'bblsTaken', 'wellDown', 'dateTimeUTC', 'dateTime']);
  });

  it('fails closed for a missing / malformed / colliding editEventId and a missing correction time', () => {
    expect(() => buildWbmEditCommand({ ...editParams(), correctionCreatedAtUTC: CORR })).toThrow('edit_event_id_required');
    expect(() => buildWbmEditCommand({ ...editParams(), editEventId: 'short', correctionCreatedAtUTC: CORR })).toThrow('edit_event_id_required');
    expect(() => buildWbmEditCommand({ ...editParams(), editEventId: 'has/slash/unsafe', correctionCreatedAtUTC: CORR })).toThrow('edit_event_id_required');
    expect(() => buildWbmEditCommand({ ...editParams(), editEventId: PID, correctionCreatedAtUTC: CORR })).toThrow('edit_event_id_collides_with_original');
    expect(() => buildWbmEditCommand({ ...editParams(), editEventId: EVID })).toThrow('correction_created_at_required');
    expect(() => buildWbmEditCommand({ ...editParams(), editEventId: EVID, correctionCreatedAtUTC: 'not-a-date' })).toThrow('correction_created_at_required');
  });
});

describe('governed edit delivery', () => {
  it('valid edit applies exactly once and same key retries do not re-upload after queue', async () => {
    mockedUploadEdit.mockResolvedValue({ queued: true, committed: false, wellName: 'Gabriel 2' });
    const processed = { [`packets/processed/${PID}`]: { packetId: PID, wellName: 'Gabriel 2' } };
    await submitPullEdit(editParams(), makeFetch(processed));
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockStore[EDIT_OPS_KEY])[0].state).toBe('edit_submitted');
    await processEditOperations(makeFetch(processed));
    await processEditOperations(makeFetch(processed));
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);
  });

  it('one force retry increments attempts by exactly one', async () => {
    mockedUploadEdit.mockRejectedValue(new Error('tower down'));
    const processed = { [`packets/processed/${PID}`]: { packetId: PID } };
    await submitPullEdit(editParams(), makeFetch(processed));
    expect(JSON.parse(mockStore[EDIT_OPS_KEY])[0].attempts).toBe(1);
    const opId = JSON.parse(mockStore[EDIT_OPS_KEY])[0].opId;
    await processEditOperations(makeFetch(processed), { forceOpId: opId });
    expect(JSON.parse(mockStore[EDIT_OPS_KEY])[0].attempts).toBe(2);
    await processEditOperations(makeFetch(processed), { forceOpId: opId });
    expect(JSON.parse(mockStore[EDIT_OPS_KEY])[0].attempts).toBe(3);
  });

  it('one automatic retry tick increments attempts by exactly one', async () => {
    mockedUploadEdit.mockRejectedValue(new Error('tower down'));
    const processed = { [`packets/processed/${PID}`]: { packetId: PID } };
    await submitPullEdit(editParams(), makeFetch(processed));
    const t0 = JSON.parse(mockStore[EDIT_OPS_KEY])[0].lastAttemptAt;
    await processEditOperations(makeFetch(processed), { nowMs: t0 + 60_000 });
    expect(JSON.parse(mockStore[EDIT_OPS_KEY])[0].attempts).toBe(2);
  });

  it('explicit retry followed by reload does not cause a second attempt', async () => {
    mockedUploadEdit.mockRejectedValue(new Error('tower down'));
    const processed = { [`packets/processed/${PID}`]: { packetId: PID } };
    await submitPullEdit(editParams(), makeFetch(processed));
    const opId = JSON.parse(mockStore[EDIT_OPS_KEY])[0].opId;
    await processEditOperations(makeFetch(processed), { forceOpId: opId });
    expect(JSON.parse(mockStore[EDIT_OPS_KEY])[0].attempts).toBe(2);
    await processEditOperations(makeFetch(processed));
    expect(JSON.parse(mockStore[EDIT_OPS_KEY])[0].attempts).toBe(2);
  });

  it('foreground overlap joins one in-flight pass', async () => {
    let release: () => void = () => undefined;
    mockedUploadEdit.mockImplementation(() => new Promise((resolve, reject) => {
      release = () => reject(new Error('tower down'));
    }));
    const processed = { [`packets/processed/${PID}`]: { packetId: PID } };
    const first = submitPullEdit(editParams(), makeFetch(processed));
    await new Promise((r) => setTimeout(r, 10));
    const second = processEditOperations(makeFetch(processed));
    release();
    await first.catch(() => undefined);
    await second.catch(() => undefined);
    expect(JSON.parse(mockStore[EDIT_OPS_KEY])[0].attempts).toBe(1);
  });

  it('failed retry retains operational timestamp; only lastAttemptAt advances', async () => {
    mockedUploadEdit.mockRejectedValue(new Error('tower down'));
    const processed = { [`packets/processed/${PID}`]: { packetId: PID } };
    await submitPullEdit(editParams(), makeFetch(processed));
    const first = JSON.parse(mockStore[EDIT_OPS_KEY])[0];
    expect(first.payload.dateTimeUTC).toBe('');
    expect(first.payload.dateTime).toBe('');
    const t0 = first.lastAttemptAt;
    await processEditOperations(makeFetch(processed), { forceOpId: first.opId, nowMs: t0 + 5 });
    const second = JSON.parse(mockStore[EDIT_OPS_KEY])[0];
    expect(second.payload.dateTimeUTC).toBe('');
    expect(second.lastAttemptAt).toBeGreaterThan(t0);
  });

  it('confirmAppliedEdit requires matching values after createdAt, not legacy markers alone', () => {
    const op = { payload: { tankLevelFeet: 10.5, bblsTaken: 140, wellDown: false }, createdAt: 1000 };
    expect(confirmAppliedEdit({ editedAt: '2026-08-23T16:00:00.000Z', wasEdited: true }, op)).toBe(false);
    expect(confirmAppliedEdit({
      tankLevelFeet: 10.5,
      bblsTaken: 140,
      editedAt: 2000,
    }, op)).toBe(true);
    expect(confirmAppliedEdit({ queued: true, committed: false }, op)).toBe(false);
  });

  it('unsupported pull edit is a PARKED dependency, not a retryable error (packet 83214, Blocker 4)', () => {
    // The endpoint does not support edits, so retrying can never succeed — it is
    // classified dependency_blocked (not retryable), stops auto-retrying (parks),
    // and never shows the driver a retryable error.
    expect(isPermanentEditFailure('retryable [unclassified]: unsupported_field_command:edit')).toBe(true);
    const d = diagnoseThrown(new Error('unsupported_field_command:edit'));
    expect(d.retryable).toBe(false);
    expect(d.kind).toBe('dependency_blocked');
    const op = {
      opId: 'editop_x',
      originalPacketId: PID,
      wellName: 'Gabriel 2',
      payload: editParams(),
      state: 'edit_pending' as const,
      createdAt: 1,
      updatedAt: 1,
      attempts: 3,
      lastAttemptAt: 1,
      lastError: 'unsupported_field_command:edit',
    };
    expect(shouldAutoAttemptEdit(op, 100_000)).toBe(false); // parked — no auto-retry loop
  });
});

describe('attention snapshot parity', () => {
  const SUBMITTED_MS = 16 * 60 * 1000;
  it('badge count equals visible actionable rows for the same snapshot', () => {
    const NOW = Date.parse('2026-08-23T16:00:00.000Z');
    const op = {
      opId: 'editop_' + PID,
      originalPacketId: PID,
      wellName: 'Gabriel 2',
      payload: editParams(),
      state: 'edit_pending' as const,
      createdAt: NOW - 60_000,
      updatedAt: NOW - 1000,
      attempts: 5,
      lastAttemptAt: NOW - 1000,
      lastError: 'retryable [edit_capability_upgraded]',
    };
    const history = [{
      id: 'h1',
      packetId: 'other',
      packetTimestamp: '20260823_100000',
      wellName: 'Thor 1',
      dateTime: '8/23/2026 10:00 AM',
      tankLevelFeet: 6,
      bblsTaken: 80,
      wellDown: false,
      sentAt: NOW - SUBMITTED_MS,
      status: 'sent',
      syncStatus: 'submitted',
      submittedAt: NOW - SUBMITTED_MS,
    } as any];
    const items = buildDeliveryItems([], history, [op], NOW);
    const attention = selectDeliveryItems(items, 'attention');
    const counts = computeDeliveryCounts([], history, NOW, [op]);
    // Parity invariant preserved: badge count === visible attention rows.
    expect(counts.attention).toBe(attention.length);
    // Blocker 3: the transport-failing edit (attempts past threshold) is
    // background_pending — NOT attention. Only the stuck submission remains.
    expect(attention.map((i) => `${i.type}:${i.packetId}`).sort()).toEqual(['pull:other']);
    // The edit is still VISIBLE in the full list — just not counted/flagged.
    expect(items.some((i) => i.type === 'edit' && i.packetId === PID)).toBe(true);
  });
});

describe('wiring', () => {
  it('Retry edit does not process edits again via load(true)', () => {
    const screen = src('app/sync-status.tsx');
    expect(screen).toMatch(/forceOpId: item\.opId/);
    expect(screen).toMatch(/await load\(false, false\)/);
    expect(screen).toMatch(/Pull time|syncStatus\.pullTime/);
    expect(screen).toMatch(/Last retry|syncStatus\.lastRetry/);
    expect(src('src/services/firebase.ts')).toMatch(/buildWbmEditCommand/);
    expect(src('src/services/secureOperationalApi.ts')).toMatch(/ingestWbmEdit/);
  });
});
