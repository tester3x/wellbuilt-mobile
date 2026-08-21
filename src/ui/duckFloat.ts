/**
 * Duck buoyancy on a sampled FLIP surface. Pure / deterministic.
 * Hull/belly is the waterline anchor; most of the body stays above water.
 * Does not change fisherman / pelican timing.
 */

import { CENTER_EXCLUSION, DUCK_GLYPH_WIDTH, DUCK_LIFT_PX, EDGE_MARGIN_PX } from './tankWildlife';

export type DuckFloat = {
  x: number;
  /** Hull y from the tank floor (belly kisses the local surface). */
  hullY: number;
  vx: number;
  tilt: number;
  facing: 1 | -1;
  filteredSurface: number;
};

export type DuckBand = { minX: number; maxX: number };

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export function duckBandForWidth(width: number, onLeft: boolean): DuckBand {
  const w = width > 0 ? width : 0;
  const lo = onLeft ? EDGE_MARGIN_PX : Math.ceil(w * CENTER_EXCLUSION.right);
  const hi = onLeft
    ? Math.floor(w * CENTER_EXCLUSION.left) - DUCK_GLYPH_WIDTH
    : w - EDGE_MARGIN_PX - DUCK_GLYPH_WIDTH;
  if (hi <= lo) {
    const x = Math.max(EDGE_MARGIN_PX, Math.min(lo, w - DUCK_GLYPH_WIDTH));
    return { minX: x, maxX: x };
  }
  return { minX: lo, maxX: hi };
}

export function createDuckFloat(band: DuckBand, surfaceY: number, rng: () => number): DuckFloat {
  const span = Math.max(0, band.maxX - band.minX);
  const x = band.minX + rng() * span;
  const facing: 1 | -1 = rng() < 0.5 ? 1 : -1;
  return {
    x,
    hullY: surfaceY,
    vx: facing * (10 + rng() * 10),
    tilt: 0,
    facing,
    filteredSurface: surfaceY,
  };
}

export function stepDuckFloat(
  duck: DuckFloat,
  dt: number,
  localSurfaceY: number,
  band: DuckBand,
  opts: { reducedMotion?: boolean; currentVx?: number } = {},
): DuckFloat {
  const step = clamp(dt, 1 / 120, 1 / 20);
  const surface = Number.isFinite(localSurfaceY) ? Math.max(0, localSurfaceY) : 0;
  const filtered = duck.filteredSurface * 0.82 + surface * 0.18;
  if (opts.reducedMotion || band.maxX <= band.minX) {
    return {
      ...duck,
      vx: 0,
      tilt: 0,
      hullY: filtered,
      filteredSurface: filtered,
    };
  }
  let { x, vx, facing } = duck;
  vx = vx * 0.92 + (opts.currentVx ?? 0) * 0.08;
  const speed = clamp(Math.abs(vx) || 14, 8, 22);
  vx = facing * speed;
  x += vx * step;
  if (x <= band.minX) {
    x = band.minX;
    facing = 1;
    vx = speed;
  } else if (x >= band.maxX) {
    x = band.maxX;
    facing = -1;
    vx = -speed;
  }
  const slope = surface - duck.filteredSurface;
  const tilt = clamp(duck.tilt * 0.7 + slope * 0.08, -0.22, 0.22);
  return {
    x,
    hullY: filtered,
    vx,
    tilt,
    facing,
    filteredSurface: filtered,
  };
}

/** Top of the 🦆 glyph relative to the tank top so the belly is the hull. */
export function duckGlyphTopFromCeiling(tankHeight: number, hullYFromFloor: number, liftPx = DUCK_LIFT_PX): number {
  const waterTop = tankHeight - hullYFromFloor;
  const lift = Math.min(liftPx, Math.max(0, waterTop));
  return waterTop - lift;
}
