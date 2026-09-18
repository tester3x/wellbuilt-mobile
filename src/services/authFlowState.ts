/**
 * WB-M authentication flow state — pure, dependency-free logic for the login /
 * forced-passcode-change spinner and error recovery.
 *
 * Goals (packet 02-CLAUDE):
 *  - Bounded auth + hydration timeouts; the spinner tears down on EVERY terminal
 *    outcome (success, rejection, timeout, malformed response, network failure,
 *    unmount, identity change) — never an indefinite animation.
 *  - Secret-free internal categories for correlation/logging.
 *  - Public wording must NOT enable account enumeration: unknown_name and
 *    bad_passcode collapse to ONE identical message.
 *
 * No secrets (passcode/hash/token) ever enter these values.
 */

export type AuthCategory =
  | 'ok'
  | 'unknown_name'
  | 'bad_passcode'
  | 'reset_required'
  | 'forbidden'
  | 'network_error'
  | 'timeout'
  | 'server_error';

/** Bounded waits — the spinner can never outlive these. */
export const AUTH_TIMEOUT_MS = 15_000;
export const HYDRATION_TIMEOUT_MS = 20_000;

/** Phases that legitimately show the wells spinner; everything else hides it. */
export type AuthPhase = 'idle' | 'authenticating' | 'hydrating' | 'done' | 'error';

export function shouldShowSpinner(phase: AuthPhase): boolean {
  return phase === 'authenticating' || phase === 'hydrating';
}

/**
 * A terminal event always leaves a non-spinner phase. `unmount` and
 * `identity_change` are terminal too: the in-flight attempt is abandoned and
 * the spinner must stop.
 */
export type AuthEvent =
  | 'start_auth'
  | 'start_hydration'
  | 'success'
  | 'rejected'
  | 'timeout'
  | 'malformed'
  | 'network_error'
  | 'unmount'
  | 'identity_change';

export function nextAuthPhase(current: AuthPhase, event: AuthEvent): AuthPhase {
  switch (event) {
    case 'start_auth':
      return 'authenticating';
    case 'start_hydration':
      return 'hydrating';
    case 'success':
      return 'done';
    case 'rejected':
    case 'timeout':
    case 'malformed':
    case 'network_error':
      return 'error';
    case 'unmount':
    case 'identity_change':
      // Abandon the in-flight attempt; stop animating.
      return 'idle';
    default:
      return current;
  }
}

/** True only when the phase is not a spinner phase (proves teardown). */
export function isSpinnerTornDown(phase: AuthPhase): boolean {
  return !shouldShowSpinner(phase);
}

/**
 * Classify an auth outcome into a secret-free internal category. Server
 * messages are intentionally generic, so classification leans on error codes /
 * shapes and network/timeout signals, defaulting to server_error.
 */
export function classifyAuthOutcome(input: {
  ok?: boolean;
  code?: string | null;
  timedOut?: boolean;
  networkFailed?: boolean;
  malformed?: boolean;
}): AuthCategory {
  if (input.ok) return 'ok';
  if (input.timedOut) return 'timeout';
  if (input.networkFailed) return 'network_error';
  if (input.malformed) return 'server_error';
  switch ((input.code || '').toLowerCase()) {
    case 'not-found':
    case 'unknown_name':
      return 'unknown_name';
    case 'unauthenticated':
    case 'bad_passcode':
    case 'wrong_passcode':
      return 'bad_passcode';
    case 'failed-precondition':
    case 'reset_required':
      return 'reset_required';
    case 'permission-denied':
    case 'forbidden':
      return 'forbidden';
    case 'unavailable':
      return 'network_error';
    case 'deadline-exceeded':
      return 'timeout';
    default:
      return 'server_error';
  }
}

/**
 * Public, non-enumerating message. unknown_name and bad_passcode MUST return
 * the identical string so a caller cannot tell whether the name exists.
 */
const GENERIC_SIGN_IN = 'That name or passcode didn’t match. Check them and try again.';

export function publicAuthMessage(category: AuthCategory): string {
  switch (category) {
    case 'unknown_name':
    case 'bad_passcode':
      return GENERIC_SIGN_IN; // never distinguish — no account enumeration
    case 'reset_required':
      return 'Your passcode must be changed before you can continue.';
    case 'forbidden':
      return 'This account is not permitted to sign in here.';
    case 'network_error':
      return 'No connection. Check your network and try again.';
    case 'timeout':
      return 'Sign in timed out. Try again.';
    case 'server_error':
    default:
      return 'Something went wrong signing in. Try again.';
  }
}

/** Only these end states allow a retry button; a retry must be idempotent. */
export function isRetryable(category: AuthCategory): boolean {
  return (
    category === 'network_error' ||
    category === 'timeout' ||
    category === 'server_error' ||
    category === 'bad_passcode' ||
    category === 'unknown_name'
  );
}

/**
 * Decide routing from the AUTHORITATIVE forced-passcode-change token claim.
 * Never invents `false`: an unresolved claim routes to authenticated session
 * verification instead of silently continuing.
 *   - 'true'    → forced change, persist true
 *   - 'false'   → continue normally, persist false
 *   - 'unknown' → verify (missing / malformed / stale), do NOT persist
 */
export function decideForcedChangeFromClaim(
  claim: 'true' | 'false' | 'unknown',
): { route: 'passcode-change' | 'continue' | 'verify'; persist: boolean | null } {
  if (claim === 'true') return { route: 'passcode-change', persist: true };
  if (claim === 'false') return { route: 'continue', persist: false };
  return { route: 'verify', persist: null };
}

// ── Wells / profile hydration flow ──────────────────────────────────────────

export type HydrationPhase = 'loading' | 'ready' | 'error';

export function shouldShowHydrationSpinner(phase: HydrationPhase, wellDown: boolean): boolean {
  return phase === 'loading' && !wellDown;
}

/**
 * Every terminal event leaves a NON-loading phase (spinner stops). success →
 * ready; timeout/error → error; unmount/logout/identity_change abandon the load
 * (no spinner); retry restarts loading.
 */
export type HydrationEvent =
  | 'success'
  | 'timeout'
  | 'error'
  | 'unmount'
  | 'logout'
  | 'identity_change'
  | 'retry';

export function nextHydrationPhase(current: HydrationPhase, event: HydrationEvent): HydrationPhase {
  switch (event) {
    case 'success':
      return 'ready';
    case 'timeout':
    case 'error':
      return 'error';
    case 'retry':
      return 'loading';
    case 'unmount':
    case 'logout':
    case 'identity_change':
      return 'ready'; // abandoned attempt must not keep animating
    default:
      return current;
  }
}

/** A result from a prior account/well/context generation must be discarded. */
export function isStaleHydration(startedGeneration: string, currentGeneration: string): boolean {
  return startedGeneration !== currentGeneration;
}

/**
 * Valid cached data must NOT be wiped merely because a request timed out or the
 * network failed. Only a genuine identity/company change invalidates the cache.
 */
export function shouldClearCacheOnHydrationFailure(event: HydrationEvent): boolean {
  return event === 'identity_change';
}

/**
 * Race a promise against a bounded timeout. On timeout the returned marker lets
 * the caller tear the spinner down and classify as 'timeout' without leaving the
 * original promise able to flip the spinner back on.
 */
export async function withAuthTimeout<T>(
  p: Promise<T>,
  ms: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true; value: null }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true; value: null }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true, value: null }), ms);
  });
  try {
    const winner = await Promise.race([
      p.then((value) => ({ timedOut: false as const, value })),
      timeout,
    ]);
    return winner;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
