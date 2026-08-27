// Single-owner keypad slot geometry: base keypad height + bottom safe-area
// inset, added exactly once, so the bottom key row clears the nav/gesture bar.
import {
  getEffectiveBottomClearance,
  getMeasurementSlotGeometry,
  MEASUREMENT_KEYPAD_HEIGHT,
} from '../measurementKeypadLayout';

describe('getEffectiveBottomClearance', () => {
  it('both candidates zero → 0', () => {
    expect(getEffectiveBottomClearance(0, 0)).toBe(0);
  });

  it('live inset only (nav bar shown; no captured initial)', () => {
    expect(getEffectiveBottomClearance(34, 0)).toBe(34);
    expect(getEffectiveBottomClearance(34, undefined)).toBe(34);
  });

  it('initial/protected inset only (immersive: live is 0)', () => {
    expect(getEffectiveBottomClearance(0, 126)).toBe(126);
  });

  it('both present → the LARGER wins, never the sum', () => {
    expect(getEffectiveBottomClearance(34, 126)).toBe(126); // not 160
    expect(getEffectiveBottomClearance(126, 34)).toBe(126); // not 160
  });

  it('equal values are counted once', () => {
    expect(getEffectiveBottomClearance(48, 48)).toBe(48); // not 96
  });

  it('missing / non-finite / negative values clamp to 0', () => {
    expect(getEffectiveBottomClearance(undefined, null)).toBe(0);
    expect(getEffectiveBottomClearance(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0);
    expect(getEffectiveBottomClearance(-10, -5)).toBe(0);
    expect(getEffectiveBottomClearance(-10, 24)).toBe(24); // negative ignored, positive kept
  });

  it('feeds the slot geometry so the effective inset is applied exactly once', () => {
    const effective = getEffectiveBottomClearance(0, 126); // immersive S24 case
    const g = getMeasurementSlotGeometry(effective);
    expect(g.safeAreaPadding).toBe(126);
    expect(g.reservedHeight).toBe(MEASUREMENT_KEYPAD_HEIGHT + 126);
    expect(g.entryTranslateY).toBe(MEASUREMENT_KEYPAD_HEIGHT + 126);
    // Exactly once: reserved − base == effective, not 2×.
    expect(g.reservedHeight - MEASUREMENT_KEYPAD_HEIGHT).toBe(126);
    // Genuine zero-inset device keeps the base geometry unchanged.
    const z = getMeasurementSlotGeometry(getEffectiveBottomClearance(0, 0));
    expect(z.reservedHeight).toBe(MEASUREMENT_KEYPAD_HEIGHT);
    expect(z.safeAreaPadding).toBe(0);
  });
});

describe('getMeasurementSlotGeometry', () => {
  it('#7 zero bottom inset preserves the base keypad geometry', () => {
    const g = getMeasurementSlotGeometry(0);
    expect(g.keypadHeight).toBe(MEASUREMENT_KEYPAD_HEIGHT);
    expect(g.safeAreaPadding).toBe(0);
    expect(g.reservedHeight).toBe(MEASUREMENT_KEYPAD_HEIGHT);   // unchanged base
    expect(g.entryTranslateY).toBe(MEASUREMENT_KEYPAD_HEIGHT);
  });

  it('#8 nonzero inset increases the reserved/effective area by the inset — exactly once', () => {
    const inset = 48; // typical Android gesture bar
    const g = getMeasurementSlotGeometry(inset);
    expect(g.safeAreaPadding).toBe(inset);
    expect(g.reservedHeight).toBe(MEASUREMENT_KEYPAD_HEIGHT + inset);
    expect(g.entryTranslateY).toBe(MEASUREMENT_KEYPAD_HEIGHT + inset);
    // Exactly once: the delta over base equals the inset, never 2×.
    expect(g.reservedHeight - MEASUREMENT_KEYPAD_HEIGHT).toBe(inset);
  });

  it('#9 bottom keys clear the inset across devices (Android + iOS values)', () => {
    for (const inset of [0, 16, 24, 34, 48, 59]) {
      const g = getMeasurementSlotGeometry(inset);
      expect(g.safeAreaPadding).toBe(inset);                     // padding below the keys == inset
      expect(g.reservedHeight).toBe(g.keypadHeight + g.safeAreaPadding); // reserved agrees with visible
    }
  });

  it('clamps invalid / negative insets to zero (never shrinks the base geometry)', () => {
    expect(getMeasurementSlotGeometry(-10).safeAreaPadding).toBe(0);
    expect(getMeasurementSlotGeometry(Number.NaN).safeAreaPadding).toBe(0);
    expect(getMeasurementSlotGeometry(-10).reservedHeight).toBe(MEASUREMENT_KEYPAD_HEIGHT);
  });
});
