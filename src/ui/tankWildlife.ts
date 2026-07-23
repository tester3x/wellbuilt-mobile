// src/ui/tankWildlife.ts
// Pure geometry/scheduling for the alive-tank wildlife scene. RN-free so
// every lane, clamp, and schedule is unit-testable and deterministic
// (randomness/time are injected as arguments — never read here).
//
// VISUAL LANES (coordination contract):
//   pelican    — perched ON TOP of the level-number text (entirely above
//                its top edge, so digits are never covered);
//   fisherman  — seated on the tank rim (interior top edge), off to one
//                side, with pole + line reaching the water;
//   duck       — swimming ON the water surface, in a side band;
//   fish       — always BELOW the surface (hooked fish included).
// The level text owns the CENTER COLUMN of the interior; duck and the
// fisherman's line stay outside it. Duck and fisherman are mutually
// exclusive spawns (one critter kind per session), so their side bands
// can never collide; the pelican lives above the number and never enters
// the surface or rim lanes.

export const EDGE_MARGIN_PX = 4;
/** The level text owns this horizontal fraction band of the interior. */
export const CENTER_EXCLUSION = { left: 0.36, right: 0.64 };

// ── Duck (surface lane) ──────────────────────────────────────────────────
export const DUCK_FONT_SIZE = 18;
export const DUCK_GLYPH_WIDTH = Math.round(DUCK_FONT_SIZE * 1.15);
/** How much of the duck rides ABOVE the waterline: the glyph box bottom
 *  sits liftPx above the surface minus a small belly dip — visually most
 *  of the body above water, belly just in it. */
export const DUCK_LIFT_PX = 14;

export interface DuckSpawn {
  basePx: number;   // left of the glyph box at sine center
  rangePx: number;  // sine amplitude — travel each side of base
}

/**
 * A side swim band that (a) never enters the level-text center column,
 * (b) never touches the tank edges, for ANY interior width (phone, Fold,
 * tablet). jitter01 shifts the base inside the band so tanks don't look
 * mechanically synchronized. Degenerate/narrow interiors collapse to a
 * stationary but correctly floating duck (range 0).
 */
export function computeDuckBand(interiorWidth: number, onLeft: boolean, jitter01 = 0.5): DuckSpawn {
  const w = Number.isFinite(interiorWidth) && interiorWidth > 0 ? interiorWidth : 0;
  const j = Math.min(1, Math.max(0, jitter01));
  const lo = onLeft ? EDGE_MARGIN_PX : Math.ceil(w * CENTER_EXCLUSION.right);
  const hi = onLeft ? Math.floor(w * CENTER_EXCLUSION.left) - DUCK_GLYPH_WIDTH : w - EDGE_MARGIN_PX - DUCK_GLYPH_WIDTH;
  if (hi <= lo) {
    return { basePx: Math.max(EDGE_MARGIN_PX, Math.min(lo, w - DUCK_GLYPH_WIDTH)), rangePx: 0 };
  }
  const bandMid = (lo + hi) / 2;
  const bandHalf = (hi - lo) / 2;
  const basePx = bandMid + (j - 0.5) * bandHalf * 0.5; // jittered start, still inside
  const rangePx = Math.min(bandHalf - Math.abs(basePx - bandMid), w * 0.14);
  return { basePx, rangePx: Math.max(0, rangePx) };
}

/** [min,max] left the duck can ever reach — for bound proofs. */
export function duckTravelBounds(spawn: DuckSpawn): { minPx: number; maxPx: number } {
  return { minPx: spawn.basePx - spawn.rangePx, maxPx: spawn.basePx + spawn.rangePx };
}

/**
 * Vertical offset of the duck glyph box relative to the water surface
 * (the surface layer's top). Rides DUCK_LIFT_PX above the line; clamped
 * so a nearly-full tank can never push the duck above the interior top.
 */
export function duckTopOffset(waterTopPx: number, liftPx: number = DUCK_LIFT_PX): number {
  const wt = Number.isFinite(waterTopPx) ? Math.max(0, waterTopPx) : 0;
  const lift = Math.min(liftPx, wt);
  return lift === 0 ? 0 : -lift;
}

// ── Fisherman scene (rim lane + line + hooked fish) ──────────────────────
export const FISHERMAN_WIDTH = 22;
export const FISHERMAN_HEIGHT = 24;
/** Pole tip lands this far inward/down from the fisherman's hands. */
export const POLE_REACH_X = 30;
export const POLE_TIP_DROP_Y = 12;
/** Hook depth: the fish's center rides this far below the surface. */
export const FISH_HOOK_DEPTH_PX = 16;
/** The fish may tug upward but never closer than this to the surface. */
export const FISH_MIN_SUBMERGE_PX = 6;
export const FISH_TUG_AMPLITUDE_PX = 3;

export interface FishermanLayout {
  onLeft: boolean;
  /** Left of the fisherman art box; he sits ON the rim (interior top). */
  fishermanLeftPx: number;
  /** Absolute x (interior coords) where the line hangs from the pole tip. */
  poleTipXPx: number;
  /** y of the pole tip below the interior top. */
  poleTipYPx: number;
}

