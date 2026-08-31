// Governed WB-M pull-edit client recovery (2026-08-26). Exercises the REAL
// submit/persist/serialize/retry/receipt paths of editDelivery — no hand-built
// mirror. Storage + network are mocked; the authenticated transport is mocked
// at the uploadEditPacket boundary. expo-crypto is auto-mocked (src/__mocks__)
// with deterministic, distinct V4-shaped UUIDs.
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
// Transport stub: resolves WITHOUT a commit proof by default (→ edit_submitted,
// never 'edited'), so a pending callable response is never treated as applied.
const mockedUploadEdit = jest.fn(async (..._args: any[]): Promise<any> => ({ wellName: 'Gunslinger 3' }));
jest.mock('../firebase', () => ({
  uploadTankPacket: jest.fn(),
  uploadEditPacket: (...a: unknown[]) => mockedUploadEdit(...(a as [])),
  mintPacketId: jest.fn(() => 'pid_mock'),
}));
jest.mock('../driverAuth', () => ({ getDriverId: jest.fn(async () => 'driver-a'), getDriverName: jest.fn(async () => 'Driver A') }));
jest.mock('../secureOperationalApi', () => ({ getFieldCommandStatus: async () => { throw new Error('no_receipt'); } }));

import * as Crypto from 'expo-crypto';
import {
  EditPacketParams, EditOperation, getEditOperations, processEditOperations,
  submitPullEdit, mintEditEventId,
} from '../editDelivery';
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
const sentUploadIds = () => mockedUploadEdit.mock.calls.map((c: any[]) => c[0].editEventId);

beforeEach(async () => {
  Object.keys(mockStore).forEach((k) => delete mockStore[k]);
  mockedUploadEdit.mockReset();
  mockedUploadEdit.mockResolvedValue({ wellName: 'Gunslinger 3' });
  mockOnline.value = true;
  await clearPullHistory();
  await addPullToHistory('Gunslinger 3', '7/21/2026 12:06 PM', 11.5, 170, false, PID.slice(0, 15), PID);
  await setPullSyncStatus(PID, 'sent'); // original processed → corrections deliver
});

async function submit(bbls: number) {
  return submitPullEdit(editParams(bbls), makeFetch(processedOriginal));
}

