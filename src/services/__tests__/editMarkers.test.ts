import {
  packetShowsEditBadge,
  isWithinEditWindow,
  EDIT_WINDOW_MS,
} from '../editMarkers';

describe('packetShowsEditBadge', () => {
  test('modern editedAt badges (Mikezfold-style)', () => {
    expect(packetShowsEditBadge({ editedAt: '2026-08-07T15:20:07.000Z' })).toBe(true);
  });
  test('editCount badges', () => {
    expect(packetShowsEditBadge({ editCount: 2 })).toBe(true);
  });
  test('legacy isEdit badges', () => {
    expect(packetShowsEditBadge({ isEdit: true })).toBe(true);
  });
  test('legacy requestType edit badges', () => {
    expect(packetShowsEditBadge({ requestType: 'edit' })).toBe(true);
  });
  test('local history status edited badges', () => {
    expect(packetShowsEditBadge({ status: 'edited' })).toBe(true);
  });
  test('unedited does not badge', () => {
    expect(packetShowsEditBadge({ requestType: 'pull', bblsTaken: 140 } as any)).toBe(false);
  });
});

describe('isWithinEditWindow', () => {
  const origin = '2026-08-01T12:00:00.000Z';
  const originMs = Date.parse(origin);
  test('hour 23 allowed', () => {
    expect(isWithinEditWindow(origin, originMs + 23 * 3600 * 1000)).toBe(true);
  });
  test('after 24h rejected', () => {
    expect(isWithinEditWindow(origin, originMs + EDIT_WINDOW_MS + 1)).toBe(false);
  });
});
