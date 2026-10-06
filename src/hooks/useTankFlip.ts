import { useEffect } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { createFlipWorld, setRestFill, stepFlip, FLIP_COLS } from '../ui/flipFluid';
import { softenedFluidSurface, decayRestingSurface, restingFluidOffsets, projectSurfaceOffsets } from '../ui/fluidSurface';
import { useTankGravity } from './useTankGravity';

/** FLIP is visual only. The operational shared fill is input, never output. */
export function useTankFlip(width: number, height: number, fill: SharedValue<number>, active: boolean, reducedMotion: boolean) {
  const offsets = useSharedValue<number[]>(Array(FLIP_COLS).fill(0));
  const gravity = useTankGravity(active && !reducedMotion);
  useEffect(() => {
    offsets.value = Array(FLIP_COLS).fill(0);
    if (!active || reducedMotion) return;
    let world = createFlipWorld(width, height, fill.value);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let last = Date.now();
    let stillSeconds = 0;
    let idle = false;
    let previousGravity = { ...gravity.current };
    let previousOffsets = Array(FLIP_COLS).fill(0);
    const tick = () => {
      if (stopped) return;
      const now = Date.now();
      const rest = Math.max(0, Math.min(1, fill.value));
      setRestFill(world, rest);
      const dt = Math.min(0.05, Math.max(1 / 120, (now - last) / 1000));
      last = now;
      const motion = Math.hypot(gravity.current.gx - previousGravity.gx, gravity.current.gy - previousGravity.gy);
      stillSeconds = motion < 0.012 ? stillSeconds + dt : 0;
      previousGravity = { ...gravity.current };
      if (stillSeconds > 1) {
        // At rest, sparse particle noise must not leave a permanent tilted surface.
        if (!idle) world = createFlipWorld(width, height, rest);
        idle = true;
        const equilibrium = restingFluidOffsets(gravity.current, width, height, rest, FLIP_COLS);
        const residual = previousOffsets.map((h, i) => h - equilibrium[i]);
        const settled = decayRestingSurface(residual, rest, height, dt);
        previousOffsets = projectSurfaceOffsets(equilibrium.map((h, i) => h + settled[i]), rest, height);
      } else {
        idle = false;
        stepFlip(world, gravity.current, dt);
        previousOffsets = softenedFluidSurface(world, previousOffsets, dt, gravity.current);
      }
      offsets.value = previousOffsets;
      timer = setTimeout(tick, 42);
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); offsets.value = Array(FLIP_COLS).fill(0); };
  }, [active, reducedMotion, width, height, fill, gravity, offsets]);
  return offsets;
}
