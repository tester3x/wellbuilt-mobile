/**
 * Local/no-cost visual contract preview: surface means, fish containment,
 * duck hull, reduced-motion stills, and screen-size variation.
 */
import { createDuckFloat, duckBandForWidth, stepDuckFloat } from '../duckFloat';
import {
  createFlipWorld,
  meanSurfaceHeight,
  sampleSurfaceAtX,
  setRestFill,
  stepFlip,
  surfaceHeights,
} from '../flipFluid';
import { CENTER_EXCLUSION } from '../tankWildlife';
import { createFishWander, stepFishWander } from '../fishWander';

function settle(w: ReturnType<typeof createFlipWorld>, n = 40) {
  for (let i = 0; i < n; i++) stepFlip(w, { gx: 0, gy: 1 }, 1 / 30);
}

describe('local aquarium preview (deterministic)', () => {
  const sizes = [
    { w: 180, h: 280, name: 'phone' },
    { w: 300, h: 420, name: 'fold-cover' },
    { w: 420, h: 560, name: 'tablet' },
  ];

  test('zero / near-zero / half / full conserve displayed mean on each size', () => {
    for (const s of sizes) {
      for (const fill of [0, 0.03, 0.5, 1]) {
        const world = createFlipWorld(s.w, s.h, fill);
        settle(world, 30);
        const avg = meanSurfaceHeight(surfaceHeights(world, 16));
        if (fill === 0) expect(avg).toBe(0);
        else {
          expect(avg).toBeGreaterThan(fill * s.h * 0.88);
          expect(avg).toBeLessThan(fill * s.h * 1.12);
        }
      }
    }
  });

  test('forced-fish preview stays below local surface', () => {
    const world = createFlipWorld(240, 360, 0.5);
    settle(world);
    const heights = surfaceHeights(world, 16);
    const bounds = { minX: 8, maxX: 224, minY: 10, maxY: 170 };
    const excl = { left: 240 * CENTER_EXCLUSION.left, right: 240 * CENTER_EXCLUSION.right };
    let f = createFishWander(bounds, excl, () => 0.3);
    for (let i = 0; i < 20; i++) {
      const local = sampleSurfaceAtX(heights, f.x, 240);
      f = stepFishWander(f, 1 / 30, bounds, excl, () => 0.4, { surfaceY: local });
      expect(f.y).toBeLessThanOrEqual(local - 7);
    }
  });

  test('forced-duck preview hull rides filtered surface', () => {
    const band = duckBandForWidth(240, true);
    let d = createDuckFloat(band, 80, () => 0.2);
    d = stepDuckFloat(d, 1 / 30, 90, band);
    expect(d.hullY).toBeGreaterThan(80);
    expect(d.x).toBeGreaterThanOrEqual(band.minX);
  });

  test('reduced motion duck stays put', () => {
    const band = duckBandForWidth(200, false);
    const d0 = createDuckFloat(band, 50, () => 0.5);
    const d = stepDuckFloat(d0, 1 / 30, 50, band, { reducedMotion: true });
    expect(d.x).toBe(d0.x);
    expect(d.vx).toBe(0);
  });

  test('background skip does not accumulate a giant dt in the sim helper', () => {
    const world = createFlipWorld(100, 160, 0.5);
    settle(world, 10);
    stepFlip(world, { gx: 0, gy: 1 }, 5); // clamped internally
    const avg = meanSurfaceHeight(surfaceHeights(world, 16));
    expect(avg).toBeGreaterThan(0.4 * 160);
    expect(avg).toBeLessThan(0.6 * 160);
  });
});
