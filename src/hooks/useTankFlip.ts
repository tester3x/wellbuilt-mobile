import { useEffect } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { createFlipWorld, setRestFill, stepFlip, surfaceHeights, FLIP_COLS } from '../ui/flipFluid';
import { useTankGravity } from './useTankGravity';

/** FLIP is visual only. The operational shared fill is input, never output. */
export function useTankFlip(width: number, height: number, fill: SharedValue<number>, active: boolean, reducedMotion: boolean) {
  const offsets = useSharedValue<number[]>(Array(FLIP_COLS).fill(0));
  const gravity = useTankGravity(active && !reducedMotion);
  useEffect(() => {
    offsets.value = Array(FLIP_COLS).fill(0);
    if (!active || reducedMotion) return;
    const world = createFlipWorld(width, height, fill.value);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let last = Date.now();
    const tick = () => {
      if (stopped) return;
      const now = Date.now();
      const rest = Math.max(0, Math.min(1, fill.value));
      setRestFill(world, rest);
      stepFlip(world, gravity.current, Math.min(0.05, (now - last) / 1000));
      last = now;
      offsets.value = surfaceHeights(world).map(h => h - rest * height);
      timer = setTimeout(tick, 42);
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); offsets.value = Array(FLIP_COLS).fill(0); };
  }, [active, reducedMotion, width, height, fill, gravity, offsets]);
  return offsets;
}
