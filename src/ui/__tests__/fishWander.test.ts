import { CENTER_EXCLUSION } from '../tankWildlife';
import {
  createFishWander,
  fishFacing,
  pickWanderPoint,
  stepFishWander,
  type WanderBounds,
} from '../fishWander';

const bounds: WanderBounds = { minX: 6, maxX: 114, minY: 10, maxY: 90 };
const excl = { left: 114 * CENTER_EXCLUSION.left, right: 114 * CENTER_EXCLUSION.right };

function rngSeq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

describe('fish 2D wander', () => {
  test('spawns at varied positions, not a single lane', () => {
    const a = createFishWander(bounds, excl, rngSeq([0.1, 0.2, 0.3, 0.4, 0.15, 0.8]));
    const b = createFishWander(bounds, excl, rngSeq([0.9, 0.7, 0.05, 0.6, 0.85, 0.1]));
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(8);
    expect(a.y).not.toBe(b.y);
  });

  test('waypoints and motion include a vertical component', () => {
    const f0 = createFishWander(bounds, excl, rngSeq([0.2, 0.1, 0.8, 0.9, 0.3, 0.4]));
    let f = f0;
    let sawY = false;
    for (let i = 0; i < 40; i++) {
      f = stepFishWander(f, 1 / 30, bounds, excl, rngSeq([0.4, 0.6, 0.2, 0.8, 0.5]));
      if (Math.abs(f.vy) > 2) sawY = true;
    }
    expect(sawY).toBe(true);
    expect(Math.abs(f.y - f0.y) + Math.abs(f.x - f0.x)).toBeGreaterThan(1);
  });

  test('never enters the level-text exclusion column', () => {
    let f = createFishWander(bounds, excl, () => Math.random());
    for (let i = 0; i < 200; i++) {
      f = stepFishWander(f, 1 / 30, bounds, excl, Math.random);
      expect(f.x <= excl.left || f.x >= excl.right).toBe(true);
      expect(f.x).toBeGreaterThanOrEqual(bounds.minX);
      expect(f.x).toBeLessThanOrEqual(bounds.maxX);
      expect(f.y).toBeGreaterThanOrEqual(bounds.minY);
      expect(f.y).toBeLessThanOrEqual(bounds.maxY);
    }
  });

  test('facing flips with horizontal travel (glyph faces left at rest-left)', () => {
    const f = createFishWander(bounds, excl, rngSeq([0.05, 0.5, 0.9, 0.5, 0.2, 0.2]));
    // After steps toward a right-side waypoint, vx should go positive → facing -1
    let cur = f;
    for (let i = 0; i < 20; i++) {
      cur = stepFishWander(cur, 1 / 30, bounds, excl, rngSeq([0.99, 0.5, 0.5, 0.5, 0.5]));
    }
    if (cur.vx >= 0) expect(fishFacing(cur)).toBe(-1);
    else expect(fishFacing(cur)).toBe(1);
  });

  test('pickWanderPoint stays in a side band', () => {
    for (let i = 0; i < 30; i++) {
      const p = pickWanderPoint(bounds, excl, Math.random);
      expect(p.x <= excl.left + 0.01 || p.x >= excl.right - 0.01).toBe(true);
    }
  });
});
