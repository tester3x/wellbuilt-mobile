// src/services/pullTimeGuard.ts
// Future-timestamp hard stop for pull submissions.
//
// GS3 incident (7/21/2026): a driver entered 11:07 PM instead of 11:07 AM.
// The future timestamp became the well's outgoing watermark, and the server's
// stale guard then silently deleted every legitimate later pull. A completed
// pull can never be dated meaningfully in the future, so WB-M refuses to
// record one at all — no upload, no offline queue, no Pull History, no
// snapshots, no dispatch message.
//
// The check validates the FINALIZED dateTimeUTC (the exact backdate-adjusted
// value every downstream write would carry), not the displayed picker fields.
// It is a pure function of its inputs: connectivity, queue state, and clock
// reads are all injected by the caller, so offline mode cannot bypass it and
// tests are deterministic.

/** Allowance for device-clock skew between phone, server, and other devices. */
export const FUTURE_PULL_TOLERANCE_MS = 5 * 60 * 1000;

export interface PullTimeVerdict {
  ok: boolean;
  /** How far ahead of the device clock the finalized timestamp is (ms). */
  aheadMs: number;
  /** Driver-facing label for the entered (finalized) pull time. */
  enteredLabel: string;
  /** Driver-facing label for the device's current time. */
  nowLabel: string;
  /** Driver-facing explanation; empty string when ok. */
  message: string;
}

/** "7/21/2026, 11:07 PM" — en-US, minute precision, 12-hour clock. */
function formatLabel(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(timeZone ? { timeZone } : {}),
  });
}

/**
 * Validate the finalized pull timestamp against the device clock.
 *
 * @param finalizedDateTimeUTC ISO 8601 UTC string — exactly what would be
 *   uploaded/queued/persisted (i.e. `adjustedDateTime.toISOString()`).
 * @param nowMs Device clock at submit time (`Date.now()`).
 * @param timeZone Optional IANA zone for label formatting. Production callers
 *   omit it (labels render in the device zone); tests inject e.g.
 *   'America/Chicago' for deterministic output on any runner.
 */
export function evaluatePullTime(
  finalizedDateTimeUTC: string,
  nowMs: number,
  timeZone?: string,
): PullTimeVerdict {
  const enteredMs = new Date(finalizedDateTimeUTC).getTime();
  const nowLabel = formatLabel(nowMs, timeZone);

  // An unparseable timestamp can never be proven safe — refuse it too.
  if (!Number.isFinite(enteredMs)) {
    return {
      ok: false,
      aheadMs: Number.NaN,
      enteredLabel: String(finalizedDateTimeUTC),
      nowLabel,
      message:
        `This pull has an unreadable date/time, and the current time is ${nowLabel}. ` +
        `Check the date, time, and AM/PM.`,
    };
  }

  const aheadMs = enteredMs - nowMs;
  const enteredLabel = formatLabel(enteredMs, timeZone);
  const ok = aheadMs <= FUTURE_PULL_TOLERANCE_MS;
  return {
    ok,
    aheadMs,
    enteredLabel,
    nowLabel,
    message: ok
      ? ''
      : `This pull is dated ${enteredLabel}, but the current time is ${nowLabel}. ` +
        `A completed pull cannot be recorded in the future. Check the date, time, and AM/PM.`,
  };
}
