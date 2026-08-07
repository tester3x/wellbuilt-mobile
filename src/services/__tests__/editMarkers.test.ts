import {
  packetShowsEditBadge,
  WBM_HAS_EDIT_DEADLINE,
  WBT_TICKET_EDIT_WINDOW_HOURS,
} from '../editMarkers';

describe('product boundary: WB-M vs WB-T', () => {
  test('WB-M has no edit deadline', () => {
    expect(WBM_HAS_EDIT_DEADLINE).toBe(false);
  });
  test('WB-T 24h is a documentation pin only', () => {
    expect(WBT_TICKET_EDIT_WINDOW_HOURS).toBe(24);
  });
});

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
