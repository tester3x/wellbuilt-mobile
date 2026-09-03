import {
  feetInchesToFeet,
  tankTopInchesFromFeet,
  deriveBottomInches,
  deriveBottomInchesFromFeet,
  formatInchesToFeetInches,
  resolveWellDownForEdit,
  diffEditedFields,
  normalizeDraft,
  finalizeEdit,
  type OriginalSnapshot,
  type EditFormDraft,
} from '../wbmEditForm';

// Gabriel 4 authoritative original: 11'10" (11.8333 ft), 150 bbl, Running, bblPerFoot 20.
const BPF = 20;
const G4_ORIGINAL: OriginalSnapshot = {
  tankLevelFeet: 11 + 10 / 12,
  bblsTaken: 150,
  wellDown: false,
  dateTimeUTC: '2026-09-02T20:55:49.696Z',
  dateTime: '9/2/2026 3:55 PM',
};

const draft = (over: Partial<EditFormDraft> = {}): EditFormDraft => ({
  topFeet: 11,
  topInches: 10,
  bbls: 150,
  dateTimeUTC: G4_ORIGINAL.dateTimeUTC,
  dateTime: G4_ORIGINAL.dateTime,
  wellDown: false,
  wellDownTouched: false,
  ...over,
});

describe('shared derived-bottom calc — mirrors server tankFormulas exactly', () => {
  test('Gabriel 4 pin: 11\'10" + 170 bbl @ 20 bbl/ft → 40" = 3\'4"', () => {
    const top = tankTopInchesFromFeet(feetInchesToFeet(11, 10));
    expect(top).toBeCloseTo(142, 6);
    const bottom = deriveBottomInches(top, 170, BPF);
    expect(bottom).toBeCloseTo(40, 6);
    expect(formatInchesToFeetInches(bottom)).toBe("3'4\"");
  });

  test('original 150 bbl → 52" = 4\'4" (matches server tankAfterInches 52)', () => {
    expect(deriveBottomInchesFromFeet(feetInchesToFeet(11, 10), 150, BPF)).toBeCloseTo(52, 6);
  });

  test('literal-zero bbls → bottom equals full top (no pull), not NaN', () => {
    expect(deriveBottomInchesFromFeet(10, 0, BPF)).toBe(120);
  });

  test('formatInchesToFeetInches rounding carry (143.6" → 12\'0")', () => {
    expect(formatInchesToFeetInches(143.6)).toBe("12'0\"");
  });
});

describe('Well-Down authority (edit path)', () => {
  test('untouched → non-authoritative, canonical value, NOT changed', () => {
    const r = resolveWellDownForEdit(draft({ wellDownTouched: false, wellDown: true /* ignored */ }), G4_ORIGINAL);
    expect(r).toEqual({ wellDown: false, wellDownIsAuthoritative: false, changed: false });
  });
  test('explicit true (from false) → authoritative, own boolean, changed', () => {
    const r = resolveWellDownForEdit(draft({ wellDownTouched: true, wellDown: true }), G4_ORIGINAL);
    expect(r).toEqual({ wellDown: true, wellDownIsAuthoritative: true, changed: true });
  });
  test('explicit false stays its own property when it differs from original(true)', () => {
    const r = resolveWellDownForEdit(draft({ wellDownTouched: true, wellDown: false }), { ...G4_ORIGINAL, wellDown: true });
    expect(r).toEqual({ wellDown: false, wellDownIsAuthoritative: true, changed: true });
  });
  test('toggled away and back to original → non-authoritative, NOT changed', () => {
    const r = resolveWellDownForEdit(draft({ wellDownTouched: true, wellDown: false }), G4_ORIGINAL);
    expect(r).toEqual({ wellDown: false, wellDownIsAuthoritative: false, changed: false });
  });
});

