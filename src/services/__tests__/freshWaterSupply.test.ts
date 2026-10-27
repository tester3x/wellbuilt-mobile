const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => store[key] || null),
    setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
  },
}));
const callable = jest.fn();
jest.mock('../firebaseAuthSession', () => ({ authorizedCallable: (...args: unknown[]) => callable(...args) }));
const session = jest.fn();
jest.mock('../driverAuth', () => ({ getDriverSession: () => session() }));

import { flushFreshWaterDeliveries, pendingFreshWaterDeliveries, queueFreshWaterDelivery } from '../freshWaterSupply';

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  callable.mockReset();
  session.mockReset();
  session.mockResolvedValue({ driverId: 'driver-a', companyId: 'company-a', isViewer: false });
});

test('offline delivery keeps one stable ID and sends only after confirmation', async () => {
  const delivery = await queueFreshWaterDelivery({ wellName: 'Pad A', deliveredBbl: 120, measuredBeforeFeet: 10 });
  callable.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true });
  expect(await flushFreshWaterDeliveries()).toEqual({ sent: 0, pending: 1 });
  expect((await pendingFreshWaterDeliveries())[0].deliveryId).toBe(delivery.deliveryId);
  expect(await flushFreshWaterDeliveries()).toEqual({ sent: 1, pending: 0 });
  expect(callable.mock.calls[0][1].deliveryId).toBe(delivery.deliveryId);
  expect(callable.mock.calls[1][1].deliveryId).toBe(delivery.deliveryId);
});

test('another signed-in driver cannot send queued delivery', async () => {
  await queueFreshWaterDelivery({ wellName: 'Pad A', deliveredBbl: 80 });
  session.mockResolvedValue({ driverId: 'driver-b', companyId: 'company-a', isViewer: false });
  expect(await flushFreshWaterDeliveries()).toEqual({ sent: 0, pending: 0 });
  expect(callable).not.toHaveBeenCalled();
});

test('server refusal stays saved for review', async () => {
  await queueFreshWaterDelivery({ wellName: 'Pad A', deliveredBbl: 80 });
  const error = Object.assign(new Error('tank_overflow'), { callableStatus: 'FAILED_PRECONDITION' });
  callable.mockRejectedValue(error);
  expect(await flushFreshWaterDeliveries()).toEqual({ sent: 0, pending: 1 });
  expect((await pendingFreshWaterDeliveries())[0].error).toBe('tank_overflow');
});
