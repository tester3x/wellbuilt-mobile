import {
  parseLevelToFeet,
  resolveSnapshotLevelFeet,
  startingLevelFromSnapshot,
  buildWellRenderSnapshot,
} from '../downSnapshot';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

describe('DOWN snapshot contract', () => {
  it('parses 6\' and 6\'0" and rejects Down as a level', () => {
    expect(parseLevelToFeet("6'")).toBe(6);
    expect(parseLevelToFeet("6'0\"")).toBe(6);
    expect(parseLevelToFeet('Down')).toBeUndefined();
  });

  it('DOWN packet with bottom 6\' stores DOWN + 6\', never DOWN + 0\'', () => {
    const feet = resolveSnapshotLevelFeet({
      isDown: true,
      currentLevel: 'Down',
      lastPullBottomLevel: "6'0\"",
      previousLevelFeet: 12,
    });
    expect(feet).toBe(6);
    const snap = buildWellRenderSnapshot({
      wellName: 'Thor 1',
      isDown: true,
      currentLevel: 'Down',
      lastPullBottomLevel: "6'",
      timestamp: Date.parse('2026-08-22T14:30:00.000Z'),
      lastPullPacketId: '20260822_093000_Thor1_abcd12',
    });
    expect(snap.isDown).toBe(true);
    expect(snap.levelFeet).toBe(6);
    expect(snap.levelFeet).not.toBe(0);
  });

  it('preserves the previous proven level when DOWN has no new bottom', () => {
    expect(resolveSnapshotLevelFeet({
      isDown: true,
      currentLevel: 'Down',
      previousLevelFeet: 5,
      previousBottomFeet: 4 + 4 / 12,
    })).toBeCloseTo(4 + 4 / 12);
  });

  it('starting level prefers lastPullBottomLevelFeet over a zero levelFeet', () => {
    expect(startingLevelFromSnapshot({ levelFeet: 0, lastPullBottomLevelFeet: 6 })).toBe(6);
    expect(startingLevelFromSnapshot({ levelFeet: 6, lastPullBottomLevelFeet: undefined })).toBe(6);
  });

  it('backdated-but-newer pull uses the actual pull timestamp, not now', () => {
    const pullMs = Date.parse('2026-08-22T14:30:00.000Z');
    const snap = buildWellRenderSnapshot({
      wellName: 'Thor 1',
      isDown: true,
      lastPullBottomLevel: "6'0\"",
      lastPullDateTimeUTC: '2026-08-22T14:30:00.000Z',
      timestamp: pullMs,
    });
    expect(snap.timestamp).toBe(pullMs);
    expect(snap.timestamp).toBeLessThan(Date.parse('2026-08-22T16:00:00.000Z'));
  });
});

describe('Thor 1 first render / no swipe', () => {
  const index = src('app/(tabs)/index.tsx');

  it('first Thor 1 render shows DOWN and 6\' together from the same snapshot', () => {
    expect(index).toMatch(/const wellDown = !!\(pendingPull\?\.wellDown \|\| levelSnapshot\?\.isDown\)/);
    expect(index).toMatch(/startingLevelFromSnapshot\(snapshot\)/);
    expect(index).toMatch(/startingLevelFromSnapshot\(snapshot\) > 0 \|\| snapshot\.isDown/);
    expect(index).not.toMatch(/if \(snapshot && snapshot\.levelFeet > 0\)/);
  });

  it('no swipe is required to apply either state after a snapshot update', () => {
    expect(index).toMatch(/Always apply the accepted snapshot/);
    expect(index).toMatch(/syncOnForeground\(\)/);
  });
});
