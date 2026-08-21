import { packetShowsEditBadge, hasEditedMarkerWithoutDetail, selectVisibleHistoryPackets, confirmNewSecureEdit } from '../editMarkers';

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
  test('wasEdited and numeric editedAt badge', () => {
    expect(packetShowsEditBadge({ wasEdited: true })).toBe(true);
    expect(packetShowsEditBadge({ editedAt: 1_700_000_000_000 })).toBe(true);
  });
  test('new secure edit confirms only from the three allowed proofs', () => {
    expect(confirmNewSecureEdit({ editedAt: '2026-08-16T00:00:00.000Z', wasEdited: true, isEdit: true } as any)).toBe(false);
    expect(confirmNewSecureEdit({ requestType: 'edit', editedByPacketId: 'x' } as any)).toBe(false);
    expect(confirmNewSecureEdit({ editCommitted: true })).toBe(false);
    expect(confirmNewSecureEdit({ editCommitted: true, editCommittedReceiptKey: '' })).toBe(false);
    expect(confirmNewSecureEdit({ editCommitted: false, editCommittedReceiptKey: 'receipt_abc' })).toBe(false);
    expect(confirmNewSecureEdit({
      editCommitted: true,
      editCommittedReceiptKey: 'receipt_abc',
    })).toBe(true);
    expect(confirmNewSecureEdit({ committed: true })).toBe(true);
    expect(confirmNewSecureEdit({ status: 'committed' })).toBe(true);
    expect(confirmNewSecureEdit({ status: 'pending' })).toBe(false);
    expect(confirmNewSecureEdit(null)).toBe(false);
  });
});

describe('pull → edit → history (edited badge remains visible)', () => {
  test('one visible load after edit, with the edited badge', () => {
    const processed: Record<string, Record<string, unknown>> = {
      '20260816_120000_Gab1_abc': {
        requestType: 'pull',
        wellName: 'Gab 1',
        companyId: 'liquid-gold',
        tankLevelFeet: 10,
        bblsTaken: 80,
        wasEdited: true,
        editedAt: '2026-08-16T18:00:00.000Z',
        isEdit: true,
      },
    };
    const visible = selectVisibleHistoryPackets(processed);
    expect(visible).toHaveLength(1);
    expect(visible[0].edited).toBe(true);
    expect(packetShowsEditBadge(visible[0].data)).toBe(true);
  });

  test('deleted rows disappear; unscoped other-company rows are filtered by caller', () => {
    const visible = selectVisibleHistoryPackets({
      keep: { requestType: 'pull', deleted: false, wasEdited: false },
      gone: { requestType: 'pull', deleted: true },
    });
    expect(visible.map((r) => r.packetId)).toEqual(['keep']);
  });
});
