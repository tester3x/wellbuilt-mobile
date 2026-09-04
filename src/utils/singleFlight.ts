/**
 * createSingleFlight — one operation at a time.
 *
 * Guarantees exactly one in-flight operation per guard: a call made while an
 * operation is still running is a no-op (returns undefined) and never starts a
 * second operation. The busy flag flips true synchronously on the accepted call
 * (immediate control-level feedback) and always clears when the operation
 * settles — resolve OR reject — so a thrown/cancelled operation never wedges it.
 *
 * Used by WellBuiltAsyncButton and mirrored by the record submit guard, so
 * duplicate taps can never start duplicate work. Existing idempotency remains
 * authoritative; this only stops the second operation from beginning.
 */
export interface SingleFlight {
  /** Run fn iff idle. Returns fn's promise, or undefined if already running. */
  run<T>(fn: () => T | Promise<T>): Promise<T> | undefined;
  /** True while an operation is in flight. */
  readonly running: boolean;
}

export function createSingleFlight(): SingleFlight {
  let running = false;
  const guard: SingleFlight = {
    get running() {
      return running;
    },
    run<T>(fn: () => T | Promise<T>): Promise<T> | undefined {
      if (running) return undefined; // duplicate — no second operation starts
      running = true;
      let result: Promise<T>;
      try {
        result = Promise.resolve(fn());
      } catch (syncErr) {
        // A synchronously-thrown fn still clears the flag.
        running = false;
        return Promise.reject(syncErr);
      }
      return result.finally(() => {
        running = false;
      });
    },
  };
  return guard;
}
