/**
 * Attach a sequence of listeners with cancellation re-checks.
 * If cancelled before or between attachments, already-attached
 * listeners are torn down so none leak.
 */

export type Unsub = () => void;

export function runCancellableAttach(opts: {
  isCancelled: () => boolean;
  attach: Array<() => Unsub>;
}): { teardown: () => void; count: number } {
  const attached: Unsub[] = [];
  const teardown = () => {
    while (attached.length) {
      const u = attached.pop();
      try { u?.(); } catch { /* ignore */ }
    }
  };
  if (opts.isCancelled()) return { teardown, count: 0 };
  for (const fn of opts.attach) {
    if (opts.isCancelled()) {
      teardown();
      return { teardown, count: 0 };
    }
    attached.push(fn());
    if (opts.isCancelled()) {
      teardown();
      return { teardown, count: 0 };
    }
  }
  return { teardown, count: attached.length };
}
