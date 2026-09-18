/**
 * Forced-passcode-change gate + auth-flow recovery — pure-logic unit tests.
 * Covers the packet's security-critical invariants without a device:
 *   - the gate outranks eligibility/destination but never revoked/no-session,
 *   - it applies identically to cold start (bootstrap) and post-login,
 *   - the spinner tears down on every terminal outcome,
 *   - login errors never enable account enumeration.
 */
import {
  decidePostAuthRoute,
  decideBootstrapRoute,
} from '../eligibility';
import {
  classifyAuthOutcome,
  publicAuthMessage,
  shouldShowSpinner,
  nextAuthPhase,
  isSpinnerTornDown,
  isRetryable,
  withAuthTimeout,
  type AuthPhase,
  type AuthEvent,
} from '../authFlowState';

describe('forced-passcode-change gate (decidePostAuthRoute)', () => {
  it('routes a valid session with mustChangePasscode to /passcode-change', () => {
    expect(
      decidePostAuthRoute({
        hasLocalSession: true,
        revalidation: 'valid',
        eligibility: 'eligible',
        eligibleDestination: '/(tabs)',
        mustChangePasscode: true,
      }),
    ).toBe('/passcode-change');
  });

  it('gate outranks eligibility (ineligible/unknown still go to /passcode-change)', () => {
    for (const eligibility of ['eligible', 'ineligible', 'unknown'] as const) {
      expect(
        decidePostAuthRoute({
          hasLocalSession: true,
          revalidation: 'valid',
          eligibility,
          mustChangePasscode: true,
        }),
      ).toBe('/passcode-change');
    }
  });

  it('revoked session still wins over the gate (goes to /driver-login)', () => {
    expect(
      decidePostAuthRoute({
        hasLocalSession: true,
        revalidation: 'revoked',
        eligibility: 'eligible',
        mustChangePasscode: true,
      }),
    ).toBe('/driver-login');
  });

  it('no local session still wins over the gate (goes to /driver-login)', () => {
    expect(
      decidePostAuthRoute({
        hasLocalSession: false,
        revalidation: 'unknown',
        eligibility: 'unknown',
        mustChangePasscode: true,
      }),
    ).toBe('/driver-login');
  });

  it('without the flag, normal routing is unchanged', () => {
    expect(
      decidePostAuthRoute({
        hasLocalSession: true,
        revalidation: 'valid',
        eligibility: 'eligible',
        eligibleDestination: '/welcome',
      }),
    ).toBe('/welcome');
    expect(
      decidePostAuthRoute({
        hasLocalSession: true,
        revalidation: 'valid',
        eligibility: 'ineligible',
      }),
    ).toBe('/no-access');
  });

  it('cold-start bootstrap enforces the gate identically', () => {
    expect(
      decideBootstrapRoute({
        hasLocalSession: true,
        revalidation: 'valid',
        eligibility: 'eligible',
        mustChangePasscode: true,
      }),
    ).toBe('/passcode-change');
  });
});

describe('login classification never enables account enumeration', () => {
  it('unknown_name and bad_passcode produce the IDENTICAL public message', () => {
    const a = publicAuthMessage(classifyAuthOutcome({ code: 'not-found' }));
    const b = publicAuthMessage(classifyAuthOutcome({ code: 'unauthenticated' }));
    expect(classifyAuthOutcome({ code: 'not-found' })).toBe('unknown_name');
    expect(classifyAuthOutcome({ code: 'unauthenticated' })).toBe('bad_passcode');
    expect(a).toBe(b); // no distinguishable wording
  });

  it('classifies network, timeout, reset, forbidden distinctly (internal only)', () => {
    expect(classifyAuthOutcome({ networkFailed: true })).toBe('network_error');
    expect(classifyAuthOutcome({ timedOut: true })).toBe('timeout');
    expect(classifyAuthOutcome({ code: 'failed-precondition' })).toBe('reset_required');
    expect(classifyAuthOutcome({ code: 'permission-denied' })).toBe('forbidden');
    expect(classifyAuthOutcome({ malformed: true })).toBe('server_error');
    expect(classifyAuthOutcome({})).toBe('server_error');
  });

  it('retry is offered only for recoverable/credential categories', () => {
    expect(isRetryable('network_error')).toBe(true);
    expect(isRetryable('timeout')).toBe(true);
    expect(isRetryable('bad_passcode')).toBe(true);
    expect(isRetryable('forbidden')).toBe(false);
    expect(isRetryable('reset_required')).toBe(false);
  });
});

describe('spinner tears down on every terminal outcome', () => {
  it('shows the spinner only while authenticating/hydrating', () => {
    expect(shouldShowSpinner('authenticating')).toBe(true);
    expect(shouldShowSpinner('hydrating')).toBe(true);
    for (const p of ['idle', 'done', 'error'] as AuthPhase[]) {
      expect(shouldShowSpinner(p)).toBe(false);
    }
  });

  it('every terminal event leaves a non-spinner phase', () => {
    const terminal: AuthEvent[] = [
      'success',
      'rejected',
      'timeout',
      'malformed',
      'network_error',
      'unmount',
      'identity_change',
    ];
    for (const ev of terminal) {
      const phase = nextAuthPhase('authenticating', ev);
      expect(isSpinnerTornDown(phase)).toBe(true);
    }
  });
});

describe('withAuthTimeout', () => {
  it('returns the value when the promise wins', async () => {
    const r = await withAuthTimeout(Promise.resolve('ok'), 1000);
    expect(r).toEqual({ timedOut: false, value: 'ok' });
  });

  it('reports timedOut when the timeout wins', async () => {
    const slow = new Promise<string>((resolve) => {
      const t = setTimeout(() => resolve('late'), 50);
      (t as { unref?: () => void }).unref?.(); // don't keep the test worker alive
    });
    const r = await withAuthTimeout(slow, 5);
    expect(r.timedOut).toBe(true);
  });
});
