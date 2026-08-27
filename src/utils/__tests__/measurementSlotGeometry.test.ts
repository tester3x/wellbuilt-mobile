// Single-owner keypad slot geometry: base keypad height + bottom safe-area
// inset, added exactly once, so the bottom key row clears the nav/gesture bar.
import { getMeasurementSlotGeometry, MEASUREMENT_KEYPAD_HEIGHT } from '../measurementKeypadLayout';

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
