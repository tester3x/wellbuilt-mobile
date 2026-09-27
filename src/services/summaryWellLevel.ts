/** Display-only summary projection. DOWN freezes the water already in the tanks. */
export interface SummaryLevelInput {
  levelFeet: number;
  flowRateMinutes: number;
  snapshotTimestamp: number;
  isDown: boolean;
}

export function summaryCurrentLevel(well: SummaryLevelInput, now = Date.now()): number {
  const base = Math.max(0, Math.min(well.levelFeet, 20));
  if (well.isDown || well.flowRateMinutes <= 0) return base;
  if (well.snapshotTimestamp < Date.UTC(2024, 0, 1) || well.snapshotTimestamp > now) return base;
  const minutes = (now - well.snapshotTimestamp) / 60000;
  return Math.min(base + minutes / well.flowRateMinutes, 20);
}

export function summaryLevelAtTime(well: SummaryLevelInput, hours: number, now = Date.now()): number {
  const current = summaryCurrentLevel(well, now);
  if (well.isDown || well.flowRateMinutes <= 0) return current;
  return Math.min(current + Math.max(0, hours) * 60 / well.flowRateMinutes, 20);
}
