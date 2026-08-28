// Chronological review signals (repaired pipeline) — pure mapping + presence check.
// These are REVIEW information, never rejection: a pull carrying any of them is still
// accepted and displayed; the badge only flags it for dispatch review. Current
// production packets omit these fields entirely, so everything defaults to false and
// the UI is visually unchanged (compatible).

export interface ReviewSignals {
  lateEntry: boolean;
  anomaly: boolean;
  potentialDuplicate: boolean;
  needsReview: boolean;
}

/** Read the four review flags off a processed packet (defensively; only an explicit
 *  `true` counts — missing/undefined/other values are false). */
export function reviewSignalsFromPacket(p: Record<string, unknown> | null | undefined): ReviewSignals {
  return {
    lateEntry: (p?.lateEntry as unknown) === true,
    anomaly: (p?.anomaly as unknown) === true,
    potentialDuplicate: (p?.potentialDuplicate as unknown) === true,
    needsReview: (p?.needsReview as unknown) === true,
  };
}

/** True when a row carries at least one review signal (drives badge visibility). */
export function hasReviewSignals(row: Partial<ReviewSignals> | null | undefined): boolean {
  return !!(row && (row.lateEntry || row.anomaly || row.potentialDuplicate || row.needsReview));
}
