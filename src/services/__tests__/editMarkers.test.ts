import { packetShowsEditBadge, hasEditedMarkerWithoutDetail } from '../editMarkers';

describe('packetShowsEditBadge (badge-only tranche)', () => {
  test('modern editedAt badges (e.g. Mikezfold rows)', () => {
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
  test('local status edited badges', () => {
    expect(packetShowsEditBadge({ status: 'edited' })).toBe(true);
  });
  test('unedited does not badge', () => {
    expect(packetShowsEditBadge({ requestType: 'pull', bblsTaken: 140 } as any)).toBe(false);
  });
  test('historical fallback applies whenever badge is true', () => {
    expect(hasEditedMarkerWithoutDetail({ editedAt: '2026-08-05T20:23:43.299Z' })).toBe(true);
  });
});
