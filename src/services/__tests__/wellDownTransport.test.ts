// Explicit `wellDown: false` must SURVIVE the offline queue end-to-end:
// serialize -> AsyncStorage -> deserialize (restart) -> replay -> ingest,
// and a resubmit of the same packet must not duplicate the pull or the status
// mutation. AsyncStorage/NetInfo/firebase/driverAuth are mocked; no real writes.

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
  mintPacketId: jest.fn((wellName: string) => `20260830_120000_${String(wellName).replace(/\s+/g, '')}_zzz001`),
}));

jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => null),
  getDriverName: jest.fn(async () => null),
}));

import { uploadTankPacket } from '../firebase';
import {
  flushQueue,
  getQueuedPackets,
  smartUploadTankPacket,
} from '../packetQueue';

const QUEUE_KEY = '@wellbuilt_packet_queue';
const mockedUploadTank = uploadTankPacket as jest.Mock;
const rawQueue = (): any[] => (mockStore[QUEUE_KEY] ? JSON.parse(mockStore[QUEUE_KEY]) : []);

const downToOnlinePull = (packetId: string) => ({
  packetId,
  wellName: 'Thor 1',
  dateTime: '8/30/2026 3:00 PM',
  dateTimeUTC: '2026-08-30T20:00:00.000Z',
  tankLevelFeet: 11.333333,
  bblsTaken: 140,
  wellDown: false, // the explicit down->online assertion
});

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockOnline.value = true;
  mockedUploadTank.mockReset();
});

describe('explicit wellDown:false survives the offline queue', () => {
  test('serialize -> restart(deserialize) preserves an explicit boolean false', async () => {
    mockOnline.value = false; // force queueing
    const pid = '20260830_120000_Thor1_abc123';
    await smartUploadTankPacket(downToOnlinePull(pid));

    // Simulate a cold restart: the ONLY surviving state is AsyncStorage. A
    // fresh read must yield an explicit boolean false, not undefined/dropped.
    const restored = await getQueuedPackets();
    expect(restored).toHaveLength(1);
    expect(restored[0].data).toHaveProperty('wellDown', false);
    expect(typeof restored[0].data.wellDown).toBe('boolean');
    // And the persisted JSON itself carries it (no truthiness pruning on write).
    expect(rawQueue()[0].data.wellDown).toBe(false);
  });

  test('replay after restart delivers wellDown:false to ingest', async () => {
    mockOnline.value = false;
    const pid = '20260830_120000_Thor1_abc123';
    await smartUploadTankPacket(downToOnlinePull(pid));

    mockOnline.value = true;
    mockedUploadTank.mockResolvedValue({ packetId: pid });
    await flushQueue();

    expect(mockedUploadTank).toHaveBeenCalledTimes(1);
    const delivered = mockedUploadTank.mock.calls[0][0];
    expect(delivered.wellDown).toBe(false); // explicit false reached ingest
    expect(delivered.packetId).toBe(pid);
    expect(rawQueue()).toHaveLength(0);
  });
});

describe('5. queue persistence/restart preserves touched intent WITHOUT converting untouched into authority', () => {
  const pullWithAuthority = (packetId: string, wellDown: boolean, wellDownIsAuthoritative: boolean) => ({
    packetId, wellName: 'Thor 1', dateTime: '8/30/2026 3:00 PM', dateTimeUTC: '2026-08-30T20:00:00.000Z',
    tankLevelFeet: 11.333333, bblsTaken: 140, wellDown, wellDownIsAuthoritative,
  });

  test('a TOUCHED pull keeps wellDownIsAuthoritative:true across serialize -> restart -> replay', async () => {
    mockOnline.value = false;
    const pid = '20260830_120000_Thor1_touch1';
    await smartUploadTankPacket(pullWithAuthority(pid, false, true)); // explicit down->online
    // restart: only AsyncStorage survives
    const restored = await getQueuedPackets();
    expect(restored[0].data.wellDownIsAuthoritative).toBe(true);
    expect(rawQueue()[0].data.wellDownIsAuthoritative).toBe(true);
    // replay delivers the asserted authority
    mockOnline.value = true;
    mockedUploadTank.mockResolvedValue({ packetId: pid });
    await flushQueue();
    expect(mockedUploadTank.mock.calls[0][0].wellDownIsAuthoritative).toBe(true);
    expect(mockedUploadTank.mock.calls[0][0].wellDown).toBe(false);
  });

  test('an UNTOUCHED pull keeps wellDownIsAuthoritative:false — never promoted to authority by the queue', async () => {
    mockOnline.value = false;
    const pid = '20260830_120000_Thor1_untch1';
    // untouched box on a down-seeded well: wellDown carries the seed, authority is false
    await smartUploadTankPacket(pullWithAuthority(pid, true, false));
    const restored = await getQueuedPackets();
    expect(restored[0].data.wellDownIsAuthoritative).toBe(false); // NOT converted to true
    expect(typeof restored[0].data.wellDownIsAuthoritative).toBe('boolean');
    expect(rawQueue()[0].data.wellDownIsAuthoritative).toBe(false);
    mockOnline.value = true;
    mockedUploadTank.mockResolvedValue({ packetId: pid });
    await flushQueue();
    expect(mockedUploadTank.mock.calls[0][0].wellDownIsAuthoritative).toBe(false); // still not asserted after replay
  });
});

describe('retry / idempotency', () => {
  test('a timeout-after-landing retry re-sends the SAME identity (server dedupes; no duplicate pull/status)', async () => {
    mockOnline.value = false;
    const pid = '20260830_120000_Thor1_abc123';
    await smartUploadTankPacket(downToOnlinePull(pid));

    mockOnline.value = true;
    // First attempt: the PUT landed server-side but the client saw a timeout.
    mockedUploadTank.mockRejectedValueOnce(new Error('timeout'));
    await flushQueue();
    expect(rawQueue()).toHaveLength(1); // retained for retry, not dropped

    // Clear backoff and retry; the server sees an identical idempotencyKey.
    mockStore[QUEUE_KEY] = JSON.stringify(rawQueue().map((p) => ({ ...p, nextAttemptAt: null })));
    mockedUploadTank.mockResolvedValueOnce({ packetId: pid });
    await flushQueue();

    const ids = mockedUploadTank.mock.calls.map((c) => c[0].packetId);
    expect(ids).toEqual([pid, pid]); // identical identity both times → idempotent
    // Both attempts carried the same explicit status assertion.
    expect(mockedUploadTank.mock.calls.every((c) => c[0].wellDown === false)).toBe(true);
    expect(rawQueue()).toHaveLength(0);
  });
});
