import { createSingleFlight } from '../singleFlight';

const defer = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createSingleFlight — exactly one operation per tap', () => {
  test('busy flips true synchronously on the accepted call', () => {
    const sf = createSingleFlight();
    expect(sf.running).toBe(false);
    sf.run(() => defer().promise); // never resolves in this test
    expect(sf.running).toBe(true); // immediate control-level feedback
  });

  test('a call made while running is a no-op — the second op never starts', async () => {
    const sf = createSingleFlight();
    const first = defer<string>();
    const fn1 = jest.fn(() => first.promise);
    const fn2 = jest.fn(() => Promise.resolve('second'));

    const p1 = sf.run(fn1);
    const p2 = sf.run(fn2); // rejected as duplicate

    expect(p1).toBeDefined();
    expect(p2).toBeUndefined();
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).not.toHaveBeenCalled(); // exactly one operation

    first.resolve('first');
    await p1;
    expect(sf.running).toBe(false);
  });

  test('running clears after the operation RESOLVES, freeing the next call', async () => {
    const sf = createSingleFlight();
    const d = defer<number>();
    const p = sf.run(() => d.promise);
    expect(sf.running).toBe(true);
    d.resolve(1);
    await p;
    expect(sf.running).toBe(false);
    // next call is accepted
    const fn = jest.fn(() => Promise.resolve());
    sf.run(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('running clears after the operation REJECTS (no stuck busy)', async () => {
    const sf = createSingleFlight();
    const d = defer<number>();
    const p = sf.run(() => d.promise);
    expect(sf.running).toBe(true);
    d.reject(new Error('boom'));
    await expect(p).rejects.toThrow('boom');
    expect(sf.running).toBe(false);
  });

  test('a synchronously-thrown fn still clears busy and rejects', async () => {
    const sf = createSingleFlight();
    const p = sf.run(() => {
      throw new Error('sync');
    });
    expect(sf.running).toBe(false);
    await expect(p).rejects.toThrow('sync');
  });

  test('rapid repeated taps produce exactly one operation', () => {
    const sf = createSingleFlight();
    const fn = jest.fn(() => defer().promise);
    for (let i = 0; i < 10; i++) sf.run(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
