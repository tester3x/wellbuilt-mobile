import { type FlipWorld, surfaceHeights } from './flipFluid';

/** Reconstruct a continuous surface from sparse particles; no isolated spikes. */
export function softenedFluidSurface(world: FlipWorld, previous: number[], dt: number): number[] {
  const rest = world.restFill * world.height;
  if (rest <= 0 || world.restFill >= 1) return previous.map(() => 0);
  let heights = surfaceHeights(world);
  // Wide symmetric filtering removes max-particle column aliasing and pointed dips.
  for (let pass = 0; pass < 12; pass++) {
    const old = heights;
    heights = old.map((h, i) => (old[Math.max(0, i - 1)] + 2 * h + old[Math.min(old.length - 1, i + 1)]) / 4);
  }
  const mean = heights.reduce((sum, h) => sum + h, 0) / heights.length;
  const maxRelief = Math.min(world.height * 0.1, rest, world.height - rest);
  const largest = Math.max(...heights.map(h => Math.abs(h - mean)), 1);
  const curvature = Math.max(...heights.slice(1, -1).map((h, i) => Math.abs(heights[i] - 2 * h + heights[i + 2])), 0.001);
  const scale = Math.min(1, maxRelief / largest, 3 / curvature);
  const alpha = 1 - Math.exp(-Math.max(0, dt) / 0.18);
  // Blend offsets (not absolute heights), so a pull drain still follows canonical fill.
  const offsets = heights.map((h, i) => {
    const target = (h - mean) * scale;
    return (previous[i] || 0) + (target - (previous[i] || 0)) * alpha;
  });
  const bias = offsets.reduce((sum, h) => sum + h, 0) / offsets.length;
  const peak = Math.max(...offsets.map(h => Math.abs(h - bias)), 1);
  const boundedScale = Math.min(1, maxRelief / peak);
  return offsets.map(h => (h - bias) * boundedScale);
}

/** Upright and flat-table readings both use tank-down; allow motion to decay. */
export function isRestingTankGravity(gravity: { gx: number; gy: number }): boolean {
  return Math.abs(gravity.gx) < 0.04 && Math.abs(gravity.gy - 1) < 0.08;
}

export function decayRestingSurface(offsets: number[], fill: number, height: number, dt: number): number[] {
  const maxRelief = Math.max(0, Math.min(height * 0.1, fill * height, (1 - fill) * height));
  const decay = Math.exp(-dt / 0.35);
  const mean = offsets.reduce((sum, h) => sum + h, 0) / offsets.length;
  const peak = Math.max(...offsets.map(h => Math.abs(h - mean)), 0);
  const scale = Math.min(1, maxRelief / Math.max(peak, 1e-9)) * decay;
  if (peak * scale < 0.02) return offsets.map(() => 0);
  return offsets.map(h => (h - mean) * scale);
}

/** Static hydrostatic equilibrium: a held tilt has a still, straight surface. */
export function restingFluidOffsets(gravity: { gx: number; gy: number }, width: number, height: number, fill: number, count: number): number[] {
  const tilt = Math.abs(gravity.gx) < 0.04 ? 0 : gravity.gx / Math.max(0.2, gravity.gy);
  const halfRise = Math.max(-height * 0.1, Math.min(height * 0.1, tilt * width / 2));
  const limit = Math.max(0, Math.min(fill * height, (1 - fill) * height));
  const amplitude = Math.max(-limit, Math.min(limit, halfRise));
  return Array.from({ length: count }, (_, i) => amplitude * (2 * (i + 0.5) / count - 1));
}
