// Review-signal mapping + presence — the badges are INFO, never rejection, and
// current-production packets (no such fields) stay visually unchanged.
import { reviewSignalsFromPacket, hasReviewSignals } from '../reviewSignals';

describe('reviewSignalsFromPacket', () => {
  test('maps each explicit true flag through from the processed packet', () => {
    expect(reviewSignalsFromPacket({ lateEntry: true })).toEqual({ lateEntry: true, anomaly: false, potentialDuplicate: false, needsReview: false });
    expect(reviewSignalsFromPacket({ anomaly: true })).toMatchObject({ anomaly: true });
    expect(reviewSignalsFromPacket({ potentialDuplicate: true })).toMatchObject({ potentialDuplicate: true });
    expect(reviewSignalsFromPacket({ needsReview: true })).toMatchObject({ needsReview: true });
    expect(reviewSignalsFromPacket({ lateEntry: true, anomaly: true, potentialDuplicate: true, needsReview: true }))
      .toEqual({ lateEntry: true, anomaly: true, potentialDuplicate: true, needsReview: true });
  });

  test('only an explicit true counts — missing/other values are false (defensive)', () => {
    expect(reviewSignalsFromPacket(null)).toEqual({ lateEntry: false, anomaly: false, potentialDuplicate: false, needsReview: false });
    expect(reviewSignalsFromPacket(undefined)).toMatchObject({ lateEntry: false });
    expect(reviewSignalsFromPacket({})).toEqual({ lateEntry: false, anomaly: false, potentialDuplicate: false, needsReview: false });
    // A current-production packet carries no review fields → all false → compatible.
    expect(reviewSignalsFromPacket({ dateTimeUTC: 'x', bblsTaken: 5 })).toEqual({ lateEntry: false, anomaly: false, potentialDuplicate: false, needsReview: false });
    // Truthy-but-not-true values do NOT trip a badge.
    expect(reviewSignalsFromPacket({ lateEntry: 'true' as unknown as boolean }).lateEntry).toBe(false);
    expect(reviewSignalsFromPacket({ anomaly: 1 as unknown as boolean }).anomaly).toBe(false);
  });
});

describe('hasReviewSignals — badge visibility', () => {
  test('each individual review tag makes the badge row visible', () => {
    expect(hasReviewSignals({ lateEntry: true })).toBe(true);
    expect(hasReviewSignals({ anomaly: true })).toBe(true);
    expect(hasReviewSignals({ potentialDuplicate: true })).toBe(true);
    expect(hasReviewSignals({ needsReview: true })).toBe(true);
  });

  test('absent tags → no badge row (row renders unchanged)', () => {
    expect(hasReviewSignals({})).toBe(false);
    expect(hasReviewSignals(null)).toBe(false);
    expect(hasReviewSignals(undefined)).toBe(false);
    expect(hasReviewSignals({ lateEntry: false, anomaly: false, potentialDuplicate: false, needsReview: false })).toBe(false);
  });
});
