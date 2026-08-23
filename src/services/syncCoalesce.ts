/**
 * Join duplicate foreground/version/manual sync requests onto one in-flight
 * fetch. A second caller awaits the same promise — no stacked 2s retries.
 */

export function createCoalescedRunner<T>(run: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    inFlight = run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

/** Version-triggered follow-up: one delayed extra fetch if outgoing lagged the counter. */
export const VERSION_COMPLETION_RETRY_MS = [1500] as const;
