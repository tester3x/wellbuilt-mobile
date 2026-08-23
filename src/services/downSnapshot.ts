/**
 * Atomic per-well render snapshot: level, DOWN, flow, pull metadata.
 * DOWN packets must never store 0' when a valid lastPullBottomLevel exists.
 */

export function parseLevelToFeet(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const str = String(raw).trim();
  if (!str || str === 'Unknown' || str === 'N/A') return undefined;
  const lower = str.toLowerCase();
  if (lower === 'down' || lower === 'offline' || lower === 'shut in') return undefined;
  const match = str.match(/^(\d+)\s*'\s*(\d+)?\"?$/);
  if (!match) return undefined;
  const ft = Number(match[1]);
  const inches = match[2] != null && match[2] !== '' ? Number(match[2]) : 0;
  if (!Number.isFinite(ft) || !Number.isFinite(inches)) return undefined;
  return ft + inches / 12;
}

export function isDownLevelToken(raw: string | undefined | null): boolean {
  const str = (raw ?? '').trim().toLowerCase();
  return str === 'down' || str === 'offline' || str === 'shut in';
}

export function resolveSnapshotLevelFeet(input: {
  isDown: boolean;
  currentLevel?: string;
  lastPullBottomLevel?: string;
  previousLevelFeet?: number;
  previousBottomFeet?: number;
}): number {
  const fromCurrent = parseLevelToFeet(input.currentLevel);
  const fromBottom = parseLevelToFeet(input.lastPullBottomLevel);
  const prevBottom =
    typeof input.previousBottomFeet === 'number' && input.previousBottomFeet > 0
      ? input.previousBottomFeet
      : undefined;
  const prevLevel =
    typeof input.previousLevelFeet === 'number' && input.previousLevelFeet > 0
      ? input.previousLevelFeet
      : undefined;

  if (input.isDown) {
    if (fromBottom != null && fromBottom > 0) return fromBottom;
    if (fromCurrent != null && fromCurrent > 0) return fromCurrent;
    if (prevBottom != null) return prevBottom;
    if (prevLevel != null) return prevLevel;
    return 0;
  }

  if (fromCurrent != null && fromCurrent > 0) return fromCurrent;
  if (fromBottom != null && fromBottom > 0) return fromBottom;
  return prevLevel ?? 0;
}

export function startingLevelFromSnapshot(snapshot: {
  lastPullBottomLevelFeet?: number;
  levelFeet?: number;
}): number {
  const bottom = snapshot.lastPullBottomLevelFeet;
  if (typeof bottom === 'number' && bottom > 0) return bottom;
  const level = snapshot.levelFeet;
  if (typeof level === 'number' && level > 0) return level;
  if (typeof bottom === 'number' && bottom === 0 && typeof level === 'number') return level;
  return typeof level === 'number' ? level : 0;
}

export type WellRenderSnapshot = {
  wellName: string;
  levelFeet: number;
  isDown: boolean;
  unavailable: boolean;
  flowRate?: string;
  flowRateMinutes?: number;
  lastPullDateTime?: string;
  lastPullDateTimeUTC?: string;
  lastPullBbls?: number;
  lastPullTopLevel?: string;
  lastPullBottomLevel?: string;
  lastPullBottomLevelFeet?: number;
  lastPullPacketId?: string;
  timestamp: number;
  revision: string;
};

export function buildWellRenderSnapshot(input: {
  wellName: string;
  isDown: boolean;
  unavailable?: boolean;
  currentLevel?: string;
  lastPullBottomLevel?: string;
  lastPullTopLevel?: string;
  lastPullDateTime?: string;
  lastPullDateTimeUTC?: string;
  lastPullBbls?: number;
  lastPullPacketId?: string;
  flowRate?: string;
  flowRateMinutes?: number;
  timestamp: number;
  previous?: {
    levelFeet?: number;
    lastPullBottomLevelFeet?: number;
  };
}): WellRenderSnapshot {
  const levelFeet = resolveSnapshotLevelFeet({
    isDown: input.isDown,
    currentLevel: input.currentLevel,
    lastPullBottomLevel: input.lastPullBottomLevel,
    previousLevelFeet: input.previous?.levelFeet,
    previousBottomFeet: input.previous?.lastPullBottomLevelFeet,
  });
  const bottomFeet = parseLevelToFeet(input.lastPullBottomLevel) ?? (input.isDown ? levelFeet : undefined);
  const revision = input.lastPullPacketId
    || `${input.timestamp}:${input.isDown ? 'down' : 'up'}:${levelFeet}`;
  return {
    wellName: input.wellName,
    levelFeet,
    isDown: input.isDown,
    unavailable: input.unavailable === true,
    flowRate: input.flowRate,
    flowRateMinutes: input.flowRateMinutes,
    lastPullDateTime: input.lastPullDateTime,
    lastPullDateTimeUTC: input.lastPullDateTimeUTC,
    lastPullBbls: input.lastPullBbls,
    lastPullTopLevel: input.lastPullTopLevel,
    lastPullBottomLevel: input.lastPullBottomLevel,
    lastPullBottomLevelFeet: bottomFeet,
    lastPullPacketId: input.lastPullPacketId,
    timestamp: input.timestamp,
    revision,
  };
}
