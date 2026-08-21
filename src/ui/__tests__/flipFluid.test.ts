import {
  clampGravity,
  createFlipWorld,
  kineticEnergy,
  MAX_GRAVITY,
  meanParticleHeight,
  setRestFill,
  stepFlip,
  surfaceHeights,
} from '../flipFluid';

function settle(world: ReturnType<typeof createFlipWorld>, frames = 90) {
  for (let i = 0; i < frames; i++) {
    stepFlip(world, { gx: 0, gy: 1 }, 1 / 30);
  }
}

describe('FLIP/PIC tank fluid', () => {
  test('particles spawn inside the rest-fill rectangle', () => {
    const w = createFlipWorld(120, 200, 0.4);
    for (let i = 0; i < w.n; i++) {
      expect(w.xs[i]).toBeGreaterThanOrEqual(0);
      expect(w.xs[i]).toBeLessThanOrEqual(120);
      expect(w.ys[i]).toBeGreaterThanOrEqual(0);
      expect(w.ys[i]).toBeLessThanOrEqual(200 * 0.4 + 8);
    }
    expect(w.n).toBe(96);
  });

  test('upright gravity keeps particles in the rest-fill slab (not on the lid)', () => {
    const w = createFlipWorld(120, 200, 0.5);
    settle(w, 120);
    const mean = meanParticleHeight(w);
    expect(mean).toBeGreaterThan(8);
    expect(mean).toBeLessThan(0.5 * 200 * 0.95);
    expect(kineticEnergy(w)).toBeGreaterThanOrEqual(0);
  });

  test('particle count is conserved and positions stay finite', () => {
    const w = createFlipWorld(100, 160, 0.35);
    const n = w.n;
    for (let i = 0; i < 40; i++) {
      stepFlip(w, { gx: 0.4, gy: 0.9 }, 1 / 30);
    }
    expect(w.n).toBe(n);
    for (let i = 0; i < n; i++) {
      expect(Number.isFinite(w.xs[i])).toBe(true);
      expect(Number.isFinite(w.ys[i])).toBe(true);
      expect(w.xs[i]).toBeGreaterThanOrEqual(0);
      expect(w.xs[i]).toBeLessThanOrEqual(100);
    }
  });

  test('tilt moves the center of mass toward the low wall', () => {
    const left = createFlipWorld(120, 180, 0.45);
    const right = createFlipWorld(120, 180, 0.45);
    for (let i = 0; i < 50; i++) {
      stepFlip(left, { gx: -1.2, gy: 0.6 }, 1 / 30);
      stepFlip(right, { gx: 1.2, gy: 0.6 }, 1 / 30);
    }
    let lx = 0, rx = 0;
    for (let i = 0; i < left.n; i++) { lx += left.xs[i]; rx += right.xs[i]; }
    expect(lx / left.n).toBeLessThan(rx / right.n - 4);
  });

  test('extreme gravity is clamped (no ballistic explosion)', () => {
    const g = clampGravity({ gx: 80, gy: 0 });
    expect(Math.hypot(g.gx, g.gy)).toBeLessThanOrEqual(MAX_GRAVITY + 1e-9);
    const w = createFlipWorld(80, 120, 0.5);
    stepFlip(w, { gx: 80, gy: 0 }, 1 / 30);
    expect(kineticEnergy(w)).toBeLessThan(1e7);
  });

  test('reduced motion reseeds a still rest rectangle', () => {
    const w = createFlipWorld(90, 140, 0.4);
    stepFlip(w, { gx: 2, gy: 1 }, 1 / 30);
    stepFlip(w, { gx: 0, gy: 1 }, 1 / 30, { reducedMotion: true });
    expect(kineticEnergy(w)).toBe(0);
    const mean = meanParticleHeight(w);
    expect(mean).toBeGreaterThan(0);
    expect(mean).toBeLessThan(140 * 0.4);
  });

  test('surface heights have one column per sample and stay near rest', () => {
    const w = createFlipWorld(100, 160, 0.5);
    settle(w, 80);
    const s = surfaceHeights(w, 16);
    expect(s).toHaveLength(16);
    const rest = 0.5 * 160;
    const avg = s.reduce((a, b) => a + b, 0) / s.length;
    expect(avg).toBeGreaterThan(rest * 0.2);
    expect(avg).toBeLessThan(rest * 1.5);
  });

  test('setRestFill does not change particle count', () => {
    const w = createFlipWorld(100, 160, 0.3);
    const n = w.n;
    setRestFill(w, 0.7);
    expect(w.n).toBe(n);
    expect(w.restFill).toBeCloseTo(0.7);
  });

  test('this is FLIP/PIC transfer, not a sine or damped-spring slosh', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../flipFluid.ts'), 'utf8');
    expect(src).toMatch(/FLIP\/PIC/);
    expect(src).toContain('gather');
    expect(src).toContain('scatter');
    expect(src).toContain('project');
    expect(src).not.toMatch(/Math\.sin\(.*time/);
    expect(src).not.toMatch(/damped-spring/i);
  });
});
