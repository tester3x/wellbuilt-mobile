// Distinct edit-event identity (2026-08-26). Proves two genuinely different
// corrections to ONE original pull coexist as two durable operations with two
// distinct editEventId values — neither overwriting the other — exercised
// through the REAL submit/persist/hydrate/transport-command/receipt paths.
// All storage/network mocked; no Firebase writes; transport is NOT activated.
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
    fetch: jest.fn(async () => ({ isConnected: mockOnline.value, isInternetReachable: mockOnline.value, type: 'cellular' })),
    addEventListener: jest.fn(() => () => undefined),
  },
}));
const mockedUploadEdit = jest.fn(async () => ({ wellName: 'Gunslinger 3' })); // resolves WITHOUT a commit proof
jest.mock('../firebase', () => ({
  uploadTankPacket: jest.fn(),
  uploadEditPacket: (...a: unknown[]) => mockedUploadEdit(...(a as [])),
  mintPacketId: jest.fn(() => 'pid_mock'),
}));
jest.mock('../driverAuth', () => ({ getDriverId: jest.fn(async () => 'driver-a'), getDriverName: jest.fn(async () => 'Driver A') }));
jest.mock('../secureOperationalApi', () => ({ getFieldCommandStatus: async () => { throw new Error('no_receipt'); } }));

import {
  EditPacketParams, EditOperation, getEditOperations, processEditOperations,
  submitPullEdit, mintEditEventId,
} from '../editDelivery';
import { buildWbmEditCommand } from '../wbmEditCommand';
import { addPullToHistory, clearPullHistory, getPullHistory, setPullSyncStatus } from '../pullHistory';

const EDIT_OPS_KEY = '@wellbuilt_edit_ops';
const PID = '20260721_120600_Gunslinger3_abc123';
const editParams = (bbls: number): EditPacketParams => ({
  originalPacketTimestamp: PID.slice(0, 15), originalPacketId: PID, wellName: 'Gunslinger 3',
  dateTime: '', dateTimeUTC: '', tankLevelFeet: 11.5, bblsTaken: bbls, wellDown: false,
});
const makeFetch = (paths: Record<string, unknown>) =>
  jest.fn(async (url: string) => {
    const m = String(url).match(/firebaseio\.com\/(.+)\.json/);
    return { ok: true, json: async () => (m && m[1] in paths ? paths[m[1]] : null) } as any;
  }) as unknown as typeof fetch;
const rawOps = (): EditOperation[] => JSON.parse(mockStore[EDIT_OPS_KEY] || '[]');
const processedOriginal = { [`packets/processed/${PID}`]: { packetId: PID } };

beforeEach(async () => {
  Object.keys(mockStore).forEach((k) => delete mockStore[k]);
  mockedUploadEdit.mockReset();
  mockedUploadEdit.mockResolvedValue({ wellName: 'Gunslinger 3' });
  mockOnline.value = true;
  await clearPullHistory();
  await addPullToHistory('Gunslinger 3', '7/21/2026 12:06 PM', 11.5, 170, false, PID.slice(0, 15), PID);
  await setPullSyncStatus(PID, 'sent'); // original processed → corrections deliver
});

async function submitCorrection(bbls: number) {
  return submitPullEdit(editParams(bbls), makeFetch(processedOriginal));
}

