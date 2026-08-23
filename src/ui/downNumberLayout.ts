/**
 * DOWN-only numeric label position. Normal wells keep waterline tracking.
 * The 3'4" field example sits at the low interior clamp; DOWN uses that
 * same lower safe lane so the digits stay below the center DOWN word and
 * clear of the red X legs, tank badge, and barrel text.
 */

export const DOWN_NUMBER_INTERIOR_FRACTION = 0.75;

export function downNumberTopPx(interiorHeight: number, numberOffset: number): number {
  return interiorHeight * DOWN_NUMBER_INTERIOR_FRACTION - numberOffset;
}

export function waterlineNumberTopPx(
  interiorHeight: number,
  waterFraction: number,
  numberOffset: number,
): number {
  const waterTop = interiorHeight * (1 - waterFraction);
  const clampedTop = Math.max(interiorHeight * 0.15, Math.min(interiorHeight * 0.75, waterTop));
  return clampedTop - numberOffset;
}

export function numberTopForTank(input: {
  isDown: boolean;
  interiorHeight: number;
  waterFraction: number;
  numberOffset: number;
}): number {
  if (input.isDown) {
    return downNumberTopPx(input.interiorHeight, input.numberOffset);
  }
  return waterlineNumberTopPx(input.interiorHeight, input.waterFraction, input.numberOffset);
}
