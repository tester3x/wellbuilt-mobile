import type { TankConfig } from '../services/tankInfo';
export const tankInfoNumbers = ['totalTanks', 'activeTanks', 'tankHeight', 'tankDiameter', 'tankCapacity',
  'perTankBblPerFoot', 'loadLine', 'allowedBottom'] as const;
const feetFields = new Set(['tankHeight', 'tankDiameter', 'loadLine', 'allowedBottom']);
export function dimensionFeet(text: string): number {
  const trimmed = text.trim().replace(/[′’]/g, "'").replace(/[″“”]/g, '"');
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const match = trimmed.match(/^(\d+)(?:'\s*|\s+)(\d+(?:\.\d+)?)"?$/);
  if (!match || Number(match[2]) >= 12) throw Error('invalid_dimension');
  return Number(match[1]) + Number(match[2]) / 12;
}
export function editableTankConfig(config: TankConfig): TankConfig {
  const active = config.activeTanks ?? config.numTanks ?? config.tanks;
  const perTank = config.perTankBblPerFoot ?? (Number(config.bblPerFoot) > 0 && Number(active) > 0
    ? Number(config.bblPerFoot) / Number(active) : undefined);
  return { ...config, activeTanks: active, totalTanks: config.totalTanks ?? active,
    perTankBblPerFoot: perTank, h2sStatus: config.h2sStatus ?? 'unknown', tankNotes: config.tankNotes ?? '' };
}
export function tankInfoDraft(config: TankConfig): Record<string, string> {
  const values = editableTankConfig(config);
  return Object.fromEntries([...tankInfoNumbers, 'h2sStatus', 'tankNotes'].map(key => [key, String(values[key] ?? '')]));
}
export function tankInfoChanges(config: TankConfig, draft: Record<string, string>): TankConfig {
  const original = editableTankConfig(config), patch: TankConfig = {};
  for (const key of tankInfoNumbers) {
    const text = draft[key]?.trim(); if (!text) continue;
    if (!feetFields.has(key) && !/^\d+(?:\.\d+)?$/.test(text)) throw Error('invalid_number');
    const value = feetFields.has(key) ? dimensionFeet(text) : Number(text);
    if (key.includes('Tanks') && (!Number.isInteger(value) || value < 1 || value > 100)) throw Error('invalid_count');
    if (['tankHeight', 'tankDiameter'].includes(key) && (value < 1 || value > 100)) throw Error('invalid_dimension');
    if (key === 'tankCapacity' && (value < 1 || value > 100000)) throw Error('invalid_capacity');
    if (key === 'perTankBblPerFoot' && (value < 0.1 || value > 2000)) throw Error('invalid_calibration');
    if (['loadLine', 'allowedBottom'].includes(key) && value > 100) throw Error('invalid_level');
    if (value !== Number(original[key])) patch[key] = value;
  }
  for (const key of ['h2sStatus', 'tankNotes']) if (draft[key] !== undefined && draft[key] !== String(original[key] ?? '')) patch[key] = draft[key];
  const active = Number(patch.activeTanks ?? original.activeTanks), total = Number(patch.totalTanks ?? original.totalTanks);
  if (active > total) throw Error('active_exceeds_total');
  const next = { ...original, ...patch };
  if (Number(next.loadLine) > Number(next.tankHeight) || Number(next.allowedBottom) > Number(next.tankHeight))
    throw Error('level_exceeds_height');
  return patch;
}
