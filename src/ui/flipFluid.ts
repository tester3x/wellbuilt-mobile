/**
 * Bounded 2D FLIP/PIC-inspired fluid for the WB-M tank.
 *
 * Particles carry position/velocity. A coarse MAC-like cell grid mediates
 * velocity and a cheap pressure projection. A FLIP/PIC blend transfers
 * grid velocity back to particles.
 *
 * Visual only: particle count is fixed for a fill fraction; after each
 * step the mean particle height is restored toward the rest waterline so
 * operational tank math (bbl, feet/inches) is never implied by slosh.
 *
 * Pure: no RN, no sensors, no clock. Callers inject dt and gravity.
 */

export const FLIP_BLEND = 0.9; // 1 = FLIP (energetic), 0 = PIC (damped)
export const FLIP_COLS = 16;
export const DEFAULT_PARTICLES = 96;
export const DEFAULT_GX = 12;
export const DEFAULT_GY = 14;
export const PRESSURE_ITERS = 6;
export const MAX_GRAVITY = 4; // |g| cap in "tank-down = 1" units
export const WALL_DAMP = 0.18;
export const SETTLE_STIFFNESS = 2.4;

export type FlipGravity = { gx: number; gy: number };

export type FlipWorld = {
  width: number;
  height: number;
  gx: number;
  gy: number;
  restFill: number;
  xs: Float64Array;
  ys: Float64Array;
  vxs: Float64Array;
  vys: Float64Array;
  n: number;
  mass: Float64Array;
  gvx: Float64Array;
  gvy: Float64Array;
  gvxOld: Float64Array;
  gvyOld: Float64Array;
  pressure: Float64Array;
};

