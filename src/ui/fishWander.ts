/**
 * 2D waypoint wandering for tank fish. Pure / deterministic: rng is injected.
 * Fish stay in the underwater usable area and never enter the level-text
 * exclusion column.
 */

export type WanderBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type ExclusionBand = { left: number; right: number };

export type FishWander = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  wx: number;
  wy: number;
  speed: number;
  retargetIn: number;
};

export type Rng = () => number;

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function inExclusion(x: number, excl: ExclusionBand): boolean {
  return x > excl.left && x < excl.right;
}

export function pickWanderPoint(bounds: WanderBounds, excl: ExclusionBand, rng: Rng): { x: number; y: number } {
  const y = bounds.minY + rng() * (bounds.maxY - bounds.minY);
  const useLeft = rng() < 0.5;
  const leftHi = Math.max(bounds.minX, Math.min(excl.left, bounds.maxX));
  const rightLo = Math.min(bounds.maxX, Math.max(excl.right, bounds.minX));
  if (useLeft && leftHi - bounds.minX > 8) {
    return { x: bounds.minX + rng() * (leftHi - bounds.minX), y };
  }
  if (bounds.maxX - rightLo > 8) {
    return { x: rightLo + rng() * (bounds.maxX - rightLo), y };
  }
  return { x: bounds.minX + rng() * Math.max(1, bounds.maxX - bounds.minX), y };
}

export function createFishWander(
  bounds: WanderBounds,
  excl: ExclusionBand,
  rng: Rng,
): FishWander {
  const p = pickWanderPoint(bounds, excl, rng);
  const w = pickWanderPoint(bounds, excl, rng);
  const speed = 18 + rng() * 28; // px/s
  const dx = w.x - p.x;
  const dy = w.y - p.y;
  const mag = Math.hypot(dx, dy) || 1;
  return {
    x: p.x,
    y: p.y,
    vx: (dx / mag) * speed,
    vy: (dy / mag) * speed,
    wx: w.x,
    wy: w.y,
    speed,
    retargetIn: 0.8 + rng() * 2.2,
  };
}

export function fishFacing(fish: FishWander): 1 | -1 {
  return fish.vx >= 0 ? -1 : 1; // 🐟 glyph faces left; -1 faces right
}

export function stepFishWander(
  fish: FishWander,
  dt: number,
  bounds: WanderBounds,
  excl: ExclusionBand,
  rng: Rng,
  fluid?: { currentVx?: number; currentVy?: number; surfaceY?: number },
): FishWander {
  const step = clamp(dt, 1 / 120, 1 / 20);
  let { x, y, vx, vy, wx, wy, speed, retargetIn } = fish;
  retargetIn -= step;
  const toW = Math.hypot(wx - x, wy - y);
  if (retargetIn <= 0 || toW < 6) {
    const n = pickWanderPoint(bounds, excl, rng);
    wx = n.x;
    wy = n.y;
    speed = 16 + rng() * 32;
    retargetIn = 0.7 + rng() * 2.4;
  }
  const dx = wx - x;
  const dy = wy - y;
  const mag = Math.hypot(dx, dy) || 1;
  const tx = (dx / mag) * speed;
  const ty = (dy / mag) * speed;
  // Smooth steering, not a straight track.
  vx = vx * 0.82 + tx * 0.18;
  vy = vy * 0.82 + ty * 0.18;
  const cvx = fluid?.currentVx ?? 0;
  const cvy = fluid?.currentVy ?? 0;
  vx += cvx * 0.12;
  vy += cvy * 0.08;
  const vmag = Math.hypot(vx, vy) || 1;
  const cap = speed * 1.15;
  if (vmag > cap) {
    vx = (vx / vmag) * cap;
    vy = (vy / vmag) * cap;
  }
  x += vx * step;
  y += vy * step;
  if (inExclusion(x, excl)) {
    x = x < (excl.left + excl.right) / 2 ? excl.left - 2 : excl.right + 2;
    vx = -vx * 0.4;
    const n = pickWanderPoint(bounds, excl, rng);
    wx = n.x;
    wy = n.y;
  }
  if (x < bounds.minX) { x = bounds.minX; vx = Math.abs(vx) * 0.5; }
  if (x > bounds.maxX) { x = bounds.maxX; vx = -Math.abs(vx) * 0.5; }
  if (y < bounds.minY) { y = bounds.minY; vy = Math.abs(vy) * 0.5; }
  const localMax = fluid?.surfaceY != null
    ? Math.min(bounds.maxY, Math.max(bounds.minY, fluid.surfaceY - 8))
    : bounds.maxY;
  if (y > localMax) { y = localMax; vy = -Math.abs(vy) * 0.5; }
  return { x, y, vx, vy, wx, wy, speed, retargetIn };
}
