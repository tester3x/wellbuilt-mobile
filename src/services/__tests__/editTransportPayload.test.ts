// Proves the REAL transport (firebase.uploadEditPacket → the authenticated
// ingestWbmEdit callable) serializes exactly the governed 36d37e5 allowlist,
// with a literal editEventId, and never a rejected-engine field. The callable
// boundary (secureOperationalApi) is mocked to capture the packet; everything
// upstream — the real buildWbmEditCommand and uploadEditPacket — runs for real.
let captured: Record<string, unknown> | null = null;

jest.mock('../secureOperationalApi', () => ({
  secureSubmitFieldCommand: jest.fn(async (packet: Record<string, unknown>) => {
    captured = packet;
    return { ok: true, queued: true, committed: false, status: 'pending' }; // pending, no proof
  }),
}));
jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => 'driver-a'),
  getDriverName: jest.fn(async () => 'Driver A'),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined) },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-device', () => ({ modelName: 'test' }));
jest.mock('../firebaseAuthSession', () => ({
  authorizedCallable: jest.fn(async () => ({ ok: true })),
  getFirebaseAuth: () => ({ currentUser: { uid: 'uid-a' } }),
  getValidIdToken: jest.fn(async () => 'id'),
}));

import { uploadEditPacket } from '../firebase';

const PID = '20260721_120600_Gunslinger3_abc123';
const EVID = 'editevt_00000000-0000-4000-8000-00000000abcd';
const params = {
  originalPacketTimestamp: PID.slice(0, 15), originalPacketId: PID, wellName: 'Gunslinger 3',
  dateTime: '', dateTimeUTC: '', tankLevelFeet: 11.5, bblsTaken: 140, wellDown: false,
};

beforeEach(() => { captured = null; });

describe('real edit transport payload', () => {
  it('literal editEventId + exact 36d37e5 allowlist reach the callable; no v2 fields', async () => {
    const res = await uploadEditPacket({ ...params, editEventId: EVID });
    expect(captured).toBeTruthy();
    // timezone IS in the 36d37e5 allowlist; uploadEditPacket always sets it.
    expect(Object.keys(captured!).sort()).toEqual([
      'bblsTaken', 'editEventId', 'idempotencyKey', 'originalPacketId',
      'packetId', 'requestType', 'tankLevelFeet', 'timezone', 'wellDown', 'wellName',
    ]);
    expect(captured!.requestType).toBe('edit');
    expect(captured!.editEventId).toBe(EVID);        // literal identity reached transport
    expect(captured!.idempotencyKey).toBe(EVID);     // idempotencyKey === editEventId
    expect(captured!.originalPacketId).toBe(PID);    // canonical original retained
    expect('schemaVersion' in captured!).toBe(false);
    expect('editedFields' in captured!).toBe(false);
    expect('correctionCreatedAtUTC' in captured!).toBe(false);
    // The pending callable response is NOT a commit proof.
    expect(res.committed).toBe(false);
  });

  it('includes offset-aware operational time only when the driver edited it', async () => {
    await uploadEditPacket({ ...params, editEventId: EVID, dateTimeUTC: '2026-07-21T17:06:00.000Z', dateTime: '7/21/2026 12:06 PM' });
    expect(captured!.dateTimeUTC).toBe('2026-07-21T17:06:00.000Z');
    expect(captured!.dateTime).toBe('7/21/2026 12:06 PM');
  });

  it('fails closed before the transport when editEventId is missing/malformed', async () => {
    await expect(uploadEditPacket({ ...params, editEventId: undefined })).rejects.toThrow();
    expect(captured).toBeNull(); // never reached the callable
    await expect(uploadEditPacket({ ...params, editEventId: 'short' })).rejects.toThrow();
    expect(captured).toBeNull();
  });
});