describe('distinct edit-event identity — two corrections to one original', () => {
  it('#1/#6 one correction → one durable op + one editEventId, original id preserved', async () => {
    await submitCorrection(140);
    const ops = rawOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].editEventId).toBeTruthy();
    expect(ops[0].opId).toBe(ops[0].editEventId);
    expect(ops[0].originalPacketId).toBe(PID); // never reminted
  });

  it('#3/#4/#6 two DIFFERENT corrections → two distinct editEventIds, both stored, same original', async () => {
    await submitCorrection(140);
    await submitCorrection(155);
    const ops = rawOps();
    expect(ops).toHaveLength(2);
    expect(ops[0].editEventId).not.toBe(ops[1].editEventId);       // distinct identities
    expect(ops[0].opId).not.toBe(ops[1].opId);                     // neither overwrote the other
    expect(new Set(ops.map((o) => o.payload.bblsTaken)).size).toBe(2); // two genuinely different corrections
    expect(ops.every((o) => o.originalPacketId === PID)).toBe(true); // same original, never reminted
  });

  it('#5 each outbound command carries its OWN persisted editEventId as idempotencyKey', async () => {
    await submitCorrection(140);
    await submitCorrection(155);
    const ops = rawOps();
    // The real submit path threads each op's editEventId into uploadEditPacket.
    const sentIds = mockedUploadEdit.mock.calls.map((c: any[]) => c[0].editEventId);
    expect(sentIds).toEqual(expect.arrayContaining(ops.map((o) => o.editEventId)));
    // The command builder maps that identity to the idempotencyKey.
    const cmd = buildWbmEditCommand({ ...editParams(140), editEventId: ops[0].editEventId });
    expect(cmd.idempotencyKey).toBe(ops[0].editEventId);
  });

  it('#2 retrying one correction reuses the same op + editEventId (never a new id)', async () => {
    mockedUploadEdit.mockRejectedValueOnce(new Error('network request failed')); // transient
    await submitCorrection(140);
    const op1 = rawOps()[0];
    expect(op1.attempts).toBeGreaterThanOrEqual(1);
    const id = op1.editEventId;
    await processEditOperations(makeFetch(processedOriginal), { forceOpId: op1.opId }); // retry
    const after = rawOps();
    expect(after).toHaveLength(1);
    expect(after[0].editEventId).toBe(id);   // reused, not reminted
    expect(after[0].opId).toBe(op1.opId);
  });

  it('#9/#10 an applied receipt terminates ONLY the matching correction', async () => {
    await submitCorrection(140);
    await submitCorrection(155);
    const [opA, opB] = rawOps();
    // Receipt for A only (keyed by A's editEventId).
    await processEditOperations(makeFetch({
      ...processedOriginal,
      [`packets/processed/${opA.editEventId}`]: { committed: true, editCommitted: true, editCommittedReceiptKey: 'r-A' },
    }));
    const afterA = rawOps();
    expect(afterA).toHaveLength(1);
    expect(afterA[0].editEventId).toBe(opB.editEventId); // B survives; A's receipt did not terminate B
    // Now B's own receipt.
    await processEditOperations(makeFetch({
      ...processedOriginal,
      [`packets/processed/${opB.editEventId}`]: { committed: true, editCommitted: true, editCommittedReceiptKey: 'r-B' },
    }));
    expect(rawOps()).toHaveLength(0);
  });

  it('#8 a 404/throw transport result preserves BOTH operations (no loss)', async () => {
    mockedUploadEdit.mockRejectedValue(new Error('Callable ingestWbmEdit failed (404)'));
    await submitCorrection(140);
    await submitCorrection(155);
    const ops = rawOps();
    expect(ops).toHaveLength(2);                                   // neither lost
    expect(ops.map((o) => o.editEventId).filter(Boolean).length).toBe(2);
    expect(ops.every((o) => o.state !== 'edited')).toBe(true);     // no false success
  });

  it('#14 no operation is marked edited without a durable applied receipt', async () => {
    await submitCorrection(140);
    await submitCorrection(155);
    // uploaded (edit_submitted) but no receipt written → never 'edited'
    await processEditOperations(makeFetch(processedOriginal));
    expect(rawOps().every((o) => o.state !== 'edited')).toBe(true);
    expect((await getPullHistory())[0].status).not.toBe('edited');
  });

  it('#7 app remount preserves both identities (fresh module, same storage)', async () => {
    await submitCorrection(140);
    await submitCorrection(155);
    const before = rawOps().map((o) => o.editEventId).sort();
    jest.resetModules();
    const fresh = require('../editDelivery') as typeof import('../editDelivery');
    const ops = await fresh.getEditOperations();
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.editEventId).sort()).toEqual(before); // no remint on hydrate
    expect(ops.every((o) => o.originalPacketId === PID)).toBe(true);
  });

  it('#11/#12 legacy op hydrates without reminting and coexists with a new v2 correction', async () => {
    // Seed a legacy operation (opId = editop_<original>, NO editEventId).
    const legacy: EditOperation = {
      opId: `editop_${PID}`, originalPacketId: PID, wellName: 'Gunslinger 3',
      payload: editParams(150), state: 'edit_pending',
      createdAt: 1, updatedAt: 1, attempts: 0, lastAttemptAt: null, lastError: null,
    };
    mockStore[EDIT_OPS_KEY] = JSON.stringify([legacy]);
    const hydrated = await getEditOperations();
    expect(hydrated[0].opId).toBe(`editop_${PID}`);   // identity retained
    expect(hydrated[0].editEventId).toBeUndefined();  // not reminted
    // A later v2 correction to the SAME original coexists.
    await submitCorrection(160);
    const ops = rawOps();
    expect(ops).toHaveLength(2);
    expect(ops.some((o) => o.opId === `editop_${PID}` && !o.editEventId)).toBe(true); // legacy intact
    expect(ops.some((o) => !!o.editEventId && o.opId === o.editEventId)).toBe(true);  // v2 alongside
  });

  it('#13 rapid submissions cannot collide — mintEditEventId is unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) ids.add(mintEditEventId(PID.slice(0, 15), 'Gunslinger 3'));
    expect(ids.size).toBe(500);
    // Every id keeps the correlatable prefix + a unique component.
    for (const id of ids) expect(id).toMatch(/^edit_20260721_120600_Gunslinger3_.+/);
  });
});