describe('Well-Down edit path — directive scenarios', () => {
  test('concurrent server status change while form open: untouched stays NON-authoritative (server preserves canonical)', () => {
    // Original said Online; suppose the well went Down on the server meanwhile.
    // An untouched checkbox must not fight that — it asserts no authority, so the
    // server keeps whatever canonical is at apply time.
    const r = resolveWellDownForEdit(draft({ wellDownTouched: false, wellDown: false }), G4_ORIGINAL);
    expect(r.wellDownIsAuthoritative).toBe(false);
    expect(r.changed).toBe(false);
  });

  test('offline persistence/restart: finalize is deterministic — same draft+original ⇒ same authority + mask', () => {
    const mk = () => finalizeEdit({ draft: draft({ wellDownTouched: true, wellDown: true }), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'e' });
    const a = mk();
    const b = mk(); // as if re-finalized after an app restart from the persisted draft
    expect(a.wellDownIsAuthoritative).toBe(b.wellDownIsAuthoritative);
    expect(a.editedFields).toEqual(b.editedFields);
    expect(a.canonicalString).toBe(b.canonicalString);
    expect(a.editedFields).toContain('wellDown');
  });

  test('final keypad digit then Done then immediate Save: finalize consumes the flushed values', () => {
    // The keypad flush hands finalize the final level + a Well-Down toggle in one Save.
    const f = finalizeEdit({ draft: draft({ topFeet: 12, topInches: 3, wellDownTouched: true, wellDown: true }), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'e' });
    expect([...f.editedFields].sort()).toEqual(['tankLevelFeet', 'wellDown']);
    expect(f.wellDownIsAuthoritative).toBe(true);
  });
});

describe('changed-only mask — canonical, one entry per logical dimension', () => {
  test('the Gabriel 4 edit (bbls 150→170 only) → exactly [bblsTaken]', () => {
    const f = finalizeEdit({ draft: draft({ bbls: 170 }), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'editevt_g4' });
    expect(f.editedFields).toEqual(['bblsTaken']);
    expect(f.changes).toEqual([{ field: 'bblsTaken', previous: 150, next: 170 }]);
    expect(f.hasChanges).toBe(true);
    expect(f.bottomInches).toBeCloseTo(40, 6);
    expect(f.wellDownIsAuthoritative).toBe(false);
  });

  test('feet AND inches both entered → ONE tankLevelFeet entry, never duplicated', () => {
    const f = finalizeEdit({ draft: draft({ topFeet: 12, topInches: 3 }), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'e' });
    expect(f.editedFields.filter((x) => x === 'tankLevelFeet')).toHaveLength(1);
    expect(f.editedFields).toEqual(['tankLevelFeet']);
  });

  test('date AND time both changed → ONE dateTimeUTC entry, never duplicated', () => {
    const f = finalizeEdit({ draft: draft({ dateTimeUTC: '2026-09-03T22:10:00.000Z', dateTime: '9/3/2026 5:10 PM' }), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'e' });
    expect(f.editedFields).toEqual(['dateTimeUTC']);
  });

  test('literal-zero bbls IS a change (150 → 0) and appears in the mask', () => {
    const f = finalizeEdit({ draft: draft({ bbls: 0 }), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'e' });
    expect(f.editedFields).toEqual(['bblsTaken']);
    expect(f.changes[0]).toEqual({ field: 'bblsTaken', previous: 150, next: 0 });
  });

  test('change then restore to original value → NO edit for that field', () => {
    // top re-entered as the same 11'10", bbls back to 150
    const f = finalizeEdit({ draft: draft({ topFeet: 11, topInches: 10, bbls: 150 }), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'e' });
    expect(f.editedFields).toEqual([]);
    expect(f.hasChanges).toBe(false);
  });

  test('no-change Save → hasChanges false (caller creates no op/marker/request)', () => {
    const f = finalizeEdit({ draft: draft(), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'e' });
    expect(f.hasChanges).toBe(false);
    expect(f.editedFields).toEqual([]);
  });

  test('derived bottom is NEVER a mask field even when it moves', () => {
    const f = finalizeEdit({ draft: draft({ bbls: 170 }), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'e' });
    expect(f.editedFields).not.toContain('tankAfterInches');
    expect(f.editedFields).not.toContain('bottomInches');
  });

  test('backdated timestamp (earlier than original) → dateTimeUTC change detected', () => {
    const f = finalizeEdit({ draft: draft({ dateTimeUTC: '2026-08-30T12:00:00.000Z' }), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'e' });
    expect(f.editedFields).toEqual(['dateTimeUTC']);
  });
});

