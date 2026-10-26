import { createNavigationBarVisibility } from '../navigationBarVisibility';

test('foreground refresh respects overlapping keypad owners; only final close restores navigation', async () => {
  const apply = jest.fn(async (_hidden: boolean) => {});
  const visibility = createNavigationBarVisibility(apply);
  const a = {}, b = {};
  await visibility.refresh();
  expect(apply).toHaveBeenLastCalledWith(false);
  await visibility.acquire(a);
  await visibility.refresh();
  expect(apply).toHaveBeenLastCalledWith(true);
  await visibility.acquire(b);
  await visibility.release(a);
  expect(apply).toHaveBeenLastCalledWith(true);
  await visibility.release(b);
  expect(apply).toHaveBeenLastCalledWith(false);
});

test('close wins over an in-flight native hide', async () => {
  let unblock!: () => void;
  const calls: boolean[] = [];
  const visibility = createNavigationBarVisibility(async hidden => {
    calls.push(hidden);
    if (calls.length === 1) await new Promise<void>(resolve => { unblock = resolve; });
  });
  const owner = {};
  const opening = visibility.acquire(owner);
  await Promise.resolve(); await Promise.resolve();
  const closing = visibility.release(owner);
  unblock();
  await opening; await closing;
  expect(calls).toEqual([true, false]);
});

test('failed native hide cannot prevent restoration', async () => {
  const apply = jest.fn().mockRejectedValueOnce(Error('activity unavailable')).mockResolvedValue(undefined);
  const visibility = createNavigationBarVisibility(apply);
  const owner = {};
  await expect(visibility.acquire(owner)).rejects.toThrow('activity unavailable');
  await visibility.release(owner);
  expect(apply).toHaveBeenLastCalledWith(false);
});
