// Focused proofs for the future-timestamp hard stop (GS3 incident 7/21/2026).
// The guard is a pure function: finalized UTC value + device clock in,
// verdict out. Connectivity/queue state cannot influence it (see the wiring
// test for the offline-cannot-bypass ordering proof).
import { evaluatePullTime, FUTURE_PULL_TOLERANCE_MS } from '../pullTimeGuard';

const CHICAGO = 'America/Chicago';

// Device clock: Tue 7/21/2026 9:41:35 PM CDT (America/Chicago, UTC-5).
const NOW_MS = new Date('2026-07-22T02:41:35Z').getTime();

describe('evaluatePullTime', () => {
  test('a past timestamp passes', () => {
    // The real 2:17 PM CDT pull from the incident day.
    const verdict = evaluatePullTime('2026-07-21T19:17:00.000Z', NOW_MS, CHICAGO);
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toBe('');
    expect(verdict.aheadMs).toBeLessThan(0);
  });

  test('exactly 5 minutes ahead passes (clock-skew tolerance)', () => {
    const iso = new Date(NOW_MS + FUTURE_PULL_TOLERANCE_MS).toISOString();
    const verdict = evaluatePullTime(iso, NOW_MS, CHICAGO);
    expect(verdict.ok).toBe(true);
    expect(verdict.aheadMs).toBe(FUTURE_PULL_TOLERANCE_MS);
  });

  test('more than 5 minutes ahead is blocked', () => {
    const iso = new Date(NOW_MS + FUTURE_PULL_TOLERANCE_MS + 1000).toISOString();
    const verdict = evaluatePullTime(iso, NOW_MS, CHICAGO);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('A completed pull cannot be recorded in the future.');
    expect(verdict.message).toContain('Check the date, time, and AM/PM.');
  });

  test('the GS3 AM/PM mistake is blocked; the corrected AM value passes', () => {
    // Driver meant 11:07 AM but the stored value said 11:07 PM CDT
    // (2026-07-22T04:07:00Z) while the evening clock read 9:41 PM.
    const pm = evaluatePullTime('2026-07-22T04:07:00.000Z', NOW_MS, CHICAGO);
    expect(pm.ok).toBe(false);
    expect(pm.aheadMs).toBe(85 * 60 * 1000 + 25 * 1000); // 1h 25m 25s ahead

    const am = evaluatePullTime('2026-07-21T16:07:00.000Z', NOW_MS, CHICAGO);
    expect(am.ok).toBe(true);
  });

  test('UTC → America/Chicago conversion is correct in driver-facing labels', () => {
    const verdict = evaluatePullTime('2026-07-22T04:07:00.000Z', NOW_MS, CHICAGO);
    // 04:07Z on 7/22 is 11:07 PM CDT on 7/21 — the date must roll back too.
    expect(verdict.enteredLabel).toBe('7/21/2026, 11:07 PM');
    expect(verdict.nowLabel).toBe('7/21/2026, 9:41 PM');
    expect(verdict.message).toBe(
      'This pull is dated 7/21/2026, 11:07 PM, but the current time is 7/21/2026, 9:41 PM. ' +
        'A completed pull cannot be recorded in the future. Check the date, time, and AM/PM.',
    );
  });

  test('an unparseable timestamp is refused, never trusted', () => {
    const verdict = evaluatePullTime('not-a-date', NOW_MS, CHICAGO);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('Check the date, time, and AM/PM.');
  });

  test('verdict is pure and deterministic — repeated calls agree exactly', () => {
    // Offline/online state is invisible to the guard by construction: it
    // receives only the finalized value and the clock. Same inputs, same
    // verdict, every time.
    const a = evaluatePullTime('2026-07-22T04:07:00.000Z', NOW_MS, CHICAGO);
    const b = evaluatePullTime('2026-07-22T04:07:00.000Z', NOW_MS, CHICAGO);
    expect(b).toEqual(a);
  });
});
