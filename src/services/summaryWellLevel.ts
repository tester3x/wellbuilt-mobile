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

export function summaryReadyLevel(
  well: { allowedBottom?: number; numTanks?: number },
  pullBbls = 140,
): number {
  const tanks = Math.max(1, well.numTanks || 1);
  const bottom = typeof well.allowedBottom === 'number' ? well.allowedBottom : 1.33;
  const feetNeeded = pullBbls / (20 * tanks);
  return bottom + feetNeeded;
}

export function summaryBblsAvailable(
  well: SummaryLevelInput & { loadLine?: number; numTanks?: number },
  now = Date.now(),
): number {
  const current = summaryCurrentLevel(well, now);
  const loadLine = typeof well.loadLine === 'number' ? well.loadLine : 1.33;
  const tanks = Math.max(1, well.numTanks || 1);
  const feetAbove = Math.max(0, current - loadLine);
  return Math.round(feetAbove * 20 * tanks);
}

export function summaryTimeAtLevel(
  well: SummaryLevelInput,
  targetFeet: number,
  now = Date.now(),
): Date | null {
  const current = summaryCurrentLevel(well, now);
  if (current >= targetFeet) return new Date(now);
  if (well.isDown || well.flowRateMinutes <= 0) return null;
  const feetToGo = targetFeet - current;
  const minutesToGo = feetToGo * well.flowRateMinutes;
  return new Date(now + minutesToGo * 60000);
}

export function summaryTimeWhenBecameReady(
  well: SummaryLevelInput,
  readyLevel: number,
  now = Date.now(),
): Date | null {
  if (well.isDown || well.flowRateMinutes <= 0) return null;
  const current = summaryCurrentLevel(well, now);
  if (current < readyLevel) return null;
  const feetAbove = current - readyLevel;
  const minutesAgo = feetAbove * well.flowRateMinutes;
  return new Date(now - minutesAgo * 60000);
}

export function formatFeetInches(feet: number): string {
  if (feet < 0) feet = 0;
  const totalInches = Math.floor(feet * 12 + 0.0001);
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (inches === 0) return `${ft}'`;
  return `${ft}'${inches}"`;
}

export function formatReadyTimeDisplay(
  well: SummaryLevelInput & { allowedBottom?: number; numTanks?: number },
  pullBbls = 140,
  now = Date.now(),
): { time: string; subText: string; isReady: boolean } {
  if (well.isDown) {
    const current = summaryCurrentLevel(well, now);
    const readyLevel = summaryReadyLevel(well, pullBbls);
    const isReady = current >= readyLevel;
    return {
      time: isReady ? 'Ready' : 'DOWN',
      subText: isReady ? 'DOWN' : '',
      isReady,
    };
  }

  const current = summaryCurrentLevel(well, now);
  const readyLevel = summaryReadyLevel(well, pullBbls);
  const isReady = current >= readyLevel;

  let targetDate: Date | null;
  if (isReady) {
    targetDate = summaryTimeWhenBecameReady(well, readyLevel, now);
  } else {
    targetDate = summaryTimeAtLevel(well, readyLevel, now);
  }

  if (!targetDate) {
    return { time: '--', subText: '', isReady };
  }

  const nowDate = new Date(now);
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);

  const hours = targetDate.getHours();
  const minutes = targetDate.getMinutes();
  const ampm = hours >= 12 ? 'p' : 'a';
  const displayHours = hours % 12 || 12;
  const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')}${ampm}`;

  if (targetDate.toDateString() === nowDate.toDateString()) {
    return { time: timeStr, subText: isReady ? 'Ready' : 'Today', isReady };
  } else if (targetDate.toDateString() === tomorrowDate.toDateString()) {
    return { time: timeStr, subText: 'Tomorrow', isReady };
  } else {
    return {
      time: timeStr,
      subText: `${targetDate.getMonth() + 1}/${targetDate.getDate()}`,
      isReady,
    };
  }
}