function cellCount(w: FlipWorld): number {
  return w.gx * w.gy;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function finite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

/** Spawn a filled rectangle of particles for the rest fill fraction. */
export function createFlipWorld(
  width: number,
  height: number,
  restFill: number,
  particleCount = DEFAULT_PARTICLES,
  gx = DEFAULT_GX,
  gy = DEFAULT_GY,
): FlipWorld {
  const w = Math.max(8, finite(width, 100));
  const h = Math.max(8, finite(height, 160));
  const fill = clamp(finite(restFill, 0.5), 0.04, 1);
  const n = Math.max(16, Math.floor(particleCount));
  const cells = gx * gy;
  const world: FlipWorld = {
    width: w,
    height: h,
    gx,
    gy,
    restFill: fill,
    xs: new Float64Array(n),
    ys: new Float64Array(n),
    vxs: new Float64Array(n),
    vys: new Float64Array(n),
    n,
    mass: new Float64Array(cells),
    gvx: new Float64Array(cells),
    gvy: new Float64Array(cells),
    gvxOld: new Float64Array(cells),
    gvyOld: new Float64Array(cells),
    pressure: new Float64Array(cells),
  };
  seedParticles(world);
  return world;
}

function seedParticles(world: FlipWorld): void {
  const fillH = world.restFill * world.height;
  const cols = Math.max(4, Math.round(Math.sqrt(world.n * world.width / Math.max(fillH, 1))));
  const rows = Math.max(2, Math.ceil(world.n / cols));
  let i = 0;
  for (let r = 0; r < rows && i < world.n; r++) {
    for (let c = 0; c < cols && i < world.n; c++) {
      const jitterX = ((i * 17) % 7) / 7 * 0.4;
      const jitterY = ((i * 13) % 5) / 5 * 0.4;
      world.xs[i] = ((c + 0.5 + jitterX) / cols) * world.width;
      world.ys[i] = ((r + 0.5 + jitterY) / rows) * fillH;
      world.vxs[i] = 0;
      world.vys[i] = 0;
      i++;
    }
  }
}

/** Change rest fill (tank level). Reseed if the fraction jumped hard. */
export function setRestFill(world: FlipWorld, restFill: number): void {
  const next = clamp(finite(restFill, world.restFill), 0.04, 1);
  const jumped = Math.abs(next - world.restFill) > 0.12;
  world.restFill = next;
  if (jumped) seedParticles(world);
}

export function clampGravity(g: FlipGravity): FlipGravity {
  const gx = finite(g.gx);
  const gy = finite(g.gy);
  const mag = Math.hypot(gx, gy);
  if (mag <= MAX_GRAVITY) return { gx, gy };
  const s = MAX_GRAVITY / mag;
  return { gx: gx * s, gy: gy * s };
}

function scatter(world: FlipWorld): void {
  const cells = cellCount(world);
  world.mass.fill(0);
  world.gvx.fill(0);
  world.gvy.fill(0);
  const dx = world.width / world.gx;
  const dy = world.height / world.gy;
  for (let p = 0; p < world.n; p++) {
    const fx = clamp(world.xs[p] / dx, 0, world.gx - 1.001);
    const fy = clamp(world.ys[p] / dy, 0, world.gy - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    const add = (ii: number, jj: number, wgt: number) => {
      if (wgt <= 0) return;
      const k = ii + jj * world.gx;
      world.mass[k] += wgt;
      world.gvx[k] += world.vxs[p] * wgt;
      world.gvy[k] += world.vys[p] * wgt;
    };
    add(i, j, w00);
    add(Math.min(i + 1, world.gx - 1), j, w10);
    add(i, Math.min(j + 1, world.gy - 1), w01);
    add(Math.min(i + 1, world.gx - 1), Math.min(j + 1, world.gy - 1), w11);
  }
  for (let k = 0; k < cells; k++) {
    const m = world.mass[k];
    if (m > 1e-6) {
      world.gvx[k] /= m;
      world.gvy[k] /= m;
    } else {
      world.gvx[k] = 0;
      world.gvy[k] = 0;
    }
    world.gvxOld[k] = world.gvx[k];
    world.gvyOld[k] = world.gvy[k];
  }
}

function project(world: FlipWorld): void {
  const { gx, gy } = world;
  const solid = 0.25;
  for (let iter = 0; iter < PRESSURE_ITERS; iter++) {
    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        const k = i + j * gx;
        if (world.mass[k] < solid) {
          world.pressure[k] = 0;
          continue;
        }
        const left = i > 0 ? world.gvx[k] - world.gvx[k - 1] : world.gvx[k];
        const down = j > 0 ? world.gvy[k] - world.gvy[k - gx] : world.gvy[k];
        const div = left + down;
        world.pressure[k] = world.pressure[k] * 0.4 - div * 0.35;
      }
    }
    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        const k = i + j * gx;
        if (world.mass[k] < solid) continue;
        if (i + 1 < gx) world.gvx[k] -= (world.pressure[k + 1] - world.pressure[k]) * 0.5;
        if (j + 1 < gy) world.gvy[k] -= (world.pressure[k + gx] - world.pressure[k]) * 0.5;
      }
    }
    // Solid walls: no outflow. j=0 is the floor (y-down in caller gravity).
    for (let j = 0; j < gy; j++) {
      world.gvx[j * gx] = Math.max(0, world.gvx[j * gx]);
      world.gvx[gx - 1 + j * gx] = Math.min(0, world.gvx[gx - 1 + j * gx]);
    }
    for (let i = 0; i < gx; i++) {
      world.gvy[i] = Math.min(0, world.gvy[i]); // floor: no further down
      world.gvy[i + (gy - 1) * gx] = Math.max(0, world.gvy[i + (gy - 1) * gx]);
    }
  }
}

