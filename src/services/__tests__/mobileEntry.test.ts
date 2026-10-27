import { startMobileEntry } from '../mobileEntry';

const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function ops() {
  return { established: jest.fn(async () => true), authorize: jest.fn(async () => ({ authorizeUrl: 'suite://authorize' })),
    open: jest.fn(async (_url: string) => {}), ready: jest.fn(), failed: jest.fn() };
}
beforeEach(() => { jest.useFakeTimers(); jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

test('established access opens immediately without authorization or a recovery timer', async () => {
  const o = ops(); startMobileEntry(o); await tick();
  expect(o.ready).toHaveBeenCalledTimes(1); expect(o.authorize).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
});
test('a stranded initial local read recovers automatically without a process restart', async () => {
  const o = ops(), read = deferred<boolean>(); o.established.mockImplementationOnce(() => read.promise);
  startMobileEntry(o); jest.advanceTimersByTime(8000); await tick();
  expect(o.ready).toHaveBeenCalledTimes(1); expect(o.authorize).not.toHaveBeenCalled();
  read.resolve(false); await tick(); expect(o.authorize).not.toHaveBeenCalled(); expect(o.failed).not.toHaveBeenCalled();
});
test('a delayed handoff is resumed by checking established access, never minting another code', async () => {
  const o = ops(); o.established.mockResolvedValueOnce(false); startMobileEntry(o); await tick();
  expect(o.open).toHaveBeenCalledTimes(1); jest.advanceTimersByTime(8000); await tick();
  expect(o.ready).toHaveBeenCalledTimes(1); expect(o.authorize).toHaveBeenCalledTimes(1);
});
test('an existing PKCE attempt waits for the restored session without replaying authorization', async () => {
  const o = ops(); o.established.mockResolvedValueOnce(false); o.authorize.mockRejectedValueOnce(Error('sso_attempt_in_progress'));
  startMobileEntry(o); await tick(); expect(o.failed).not.toHaveBeenCalled();
  jest.advanceTimersByTime(8000); await tick(); expect(o.ready).toHaveBeenCalledTimes(1); expect(o.open).not.toHaveBeenCalled();
});
test('missing or denied established access is never converted into permission by a timer', async () => {
  const o = ops(); o.established.mockResolvedValue(false); startMobileEntry(o); await tick();
  jest.advanceTimersByTime(8000); await tick(); jest.advanceTimersByTime(12000); await tick();
  expect(o.ready).not.toHaveBeenCalled(); expect(o.failed).toHaveBeenCalledTimes(1); expect(o.authorize).toHaveBeenCalledTimes(1);
});
test('owner/focus cancellation fences late reads and late external opens', async () => {
  const o = ops(), read = deferred<boolean>(); o.established.mockImplementationOnce(() => read.promise);
  const cancel = startMobileEntry(o); cancel(); read.resolve(true); await tick();
  expect(o.ready).not.toHaveBeenCalled(); expect(o.authorize).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0);
  const late = deferred<{ authorizeUrl: string }>(); o.established.mockResolvedValue(false); o.authorize.mockImplementationOnce(() => late.promise);
  const cancel2 = startMobileEntry(o); await tick(); cancel2(); late.resolve({ authorizeUrl: 'suite://old' }); await tick();
  expect(o.open).not.toHaveBeenCalled();
});
test('hung native/storage reads end with an in-app retry instead of an endless spinner', async () => {
  const o = ops(), read = deferred<boolean>(); o.established.mockImplementation(() => read.promise);
  startMobileEntry(o); jest.advanceTimersByTime(20000); await tick();
  expect(o.failed).toHaveBeenCalledTimes(1); read.resolve(true); await tick(); expect(o.ready).not.toHaveBeenCalled();
});
