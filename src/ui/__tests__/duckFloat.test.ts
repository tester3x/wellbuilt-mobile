import { DUCK_LIFT_PX } from '../tankWildlife';
import {
  createDuckFloat,
  duckBandForWidth,
  duckGlyphTopFromCeiling,
  stepDuckFloat,
} from '../duckFloat';

describe('duck buoyancy and swimming', () => {
  const rng = (() => {
    let i = 0;
    const seq = [0.1, 0.8, 0.3, 0.6, 0.2];
    return () => seq[(i++) % seq.length];
  })();

  test('hull rides a filtered local surface; most of the body is above water', () => {
    const band = duckBandForWidth(240, true);
    let d = createDuckFloat(band, 80, rng);
    d = stepDuckFloat(d, 1 / 30, 100, band);
    d = stepDuckFloat(d, 1 / 30, 100, band);
    expect(d.hullY).toBeGreaterThan(80);
    expect(d.hullY).toBeLessThan(100);
    const top = duckGlyphTopFromCeiling(200, d.hullY);
    const waterTop = 200 - d.hullY;
    expect(top).toBeLessThan(waterTop); // glyph starts above the waterline
    expect(waterTop - top).toBeLessThanOrEqual(DUCK_LIFT_PX + 1e-6);
  });

  test('reverses before tank edges and stays out of the level-number column', () => {
    const band = duckBandForWidth(300, true);
    let d = createDuckFloat(band, 60, () => 0);
    d = { ...d, x: band.minX, facing: -1, vx: -20 };
    for (let i = 0; i < 40; i++) d = stepDuckFloat(d, 1 / 30, 60, band);
    expect(d.x).toBeGreaterThanOrEqual(band.minX);
    expect(d.x).toBeLessThanOrEqual(band.maxX);
    expect(d.facing).toBe(1);
  });

  test('reduced motion holds the duck still on the surface', () => {
    const band = duckBandForWidth(240, false);
    const d0 = createDuckFloat(band, 70, rng);
    const d = stepDuckFloat(d0, 1 / 30, 90, band, { reducedMotion: true });
    expect(d.vx).toBe(0);
    expect(d.x).toBe(d0.x);
  });

  test('low water keeps the hull at the sampled surface without diving', () => {
    const band = duckBandForWidth(200, true);
    let d = createDuckFloat(band, 8, rng);
    d = stepDuckFloat(d, 1 / 30, 6, band);
    expect(d.hullY).toBeGreaterThanOrEqual(0);
    expect(d.hullY).toBeLessThan(10);
  });
});
