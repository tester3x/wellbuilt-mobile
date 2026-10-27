/** Saved physical height; older catalogues without a valid height retain 20 ft. */
export function resolveTankHeight(value: unknown): number {
  const height = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(height) && height > 0 ? height : 20;
}

export function clampTankLevel(feet: number, height: unknown): number {
  return Math.max(0, Math.min(Number.isFinite(feet) ? feet : 0, resolveTankHeight(height)));
}

export function tankFillFraction(feet: number, height: unknown): number {
  return clampTankLevel(feet, height) / resolveTankHeight(height);
}
