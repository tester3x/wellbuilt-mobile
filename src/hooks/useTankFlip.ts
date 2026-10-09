import { useEffect, useRef } from 'react';
import { type TankMotion } from '../ui/tankMotion';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { createFlipWorld, setRestFill, stepFlip, FLIP_COLS } from '../ui/flipFluid';
import { softenedFluidSurface, decayRestingSurface, restingFluidOffsets, projectSurfaceOffsets } from '../ui/fluidSurface';
import { useTankGravity } from './useTankGravity';

/** FLIP is visual only. The operational shared fill is input, never output. */
export function useTankFlip(width: number, height: number, fill: SharedValue<number>, active: boolean, reducedMotion: boolean, inverted?: SharedValue<boolean>, orientation?: SharedValue<number>) {
  const offsets = useSharedValue<number[]>(Array(FLIP_COLS).fill(0));
  const acceleration = useRef<TankMotion>({ gx: 0, gy: 0, energy: 0, sampledAt: 0 });
  const gravity = useTankGravity(active && !reducedMotion, acceleration);
  useEffect(() => {
    offsets.value = Array(FLIP_COLS).fill(0);
    if (inverted) inverted.value = false;
    if (orientation) orientation.value = 0;
    if (!active || reducedMotion) return;
    let world = createFlipWorld(width, height, fill.value);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let last = Date.now();
    let stillSeconds = 0;
    let idle = false;
    let lastImpulse = -1;
    let topAnchored = false;
    let previousGravity = { ...gravity.current };
    let previousOffsets = Array(FLIP_COLS).fill(0);
    const tick = () => {
      if (stopped) return;
      const now = Date.now();
      const rest = Math.max(0, Math.min(1, fill.value));
      setRestFill(world, rest);
      const dt = Math.min(0.05, Math.max(1 / 120, (now - last) / 1000));
      last = now;
      // Hysteresis prevents anchor chatter while crossing sideways gravity.
      const nextAnchor = gravity.current.gy < -0.08 ? true : gravity.current.gy > 0.08 ? false : topAnchored;
      if (nextAnchor !== topAnchored) {
        topAnchored = nextAnchor;
        world = createFlipWorld(width, height, rest);
        // Sideways water already spans both anchors. Keep its depth profile
        // across the switch instead of flashing a flat, half-full tank.
        stillSeconds = 0;
        idle = false;
      }
      if (inverted) inverted.value = topAnchored;
      if (orientation) orientation.value = Math.atan2(-gravity.current.gx, gravity.current.gy);
      // Simulate depth away from whichever wall is down in screen coordinates.
      const depthGravity = { gx: gravity.current.gx, gy: Math.abs(gravity.current.gy) };
      const motion = Math.hypot(gravity.current.gx - previousGravity.gx, gravity.current.gy - previousGravity.gy);
      const impulse = acceleration.current;
      const fresh = now - impulse.sampledAt < 150;
      const energy = fresh ? impulse.energy : 0;
      stillSeconds = motion < 0.012 && energy < 0.02 ? stillSeconds + dt : 0;
      previousGravity = { ...gravity.current };
      if (stillSeconds > 1) {
        // At rest, sparse particle noise must not leave a permanent tilted surface.
        if (!idle) world = createFlipWorld(width, height, rest);
        idle = true;
        const equilibrium = restingFluidOffsets(depthGravity, width, height, rest, FLIP_COLS);
        const residual = previousOffsets.map((h, i) => h - equilibrium[i]);
        const settled = decayRestingSurface(residual, rest, height, dt);
        previousOffsets = projectSurfaceOffsets(equilibrium.map((h, i) => h + settled[i]), rest, height);
      } else {
        idle = false;
        if (fresh && impulse.sampledAt !== lastImpulse && energy > 0) {
          lastImpulse = impulse.sampledAt;
          for (let p = 0; p < world.n; p++) {
            world.vxs[p] += impulse.gx * width * 0.12;
            world.vys[p] += Math.sin(world.xs[p] / width * Math.PI * 2) * energy * height * 0.12;
          }
        }
        stepFlip(world, depthGravity, dt);
        previousOffsets = softenedFluidSurface(world, previousOffsets, dt, depthGravity, energy);
      }
      offsets.value = previousOffsets;
      timer = setTimeout(tick, 42);
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); offsets.value = Array(FLIP_COLS).fill(0); };
  }, [active, reducedMotion, width, height, fill, gravity, offsets, inverted, orientation]);
  return offsets;
}
