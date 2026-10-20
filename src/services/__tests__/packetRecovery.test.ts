// Durable-queue + stable-identity proofs (GS3 follow-up).
// AsyncStorage/NetInfo/firebase/driverAuth are mocked; no Firebase writes.

const mockStore: Record<string, string> = {};
const mockOnline = { value: true };
const mockMint = { counter: 0 };

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
  mintPacketId: jest.fn((wellName: string) => {
    mockMint.counter += 1;
    return `20260722_12${String(mockMint.counter).padStart(4, '0')}_${String(wellName).replace(/\s+/g, '')}_t${mockMint.counter}`;
  }),
}));

jest.mock('../driverAuth', () => ({
  getDriverId: jest.fn(async () => null),
  getDriverName: jest.fn(async () => null),
}));

import {uploadTankPacket} from '../firebase';
import {queuePacket,flushQueue,startNetworkMonitor,stopNetworkMonitor,getQueuedPackets} from '../packetQueue';
const upload=uploadTankPacket as jest.Mock;
const data=(id:string)=>({packetId:id,wellName:'Test',dateTimeUTC:'2026-10-19T12:00:00Z'});
afterEach(()=>{stopNetworkMonitor();jest.useRealTimers();});
test('weak online service pauses remaining sends, then retries automatically with the original IDs',async()=>{
 jest.useFakeTimers();jest.setSystemTime(100000);
 for(const id of ['one','two','three'])await queuePacket('pull',data(id));
 upload.mockRejectedValue(Object.assign(Error('unavailable'),{code:'functions/unavailable'}));
 await flushQueue();
 expect(upload).toHaveBeenCalledTimes(2);
 expect((await getQueuedPackets()).map(p=>p.packetId)).toEqual(['one','two','three']);
 await flushQueue();expect(upload).toHaveBeenCalledTimes(2);
 upload.mockResolvedValue({});startNetworkMonitor();
 await jest.advanceTimersByTimeAsync(29999);expect(upload).toHaveBeenCalledTimes(2);
 await jest.advanceTimersByTimeAsync(1);
 expect(upload).toHaveBeenCalledTimes(5);
 expect(upload.mock.calls.map(c=>c[0].packetId)).toEqual(['one','two','one','two','three']);
 expect(await getQueuedPackets()).toEqual([]);
 expect(jest.getTimerCount()).toBe(0);
});
test('disconnected queue stays durable without a retry polling timer',async()=>{
 jest.useFakeTimers();mockOnline.value=false;
 upload.mockClear();await queuePacket('pull',data('offline'));
 startNetworkMonitor();await jest.advanceTimersByTimeAsync(120000);
 expect(upload).not.toHaveBeenCalled();expect(jest.getTimerCount()).toBe(0);
 expect((await getQueuedPackets())[0].packetId).toBe('offline');
});
