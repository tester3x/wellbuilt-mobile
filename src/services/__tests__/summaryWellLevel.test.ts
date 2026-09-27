import { summaryCurrentLevel, summaryLevelAtTime, type SummaryLevelInput } from '../summaryWellLevel';
import { startingLevelFromSnapshot } from '../downSnapshot';

const snapshotTimestamp = Date.parse('2026-09-26T12:00:00Z');
const well: SummaryLevelInput = { levelFeet: 11, flowRateMinutes: 60, snapshotTimestamp, isDown: true };

test('Gabriel 1 uses the same 5\'5" last-pull baseline as the well page, not 12\'2"', () => {
  const snapshot = { levelFeet: 12 + 2 / 12, lastPullBottomLevelFeet: 5 + 5 / 12 };
  const row = { ...well, levelFeet: startingLevelFromSnapshot(snapshot) };
  expect(summaryCurrentLevel(row, snapshotTimestamp + 48 * 3600000)).toBeCloseTo(5 + 5 / 12);
  expect(summaryLevelAtTime(row, 24, snapshotTimestamp)).toBeCloseTo(5 + 5 / 12);
});

test('DOWN preserves stored water despite a saved positive flow rate', () => {
  expect(summaryCurrentLevel(well, snapshotTimestamp + 24 * 3600000)).toBe(11);
  expect(summaryLevelAtTime(well, 24, snapshotTimestamp + 24 * 3600000)).toBe(11);
  // One 140-bbl load above a 3-foot bottom is available; DOWN does not erase it.
  expect((summaryCurrentLevel(well, snapshotTimestamp) - 3) * 20).toBe(160);
  expect(summaryCurrentLevel(well, snapshotTimestamp)).toBeGreaterThanOrEqual(3 + 140 / 20);
  expect(summaryCurrentLevel(well, snapshotTimestamp)).toBeLessThan(3 + 200 / 20);
});

test('operating wells still rise with time and the look-ahead slider, capped at full', () => {
  const up = { ...well, isDown: false };
  expect(summaryCurrentLevel(up, snapshotTimestamp + 2 * 3600000)).toBe(13);
  expect(summaryLevelAtTime(up, 3, snapshotTimestamp + 2 * 3600000)).toBe(16);
  expect(summaryLevelAtTime(up, 24, snapshotTimestamp)).toBe(20);
});

test('no flow and invalid old/future timestamps do not advance the current reading', () => {
  expect(summaryCurrentLevel({ ...well, isDown: false, flowRateMinutes: 0 }, snapshotTimestamp + 3600000)).toBe(11);
  expect(summaryCurrentLevel({ ...well, isDown: false, snapshotTimestamp: 0 }, snapshotTimestamp)).toBe(11);
  expect(summaryCurrentLevel({ ...well, isDown: false }, snapshotTimestamp - 3600000)).toBe(11);
});
