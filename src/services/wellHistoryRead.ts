import { getFirebaseAuth } from './firebaseAuthSession';
import { getSessionGeneration } from './wbmSessionFence';

export interface WellHistoryRead {
  signal: AbortSignal;
  wait<T>(work: () => Promise<T>): Promise<T>;
}

/** One deadline covers token acquisition, network, response body and config read.
 * This is read-only: expiration never clears a session or changes queued work. */
export async function withWellHistoryRead<T>(work: (read: WellHistoryRead) => Promise<T>, timeoutMs = 15_000): Promise<T> {
  const user = getFirebaseAuth().currentUser, generation = getSessionGeneration();
  const controller = new AbortController();
  let active = true;
  const assertCurrent = () => {
    if (!active || !user || getFirebaseAuth().currentUser !== user || getSessionGeneration() !== generation) {
      throw new Error('Well history account changed. Reopen history to retry.');
    }
  };
  assertCurrent();
  let rejectDeadline!: (reason: Error) => void;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => {
    active = false;
    rejectDeadline(new Error('Well history request timed out. Saved history is still available; refresh to retry.'));
    controller.abort();
  }, timeoutMs);
  const read: WellHistoryRead = {
    signal: controller.signal,
    async wait<U>(stage: () => Promise<U>): Promise<U> {
      assertCurrent();
      const result = await Promise.race([stage(), deadline]);
      assertCurrent();
      return result;
    },
  };
  try {
    const result = await Promise.race([work(read), deadline]);
    assertCurrent();
    return result;
  } finally {
    active = false;
    clearTimeout(timer);
  }
}