describe('64-combination matrix — six toggles collapse to the canonical mask', () => {
  // Six independent input toggles: feet, inches, bbls, date, time, wellDown.
  // Canonical collapse: feet||inches → tankLevelFeet; date||time → dateTimeUTC.
  const DAY = '2026-09-03';
  const bit = (n: number, i: number) => (n >> i) & 1;

  for (let combo = 0; combo < 64; combo++) {
    const cFeet = bit(combo, 0);
    const cInch = bit(combo, 1);
    const cBbl = bit(combo, 2);
    const cDate = bit(combo, 3);
    const cTime = bit(combo, 4);
    const cDown = bit(combo, 5);

    test(`combo ${combo}: feet=${cFeet} inch=${cInch} bbl=${cBbl} date=${cDate} time=${cTime} down=${cDown}`, () => {
      // Build a dateTimeUTC that differs when date and/or time toggles are set.
      const origDate = '2026-09-02';
      const origTime = 'T20:55:49.696Z';
      const nextDate = cDate ? DAY : origDate;
      const nextTime = cTime ? 'T22:10:00.000Z' : origTime;
      const dateTimeUTC = `${nextDate}${nextTime}`;

      const d = draft({
        topFeet: cFeet ? 12 : 11,
        topInches: cInch ? 3 : 10,
        bbls: cBbl ? 170 : 150,
        dateTimeUTC,
        wellDown: cDown ? true : false,
        wellDownTouched: cDown === 1,
      });
      const f = finalizeEdit({ draft: d, original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: `e${combo}` });

      const expected: string[] = [];
      if (cFeet || cInch) expected.push('tankLevelFeet'); // feet AND/OR inches → ONE entry
      if (cBbl) expected.push('bblsTaken');
      if (cDate || cTime) expected.push('dateTimeUTC'); // date AND/OR time → ONE entry
      if (cDown) expected.push('wellDown');

      expect([...f.editedFields].sort()).toEqual([...expected].sort());
      // no duplicates, ever
      expect(new Set(f.editedFields).size).toBe(f.editedFields.length);
      expect(f.hasChanges).toBe(expected.length > 0);
      // Well-Down authority tracks the mask exactly.
      expect(f.wellDownIsAuthoritative).toBe(cDown === 1);
    });
  }
});

describe('finalize idempotency (digest input) — same edit hashes identically, changed edit differs', () => {
  test('same logical edit → identical canonicalString; different value → different', () => {
    const a = finalizeEdit({ draft: draft({ bbls: 170 }), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'e' });
    const b = finalizeEdit({ draft: draft({ bbls: 170 }), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'e' });
    const c = finalizeEdit({ draft: draft({ bbls: 171 }), original: G4_ORIGINAL, bblPerFoot: BPF, editEventId: 'e' });
    expect(a.canonicalString).toBe(b.canonicalString);
    expect(a.canonicalString).not.toBe(c.canonicalString);
  });
});

describe('normalizeDraft — float-drift-free feet/inches', () => {
  test('11\'10" reconstructs the exact original float → stable no-op, exact 142" top', () => {
    const n = normalizeDraft(draft());
    expect(n.tankLevelFeet).toBe(11 + 10 / 12); // full precision, matches stored original
    expect(n.tankTopInches).toBe(142);          // exact inches for the bottom calc
    const noDiff = diffEditedFields(n, G4_ORIGINAL, { wellDown: false, wellDownIsAuthoritative: false, changed: false });
    expect(noDiff.editedFields).toEqual([]);
  });
});