describe('WB-M governed edit client — identity, durability, serialization', () => {
  it('mints a crypto UUID editEventId, persists it BEFORE transport, distinct from a local opId', async () => {
    let persistedAtTransport: EditOperation | undefined;
    mockedUploadEdit.mockImplementationOnce(async (arg: any) => {
      // At the moment of transport, the op + its editEventId are already durable.
      persistedAtTransport = rawOps().find((o) => o.editEventId === arg.editEventId);
      throw new Error('network request failed'); // transient — stays pending
    });
    await submit(140);
    const op = rawOps()[0];
    expect(op.editEventId).toMatch(/^editevt_[0-9a-f-]{36}$/); // crypto V4-shaped, no Math.random
    expect(op.opId).toMatch(/^editop_[0-9a-f-]{36}$/);         // full-entropy local identity
    expect(op.opId).not.toBe(op.editEventId);                  // never the packet identity
    expect(op.originalPacketId).toBe(PID);                     // canonical original retained
    expect(persistedAtTransport?.editEventId).toBe(op.editEventId); // persisted before transport
  });

  it('a retry reuses the same persisted editEventId (never a new id)', async () => {
    mockedUploadEdit.mockRejectedValueOnce(new Error('network request failed'));
    await submit(140);
    const op1 = rawOps()[0];
    const id = op1.editEventId;
    await processEditOperations(makeFetch(processedOriginal), { forceOpId: op1.opId }); // retry
    const after = rawOps();
    expect(after).toHaveLength(1);
    expect(after[0].editEventId).toBe(id);   // reused, not reminted
    expect(after[0].opId).toBe(op1.opId);
  });

  it('two corrections to one original are two durable operations with distinct identities', async () => {
    await submit(140);
    await submit(155);
    const ops = rawOps();
    expect(ops).toHaveLength(2);
    expect(ops[0].originalPacketId).toBe(PID);
    expect(ops[1].originalPacketId).toBe(PID);
    expect(ops[0].editEventId).not.toBe(ops[1].editEventId);
    expect(ops[0].opId).not.toBe(ops[1].opId);
    expect(new Set(ops.map((o) => o.payload.bblsTaken)).size).toBe(2);
  });

  it('same-original corrections are transported SERIALLY in creation order (B waits for A)', async () => {
    await submit(140); // A uploads (edit_submitted, no commit proof)
    await submit(155); // B held — A still in flight
    const [a, b] = rawOps().sort((x, y) => x.createdAt - y.createdAt || (x.opId < y.opId ? -1 : 1));
    expect(a.state).toBe('edit_submitted');
    expect(b.state).toBe('edit_pending');
    // Only A was ever sent, and its literal editEventId reached the transport.
    expect(sentUploadIds()).toEqual([a.editEventId]);
  });

  it('a transient failure blocks the later same-original correction without deleting either', async () => {
    mockedUploadEdit.mockRejectedValue(new Error('network request failed')); // A never lands
    await submit(140);
    await submit(155);
    await processEditOperations(makeFetch(processedOriginal));
    const ops = rawOps();
    expect(ops).toHaveLength(2);                       // neither deleted
    const [a, b] = ops.sort((x, y) => x.createdAt - y.createdAt || (x.opId < y.opId ? -1 : 1));
    expect(a.state).toBe('edit_pending');              // A still trying
    expect(b.state).toBe('edit_pending');              // B still waiting behind A
    expect(sentUploadIds().every((id: string) => id === a.editEventId)).toBe(true); // B never sent
  });

  it('a terminal rejection PARKS A (evidence kept) and lets the next correction proceed', async () => {
    await submit(140); // A → edit_submitted
    await submit(155); // B → edit_pending (held)
    const [a, b] = rawOps().sort((x, y) => x.createdAt - y.createdAt || (x.opId < y.opId ? -1 : 1));
    // A is terminally rejected by the server; then the queue may advance to B.
    await processEditOperations(makeFetch({
      ...processedOriginal,
      [`packets/rejected/${a.editEventId}`]: { reason: 'forged_well', readableReason: 'well mismatch' },
    }));
    const afterA = rawOps().find((o) => o.opId === a.opId)!;
    expect(afterA.state).toBe('edit_rejected');            // parked
    expect(afterA.rejectionReason).toContain('forged_well'); // evidence preserved
    // B is no longer blocked by A (A is terminal) → it delivers.
    await processEditOperations(makeFetch(processedOriginal));
    const afterB = rawOps().find((o) => o.opId === b.opId)!;
    expect(afterB.state).toBe('edit_submitted');
    expect(sentUploadIds()).toContain(b.editEventId);
    expect(rawOps().find((o) => o.opId === a.opId)!.state).toBe('edit_rejected'); // A never resurrected
  });

  it('an applied receipt for A can NEVER complete B (receipts correlate by literal editEventId)', async () => {
    // Seed two independent edit_submitted operations (bypassing serialization for
    // the setup) so we can prove receipt correlation is per-editEventId.
    const now = Date.now();
    const mk = (evid: string, opid: string, bbls: number): EditOperation => ({
      opId: opid, editEventId: evid, originalPacketId: PID, wellName: 'Gunslinger 3',
      payload: editParams(bbls), state: 'edit_submitted',
      createdAt: now, updatedAt: now, attempts: 1, lastAttemptAt: now, lastError: null,
    });
    const A = mk('editevt_aaaaaaaa-0000-4000-8000-000000000001', 'editop_A', 140);
    const B = mk('editevt_bbbbbbbb-0000-4000-8000-000000000002', 'editop_B', 155);
    mockStore[EDIT_OPS_KEY] = JSON.stringify([A, B]);
    // Only A's receipt exists (keyed by A's editEventId).
    await processEditOperations(makeFetch({
      ...processedOriginal,
      [`packets/processed/${A.editEventId}`]: { committed: true, editCommitted: true, editCommittedReceiptKey: 'r-A' },
    }));
    const ops = rawOps();
    expect(ops.find((o) => o.opId === 'editop_A')).toBeUndefined(); // A confirmed + removed
    const bAfter = ops.find((o) => o.opId === 'editop_B')!;
    expect(bAfter).toBeTruthy();                 // B survives — A's receipt did NOT complete it
    expect(bAfter.state).not.toBe('edited');
  });

  it('a pending callable response is not treated as applied', async () => {
    mockedUploadEdit.mockResolvedValue({ queued: true, committed: false, wellName: 'Gunslinger 3' });
    await submit(140);
    expect(rawOps()[0].state).toBe('edit_submitted');           // uploaded, awaiting proof
    expect(rawOps()[0].state).not.toBe('edited');
    expect((await getPullHistory())[0].status).not.toBe('edited');
  });

  it('app remount preserves both identities (fresh module, same storage)', async () => {
    await submit(140);
    await submit(155);
    const before = rawOps().map((o) => ({ opId: o.opId, editEventId: o.editEventId })).sort((x, y) => (x.opId < y.opId ? -1 : 1));
    jest.resetModules();
    const fresh = require('../editDelivery') as typeof import('../editDelivery');
    const ops = (await fresh.getEditOperations())
      .map((o) => ({ opId: o.opId, editEventId: o.editEventId }))
      .sort((x, y) => (x.opId < y.opId ? -1 : 1));
    expect(ops).toEqual(before); // no remint on hydrate
  });

  it('regression: full-entropy opId — two UUIDs sharing the first 8 chars still yield two distinct ops', async () => {
    // Every minted UUID shares the first segment ('deadbeef') but has a unique
    // tail. Under the old slice(0,8) opId this collapsed both corrections into
    // one record; with a full-entropy opId they remain two distinct operations.
    let n = 0;
    const spy = jest.spyOn(Crypto, 'randomUUID').mockImplementation(() => {
      n += 1;
      return `deadbeef-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    });
    try {
      await submit(140);
      await submit(155);
    } finally {
      spy.mockRestore();
    }
    const ops = rawOps();
    expect(ops).toHaveLength(2);                                  // NO collision
    expect(ops[0].opId.startsWith('editop_deadbeef')).toBe(true); // shared leading chars
    expect(ops[1].opId.startsWith('editop_deadbeef')).toBe(true);
    expect(ops[0].opId).not.toBe(ops[1].opId);                   // yet distinct (full entropy)
    expect(ops[0].editEventId).not.toBe(ops[1].editEventId);
    expect(ops.every((o) => o.originalPacketId === PID)).toBe(true);
  });

  it('only a durable governed receipt marks an edit applied — incoming/processed presence does not', async () => {
    const now = Date.now();
    const op: EditOperation = {
      opId: 'editop_deadbeef-0000-4000-8000-000000000001',
      editEventId: 'editevt_deadbeef-0000-4000-8000-000000000002',
      originalPacketId: PID, wellName: 'Gunslinger 3',
      payload: editParams(140), state: 'edit_submitted',
      createdAt: now, updatedAt: now, attempts: 1, lastAttemptAt: now, lastError: null,
    };
    const reseed = () => { mockStore[EDIT_OPS_KEY] = JSON.stringify([op]); };

    // (a) Mere presence at packets/incoming/{editEventId} → still in flight, NOT applied.
    reseed();
    await processEditOperations(makeFetch({
      ...processedOriginal,
      [`packets/incoming/${op.editEventId}`]: { requestType: 'edit', packetId: PID },
    }));
    expect(rawOps()[0].state).toBe('edit_submitted');

    // (b) Mere presence at packets/processed/{editEventId} (no commit proof) → NOT applied.
    reseed();
    await processEditOperations(makeFetch({
      ...processedOriginal,
      [`packets/processed/${op.editEventId}`]: { packetId: op.editEventId },
    }));
    expect(rawOps()[0].state).toBe('edit_submitted');

    // (c) ONLY the matching durable governed receipt transitions the op to edited.
    reseed();
    await processEditOperations(makeFetch({
      ...processedOriginal,
      [`packets/processed/${op.editEventId}`]: { committed: true, editCommitted: true, editCommittedReceiptKey: 'r-1' },
    }));
    expect(rawOps().find((o) => o.opId === op.opId)).toBeUndefined(); // confirmed + removed
  });

  it('mintEditEventId is unique and firebase-key-safe; no Math.random derivation', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) ids.add(mintEditEventId());
    expect(ids.size).toBe(500);
    for (const id of ids) {
      expect(id).toMatch(/^editevt_[0-9a-f-]{36}$/);
      expect(id).not.toMatch(/[.#$\[\]/]/); // firebase-key-safe
    }
  });
});

describe('WB-M governed edit — Thor 1 delivery/identity regressions (8/30/2026)', () => {
  const uploadArg = (i = 0) => mockedUploadEdit.mock.calls[i][0] as any;

  it('explicit wellDown:false round-trips queue → transport (bring-online is never dropped)', async () => {
    await submit(140);
    expect(uploadArg().wellDown).toBe(false); // the exact repair Mike needs reaches the transport
    expect(uploadArg().editEventId).toBeTruthy();
  });

  it('correctionCreatedAtUTC is stamped once and IDENTICAL across retries and a restart', async () => {
    mockedUploadEdit.mockRejectedValue(new Error('tower down'));
    await submit(140);
    const opId = rawOps()[0].opId;
    const corr0 = uploadArg(0).correctionCreatedAtUTC;
    expect(typeof corr0).toBe('string');
    expect(Number.isNaN(Date.parse(corr0))).toBe(false);
    // Force a retry — same correction time.
    await processEditOperations(makeFetch(processedOriginal), { forceOpId: opId });
    expect(uploadArg(1).correctionCreatedAtUTC).toBe(corr0);
    // Simulate a restart: editDelivery reads ops from storage each pass, so a
    // fresh process pass acts on the PERSISTED op. Its createdAt (hence the
    // derived correction time) is unchanged.
    await processEditOperations(makeFetch(processedOriginal), { forceOpId: opId });
    expect(uploadArg(2).correctionCreatedAtUTC).toBe(corr0);
  });

  it('a pending edit is sent promptly on the next (foreground/restart) pass', async () => {
    mockOnline.value = false;              // offline: submit queues without a send
    await submit(140);
    expect(mockedUploadEdit).toHaveBeenCalledTimes(0);
    expect(rawOps()[0].state).toBe('edit_pending');
    mockOnline.value = true;               // foreground/restart with connectivity
    await processEditOperations(makeFetch(processedOriginal), { forceOpId: rawOps()[0].opId });
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1); // delivered promptly, not left pending
  });

  it('receipt reconciliation confirms after server completion — NOT left pending, and independent of incoming_version', async () => {
    await submit(140); // pending (no commit proof from transport)
    expect(rawOps()[0].state).toBe('edit_submitted');
    // Server completed the edit: processed shows the applied values + an editedAt
    // AFTER the op was created. NO incoming_version is provided anywhere.
    const applied = { [`packets/processed/${PID}`]: { packetId: PID, tankLevelFeet: 11.5, bblsTaken: 140, wellDown: false, editedAt: Date.now() + 1000 } };
    const res = await processEditOperations(makeFetch(applied));
    // Confirmation is proven by the op leaving the queue (state 'edited') — driven
    // solely by the processed receipt reconciliation; no incoming_version anywhere.
    expect(res.confirmed).toBe(1);
    expect(rawOps().length).toBe(0); // NOT stuck pending after server completion
  });

  it('two deliberate corrections keep DISTINCT persisted editEventIds (neither overwrites the other)', async () => {
    await submit(140);
    await submit(155);
    const ops = rawOps();
    expect(ops.length).toBe(2);
    expect(ops[0].editEventId).not.toBe(ops[1].editEventId);
    expect(ops[0].opId).not.toBe(ops[1].opId);
  });
});

describe('WB-M governed edit — immediate first-attempt delivery (Thor 1 requirement)', () => {
  it('Submit against a PROCESSED original uploads IMMEDIATELY in the same flow (no AppState/foreground)', async () => {
    // beforeEach set the original to 'sent'. No timers, no AppState — just Submit.
    const out = await submit(140);
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1); // first attempt happened synchronously in submitPullEdit
    expect(out.mode).toBe('uploading');
  });

  it('Submit against a locally-PENDING-but-server-PROCESSED original reconciles + delivers immediately (not held)', async () => {
    await setPullSyncStatus(PID, 'submitted'); // stale local status (Thor 1: create confirm reconcile hadn’t run)
    // The server actually HAS the original processed.
    const out = await submitPullEdit(editParams(140), makeFetch(processedOriginal));
    expect(mockedUploadEdit).toHaveBeenCalledTimes(1);  // delivered right away — NOT held_dependent
    expect(out.mode).toBe('uploading');
    expect(rawOps()[0].state).toBe('edit_submitted');   // attempted (confirmation follows on receipt), not edit_pending
  });

  it('a genuinely-not-yet-landed original still holds the edit (no false immediate send)', async () => {
    await setPullSyncStatus(PID, 'submitted');
    const emptyServer = makeFetch({}); // server does NOT have the original processed
    const out = await submitPullEdit(editParams(140), emptyServer);
    expect(mockedUploadEdit).toHaveBeenCalledTimes(0);  // correctly held — original not on server
    expect(out.mode).toBe('held_dependent');
    expect(rawOps()[0].state).toBe('edit_pending');
  });

  it('two rapid deliberate edits keep DISTINCT ids and both are eventually attempted (A now, B after A — never overwritten)', async () => {
    // Same-original corrections deliver SERIALLY (apply A then B in order): A is
    // attempted immediately, B is durably held (never woken-over or replaced).
    await submit(140);
    await submit(155);
    const ops = rawOps();
    expect(ops.length).toBe(2);                       // two durable ops, neither replaced
    expect(new Set(ops.map((o) => o.editEventId)).size).toBe(2); // distinct ids
    const [a, b] = ops.sort((x, y) => x.createdAt - y.createdAt || (x.opId < y.opId ? -1 : 1));
    expect(a.state).toBe('edit_submitted');           // A attempted immediately
    expect(b.state).toBe('edit_pending');             // B preserved behind A (not lost)
    // After A confirms (server receipt), B is attempted with its OWN distinct id.
    mockedUploadEdit.mockClear();
    const appliedA = { [`packets/processed/${PID}`]: { packetId: PID, tankLevelFeet: 11.5, bblsTaken: 140, wellDown: false, editedAt: Date.now() + 1000 } };
    await processEditOperations(makeFetch(appliedA));
    expect(sentUploadIds()).toContain(b.editEventId); // B eventually attempted, distinct id
  });
});