/**
 * Seat the fisherman on the rim at a side, pole reaching toward the
 * water — with the hanging line kept OUT of the level-text center column
 * and inside the tank for any width. Never floats in the water: the
 * anchor is the interior top edge by construction.
 */
export function computeFishermanLayout(interiorWidth: number, onLeft: boolean, jitter01 = 0.5): FishermanLayout {
  const w = Number.isFinite(interiorWidth) && interiorWidth > 0 ? interiorWidth : 0;
  const j = Math.min(1, Math.max(0, jitter01));
  const seatLo = EDGE_MARGIN_PX;
  const seatHi = Math.max(seatLo, Math.floor(w * 0.24) - FISHERMAN_WIDTH);
  const seatOffset = seatLo + (seatHi - seatLo) * j;
  const fishermanLeftPx = onLeft ? seatOffset : w - FISHERMAN_WIDTH - seatOffset;
  // Tip reaches toward center but the LINE (and hooked fish) must stay
  // outside the center column and inside the tank.
  const tipUnclamped = onLeft
    ? fishermanLeftPx + FISHERMAN_WIDTH + POLE_REACH_X
    : fishermanLeftPx - POLE_REACH_X;
  const tipMax = Math.floor(w * CENTER_EXCLUSION.left) - EDGE_MARGIN_PX;
  const tipMin = Math.ceil(w * CENTER_EXCLUSION.right) + EDGE_MARGIN_PX;
  const poleTipXPx = onLeft
    ? Math.max(EDGE_MARGIN_PX, Math.min(tipUnclamped, tipMax))
    : Math.min(w - EDGE_MARGIN_PX, Math.max(tipUnclamped, tipMin));
  return { onLeft, fishermanLeftPx, poleTipXPx, poleTipYPx: POLE_TIP_DROP_Y };
}

/**
 * Length of the fishing line from the pole tip down to the hooked fish.
 * Adapts to the live water level; never negative even if the surface
 * rises above the pole tip (fish then hangs just under the surface).
 */
export function fishingLineHeight(waterTopPx: number, poleTipYPx: number, tugPx: number): number {
  const wt = Number.isFinite(waterTopPx) ? Math.max(0, waterTopPx) : 0;
  const fishCenter = fishHookedCenterY(wt, tugPx);
  return Math.max(0, fishCenter - poleTipYPx);
}

/**
 * Vertical center of the hooked fish (interior coords from top). The tug
 * is clamped so the fish NEVER rises above FISH_MIN_SUBMERGE_PX below
 * the surface — underwater, always.
 */
export function fishHookedCenterY(waterTopPx: number, tugPx: number): number {
  const wt = Number.isFinite(waterTopPx) ? Math.max(0, waterTopPx) : 0;
  const tug = Number.isFinite(tugPx) ? tugPx : 0;
  const depth = Math.max(FISH_MIN_SUBMERGE_PX, FISH_HOOK_DEPTH_PX - Math.min(tug, FISH_TUG_AMPLITUDE_PX));
  return wt + depth;
}

// ── Pelican (above-the-number lane) ──────────────────────────────────────
export const PELICAN_WIDTH = 26;
export const PELICAN_HEIGHT = 20;
/** Feet overlap the number's top edge by this much — "perched" look. */
export const PELICAN_FOOT_OVERLAP_PX = 2;
export const PELICAN_MIN_INTERVAL_MS = 90_000;
export const PELICAN_MAX_INTERVAL_MS = 240_000;
export const PELICAN_VISIT_MS = 10_000;

/** Bounded randomized delay until the next pelican visit. Deterministic
 *  under an injected rand01. */
export function nextPelicanDelayMs(rand01: number): number {
  const r = Number.isFinite(rand01) ? Math.min(1, Math.max(0, rand01)) : 0.5;
  return Math.round(PELICAN_MIN_INTERVAL_MS + r * (PELICAN_MAX_INTERVAL_MS - PELICAN_MIN_INTERVAL_MS));
}

/**
 * Horizontal perch position: near the number (center column) but shifted
 * to a chosen side so facing direction varies; always fully inside the
 * interior. The pelican sits ENTIRELY ABOVE the number's top edge (see
 * pelicanTopPx), so it can never cover the digits.
 */
export function pelicanPerchX(interiorWidth: number, side: 'left' | 'right', jitter01 = 0.5): number {
  const w = Number.isFinite(interiorWidth) && interiorWidth > 0 ? interiorWidth : 0;
  const j = Math.min(1, Math.max(0, jitter01));
  const shift = w * (0.05 + 0.09 * j);
  const x = w / 2 + (side === 'left' ? -shift : shift) - PELICAN_WIDTH / 2;
  return Math.max(EDGE_MARGIN_PX, Math.min(x, w - EDGE_MARGIN_PX - PELICAN_WIDTH));
}

/** Top of the pelican art box so its feet align with the number's top
 *  edge (tiny overlap for the seated look), never below it. */
export function pelicanTopPx(numberTopPx: number): number {
  const nt = Number.isFinite(numberTopPx) ? numberTopPx : 0;
  return nt - PELICAN_HEIGHT + PELICAN_FOOT_OVERLAP_PX;
}
