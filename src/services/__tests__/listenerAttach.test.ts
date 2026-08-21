import { runCancellableAttach } from '../listenerAttach';

describe('listener attach cancellation', () => {
  test('unmount during setup leaves zero listeners', () => {
    const live: string[] = [];
    let cancelled = false;
    const attach = (id: string) => () => {
      live.push(id);
      return () => {
        const i = live.indexOf(id);
        if (i >= 0) live.splice(i, 1);
      };
    };
    cancelled = true;
    const r = runCancellableAttach({
      isCancelled: () => cancelled,
      attach: [attach('a'), attach('b'), attach('c')],
    });
    expect(r.count).toBe(0);
    expect(live).toEqual([]);
  });

  test('cancel between attachments tears down partial set', () => {
    const live: string[] = [];
    let n = 0;
    const r = runCancellableAttach({
      isCancelled: () => n > 1,
      attach: [
        () => { n += 1; live.push('a'); return () => { live.splice(live.indexOf('a'), 1); }; },
        () => { n += 1; live.push('b'); return () => { live.splice(live.indexOf('b'), 1); }; },
        () => { n += 1; live.push('c'); return () => { live.splice(live.indexOf('c'), 1); }; },
      ],
    });
    expect(live).toEqual([]);
    expect(r.count).toBe(0);
  });

  test('completed attach keeps company-scoped listeners until teardown', () => {
    const live: string[] = [];
    const r = runCancellableAttach({
      isCancelled: () => false,
      attach: [
        () => { live.push('v'); return () => { live.splice(live.indexOf('v'), 1); }; },
        () => { live.push('c'); return () => { live.splice(live.indexOf('c'), 1); }; },
        () => { live.push('a'); return () => { live.splice(live.indexOf('a'), 1); }; },
      ],
    });
    expect(r.count).toBe(3);
    expect(live).toEqual(['v', 'c', 'a']);
    r.teardown();
    expect(live).toEqual([]);
  });
});
