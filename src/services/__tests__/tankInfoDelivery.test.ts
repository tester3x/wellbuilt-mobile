const mockStore: Record<string, string> = {};
let mockGeneration = 1;
let mockUser: any;
let mockDriver = 'driver-a';
const mockHooks: Record<string, any> = {};
let mockId = 0;
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
} }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async (key: string) =>
  key === 'driverId' ? mockDriver : key === 'companyId' ? 'company-a' : mockUser?.uid) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'operation-' + String(++mockId).padStart(20, '0') }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active',
  addEventListener: (_: string, callback: any) => { mockHooks.app = callback; return { remove: jest.fn() }; } } }));
jest.mock('../firebaseAuthSession', () => ({ getFirebaseAuth: () => ({ currentUser: mockUser }),
  subscribeAuthReady: (callback: any) => { mockHooks.auth = callback; return jest.fn(); } }));
jest.mock('../wbmSessionFence', () => ({ getSessionGeneration: () => mockGeneration }));
jest.mock('../packetQueue', () => ({ onConnectivityChange: (callback: any) => { mockHooks.network = callback; return jest.fn(); } }));
import { flushTankInfo, pendingTankInfo, saveTankInfo, startTankInfoDelivery } from '../tankInfo';
const originalFetch = global.fetch;
const mockFetch = jest.fn();
const info = { ok: true, wellName: 'Example', config: { tankInfoRevision: 1, activeTanks: 2, bblPerFoot: 67.2 },
  canEdit: true, canAssignPrimary: false, primaryDrivers: [] };
function acknowledge() {
  mockFetch.mockImplementation(async (_url, options) => {
    const data = JSON.parse(options.body).data;
    return { ok: true, json: async () => ({ result: { ...info, operationId: data.operationId } }) };
  });
}
beforeEach(() => {
  Object.keys(mockStore).forEach(k => delete mockStore[k]); mockId = 0; mockGeneration = 1; mockDriver = 'driver-a';
  mockUser = { uid: 'user-a', getIdToken: jest.fn(async () => 'test-token') };
  mockFetch.mockReset(); mockFetch.mockRejectedValue(Error('offline')); global.fetch = mockFetch;
});
afterAll(() => { global.fetch = originalFetch; });
test('offline edits are durable and connectivity restoration sends the same identity automatically', async () => {
  const stop = startTankInfoDelivery();
  try {
    await saveTankInfo('Example', 0, { activeTanks: 2 });
    const first = await pendingTankInfo('Example'); expect(first?.state).toBe('pending');
    acknowledge(); mockHooks.network(true); await flushTankInfo();
    expect(await pendingTankInfo('Example')).toBeUndefined();
    const sent = JSON.parse(mockFetch.mock.calls.at(-1)![1].body).data;
    expect(sent.operationId).toBe(first!.id);
  } finally { stop(); }
});
test('successful HTTP without a matching receipt never removes the edit', async () => {
  await saveTankInfo('Example', 0, { activeTanks: 2 });
  const first = await pendingTankInfo('Example');
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ result: { ...info, operationId: 'other-operation' } }) });
  await flushTankInfo(); expect((await pendingTankInfo('Example'))?.id).toBe(first!.id);
  mockFetch.mockImplementation(async (_url, options) => ({ ok: true, json: async () => ({ result: {
    ...info, config: {}, operationId: JSON.parse(options.body).data.operationId,
  } }) }));
  await flushTankInfo(); expect((await pendingTankInfo('Example'))?.id).toBe(first!.id);
  acknowledge(); await flushTankInfo(); expect(await pendingTankInfo('Example')).toBeUndefined();
});
test('periodic foreground retry recovers even without a connectivity event', async () => {
  jest.useFakeTimers();
  await saveTankInfo('Example', 0, { activeTanks: 2 });
  const stop = startTankInfoDelivery();
  try {
    await flushTankInfo(); acknowledge();
    await jest.advanceTimersByTimeAsync(30_000); await flushTankInfo();
    expect(await pendingTankInfo('Example')).toBeUndefined();
  } finally { stop(); jest.useRealTimers(); }
});
test('server refusals stay saved, stop automatic retry, and can be explicitly reviewed without losing the refused record', async () => {
  mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: { status: 'ABORTED', message: 'tank_info_conflict' } }) });
  await saveTankInfo('Example', 0, { activeTanks: 2 });
  const blocked = await pendingTankInfo('Example'); expect(blocked?.state).toBe('blocked');
  const attempts = mockFetch.mock.calls.length; await flushTankInfo(); expect(mockFetch).toHaveBeenCalledTimes(attempts);
  acknowledge(); await saveTankInfo('Example', 0, { activeTanks: 3 }, blocked!.id);
  expect(await pendingTankInfo('Example')).toBeUndefined();
  expect(Object.values(mockStore).some(raw => raw.includes('superseded') && raw.includes(blocked!.id))).toBe(true);
});
test('another account cannot see or flush the previous account queue', async () => {
  await saveTankInfo('Example', 0, { activeTanks: 2 });
  const attempts = mockFetch.mock.calls.length;
  mockDriver = 'driver-b'; mockUser = { uid: 'user-b', getIdToken: jest.fn(async () => 'other-token') }; mockGeneration++;
  expect(await pendingTankInfo('Example')).toBeUndefined(); await flushTankInfo();
  expect(mockFetch).toHaveBeenCalledTimes(attempts);
});
test('an account switch during token acquisition cannot send the old intent with the new account', async () => {
  await saveTankInfo('Example', 0, { activeTanks: 2 });
  const oldUser = mockUser;
  oldUser.getIdToken.mockImplementation(async () => {
    mockDriver = 'driver-b'; mockUser = { uid: 'user-b', getIdToken: jest.fn() }; mockGeneration++;
    return 'old-token';
  });
  const attempts = mockFetch.mock.calls.length; await flushTankInfo();
  expect(mockFetch).toHaveBeenCalledTimes(attempts);
  expect(Object.values(mockStore).some(raw => raw.includes('"state":"pending"'))).toBe(true);
});
test('foreground and auth-ready wakeups flush pending edits without opening the modal', async () => {
  await saveTankInfo('Example', 0, { activeTanks: 2 });
  const stop = startTankInfoDelivery();
  try {
    acknowledge(); mockHooks.app('active'); mockHooks.auth(); await flushTankInfo();
    expect(await pendingTankInfo('Example')).toBeUndefined();
  } finally { stop(); }
});