function gather(world: FlipWorld, blend: number): void {
  const dx = world.width / world.gx;
  const dy = world.height / world.gy;
  const sample = (arr: Float64Array, x: number, y: number): number => {
    const fx = clamp(x / dx, 0, world.gx - 1.001);
    const fy = clamp(y / dy, 0, world.gy - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const i2 = Math.min(i + 1, world.gx - 1);
    const j2 = Math.min(j + 1, world.gy - 1);
    const a = arr[i + j * world.gx];
    const b = arr[i2 + j * world.gx];
    const c = arr[i + j2 * world.gx];
    const d = arr[i2 + j2 * world.gx];
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  };
  for (let p = 0; p < world.n; p++) {
    const picX = sample(world.gvx, world.xs[p], world.ys[p]);
    const picY = sample(world.gvy, world.xs[p], world.ys[p]);
    const oldX = sample(world.gvxOld, world.xs[p], world.ys[p]);
    const oldY = sample(world.gvyOld, world.xs[p], world.ys[p]);
    const flipX = world.vxs[p] + (picX - oldX);
    const flipY = world.vys[p] + (picY - oldY);
    world.vxs[p] = blend * flipX + (1 - blend) * picX;
    world.vys[p] = blend * flipY + (1 - blend) * picY;
  }
}

function collide(world: FlipWorld): void {
  const eps = 0.6;
  for (let p = 0; p < world.n; p++) {
    if (world.xs[p] < eps) {
      world.xs[p] = eps;
      world.vxs[p] = Math.abs(world.vxs[p]) * WALL_DAMP;
    } else if (world.xs[p] > world.width - eps) {
      world.xs[p] = world.width - eps;
      world.vxs[p] = -Math.abs(world.vxs[p]) * WALL_DAMP;
    }
    if (world.ys[p] < eps) {
      world.ys[p] = eps;
      world.vys[p] = Math.abs(world.vys[p]) * WALL_DAMP;
    } else if (world.ys[p] > world.height - eps) {
      world.ys[p] = world.height - eps;
      world.vys[p] = -Math.abs(world.vys[p]) * WALL_DAMP;
    }
  }
}

function restoreMean(world: FlipWorld, dt: number): void {
  let sum = 0;
  for (let p = 0; p < world.n; p++) sum += world.ys[p];
  const mean = sum / world.n;
  const target = world.restFill * world.height * 0.5;
  const err = target - mean;
  const kick = err * SETTLE_STIFFNESS * dt;
  const shift = err * 0.35;
  for (let p = 0; p < world.n; p++) {
    world.vys[p] += kick;
    world.ys[p] += shift;
  }
}

/**
 * Advance the world. Gravity is in tank-down units: {gx:0, gy:1} is phone
 * upright. dt is seconds. reducedMotion freezes velocities and reseeds
 * to the rest rectangle.
 */
export function stepFlip(
  world: FlipWorld,
  gravity: FlipGravity,
  dt: number,
  opts: { reducedMotion?: boolean; flipBlend?: number } = {},
): void {
  const step = clamp(finite(dt, 1 / 30), 1 / 120, 1 / 20);
  if (opts.reducedMotion) {
    for (let p = 0; p < world.n; p++) {
      world.vxs[p] = 0;
      world.vys[p] = 0;
    }
    seedParticles(world);
    return;
  }
  const g = clampGravity(gravity);
  const accel = 980; // px/s^2 scale at tank-down = 1
  // y = 0 is the tank floor. Caller gy = +1 means "down", so pull toward y = 0.
  for (let p = 0; p < world.n; p++) {
    world.vxs[p] += g.gx * accel * step;
    world.vys[p] -= g.gy * accel * step;
  }
  scatter(world);
  project(world);
  gather(world, opts.flipBlend ?? FLIP_BLEND);
  for (let p = 0; p < world.n; p++) {
    world.xs[p] += world.vxs[p] * step;
    world.ys[p] += world.vys[p] * step;
  }
  collide(world);
  restoreMean(world, step);
  collide(world);
}

/** Per-column free-surface height from the bottom, length FLIP_COLS. */
export function surfaceHeights(world: FlipWorld, cols = FLIP_COLS): number[] {
  const out = new Array(cols).fill(0);
  const counts = new Array(cols).fill(0);
  const rest = world.restFill * world.height;
  for (let p = 0; p < world.n; p++) {
    const c = clamp(Math.floor((world.xs[p] / world.width) * cols), 0, cols - 1);
    if (world.ys[p] > out[c]) out[c] = world.ys[p];
    counts[c]++;
  }
  for (let c = 0; c < cols; c++) {
    if (counts[c] === 0) out[c] = rest;
    // Local splash, but keep the average near rest.
    out[c] = clamp(out[c], rest * 0.35, Math.min(world.height, rest * 1.35));
  }
  // Smooth once so columns don't spike.
  const sm = out.slice();
  for (let c = 0; c < cols; c++) {
    const l = out[c === 0 ? c : c - 1];
    const r = out[c === cols - 1 ? c : c + 1];
    sm[c] = out[c] * 0.5 + l * 0.25 + r * 0.25;
  }
  return sm;
}

export function meanParticleHeight(world: FlipWorld): number {
  let s = 0;
  for (let p = 0; p < world.n; p++) s += world.ys[p];
  return s / world.n;
}

export function kineticEnergy(world: FlipWorld): number {
  let s = 0;
  for (let p = 0; p < world.n; p++) s += world.vxs[p] * world.vxs[p] + world.vys[p] * world.vys[p];
  return s / world.n;
}
