import { type FlipWorld, surfaceHeights, type FlipGravity } from './flipFluid';

/** Reconstruct a continuous surface from sparse particles; no isolated spikes. */
export function softenedFluidSurface(world: FlipWorld, previous: number[], dt: number, gravity: FlipGravity = { gx: 0, gy: 1 }): number[] {
  const rest = world.restFill * world.height;
  if (rest <= 0 || world.restFill >= 1) return previous.map(() => 0);
  let heights = surfaceHeights(world);
  // Wide symmetric filtering removes max-particle column aliasing and pointed dips.
  for (let pass = 0; pass < 12; pass++) {
    const old = heights;
    heights = old.map((h, i) => (old[Math.max(0, i - 1)] + 2 * h + old[Math.min(old.length - 1, i + 1)]) / 4);
  }
  const mean = heights.reduce((sum, h) => sum + h, 0) / heights.length;
  const maxRelief = Math.min(world.height * 0.035, rest, world.height - rest);
  const largest = Math.max(...heights.map(h => Math.abs(h - mean)), 1);
  const curvature = Math.max(...heights.slice(1, -1).map((h, i) => Math.abs(heights[i] - 2 * h + heights[i + 2])), 0.001);
  const scale = Math.min(1, maxRelief / largest, 1.5 / curvature);
  const alpha = 1 - Math.exp(-Math.max(0, dt) / 0.28);
  // Blend offsets (not absolute heights), so a pull drain still follows canonical fill.
  const equilibrium = restingFluidOffsets(gravity, world.width, world.height, world.restFill, heights.length);
  const offsets = heights.map((h, i) => {
    const target = equilibrium[i] + (h - mean) * scale;
    return (previous[i] || 0) + (target - (previous[i] || 0)) * alpha;
  });
  return projectSurfaceOffsets(offsets, world.restFill, world.height);
}

/** Upright and flat-table readings both use tank-down; allow motion to decay. */
export function isRestingTankGravity(gravity: { gx: number; gy: number }): boolean {
  return Math.abs(gravity.gx) < 0.04 && Math.abs(gravity.gy - 1) < 0.08;
}

export function decayRestingSurface(offsets: number[], fill: number, height: number, dt: number): number[] {
  const maxRelief = Math.max(0, Math.min(height * 0.1, fill * height, (1 - fill) * height));
  const decay = Math.exp(-dt / 0.25);
  const mean = offsets.reduce((sum, h) => sum + h, 0) / offsets.length;
  const peak = Math.max(...offsets.map(h => Math.abs(h - mean)), 0);
  const scale = Math.min(1, maxRelief / Math.max(peak, 1e-9)) * decay;
  if (peak * scale < 0.02) return offsets.map(() => 0);
  return offsets.map(h => (h - mean) * scale);
}

/** Static hydrostatic equilibrium: a held tilt has a still, straight surface. */
export function restingFluidOffsets(gravity: { gx: number; gy: number }, width: number, height: number, fill: number, count: number): number[] {
  const tilt = Math.abs(gravity.gx) < 0.04 ? 0 : gravity.gx / Math.max(0.001, Math.abs(gravity.gy));
  const raw = Array.from({ length: count }, (_, i) => tilt * width * ((i + 0.5) / count - 0.5));
  return projectSurfaceOffsets(raw, fill, height);
}

/** Clip a gravity-aligned plane/waves at the walls while preserving fill area. */
export function projectSurfaceOffsets(offsets: number[], fill: number, height: number): number[] {
  const rest = Math.max(0, Math.min(1, fill)) * height;
  if (!offsets.length) return [];
  if (rest <= 0 || rest >= height) return offsets.map(() => 0);
  const peak = Math.max(...offsets.map(Math.abs), height);
  let lo = -peak - height, hi = peak + height;
  for (let i = 0; i < 45; i++) {
    const shift = (lo + hi) / 2;
    const mean = offsets.reduce((sum, o) => sum + Math.max(0, Math.min(height, rest + o + shift)), 0) / offsets.length;
    if (mean < rest) lo = shift; else hi = shift;
  }
  const shift = (lo + hi) / 2;
  return offsets.map(o => Math.max(0, Math.min(height, rest + o + shift)) - rest);
}
