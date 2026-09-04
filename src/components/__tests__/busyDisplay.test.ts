import { busyDisplayState, busyLabelFor } from '../busyDisplay';

const DELAY = 200;
const LONG = 5000;

describe('busyDisplayState — delayed-display + long-running thresholds', () => {
  test('not visible → always hidden', () => {
    expect(busyDisplayState(false, 0, DELAY, LONG)).toBe('hidden');
    expect(busyDisplayState(false, 10_000, DELAY, LONG)).toBe('hidden');
  });

  test('visible but before the delay threshold → hidden (no flash)', () => {
    expect(busyDisplayState(true, 0, DELAY, LONG)).toBe('hidden');
    expect(busyDisplayState(true, DELAY - 1, DELAY, LONG)).toBe('hidden');
  });

  test('at/after the delay threshold → shown', () => {
    expect(busyDisplayState(true, DELAY, DELAY, LONG)).toBe('shown');
    expect(busyDisplayState(true, LONG - 1, DELAY, LONG)).toBe('shown');
  });

  test('at/after the long-running threshold → shownLong', () => {
    expect(busyDisplayState(true, LONG, DELAY, LONG)).toBe('shownLong');
    expect(busyDisplayState(true, LONG + 10_000, DELAY, LONG)).toBe('shownLong');
  });

  test('a fast operation completing before delay never reaches a shown phase', () => {
    // Operation ran 150ms then settled → visible flips false.
    expect(busyDisplayState(true, 150, DELAY, LONG)).toBe('hidden');
    expect(busyDisplayState(false, 150, DELAY, LONG)).toBe('hidden');
  });
});

describe('busyLabelFor — stable label, swaps only when long', () => {
  test('shown uses the base label even if a long label exists', () => {
    expect(busyLabelFor('shown', 'Sending pull…', 'Still sending…')).toBe('Sending pull…');
  });
  test('shownLong uses the long label when provided', () => {
    expect(busyLabelFor('shownLong', 'Sending pull…', 'Still sending…')).toBe('Still sending…');
  });
  test('shownLong falls back to base label when no long label', () => {
    expect(busyLabelFor('shownLong', 'Saving edit…')).toBe('Saving edit…');
  });
  test('hidden returns the base label (unused while hidden)', () => {
    expect(busyLabelFor('hidden', 'Saving edit…', 'Still saving…')).toBe('Saving edit…');
  });
});
