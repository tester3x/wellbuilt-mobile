import { useCallback, useLayoutEffect, useRef } from 'react';
import { cancelAnimation, Easing, runOnJS, type SharedValue, withTiming } from 'react-native-reanimated';

export const WELL_ENTRY_DURATION_MS = 1000;
const REFRESH_DURATION_MS = 400;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** One owner for ordinary well levels. Pending-pull drains retain authority.
 * Offscreen cards are staged at the departing tank's captured visible fraction,
 * not their preloaded destination. Refresh/live targets cannot cut entry short.
 */
export function useWellLevelTransition({ fill, target, active, entryFraction, draining, reducedMotion }: {
  fill: SharedValue<number>; target: number | null; active: boolean;
  entryFraction: number; draining: boolean; reducedMotion: boolean;
}) {
  const state = useRef({ active: false, initialized: false, entering: false, generation: 0,
    target, draining, reducedMotion });
  state.current.target = target;
  state.current.draining = draining;
  state.current.reducedMotion = reducedMotion;

  const finishEntry = useCallback((generation: number, animatedTarget: number) => {
    const current = state.current;
    if (generation !== current.generation || !current.active || current.draining) return;
    current.entering = false;
    // A newer accepted observation waits until the entry finishes. Continue from
    // the current drawn value; never rewind to the departing well again.
    if (current.target !== null && Math.abs(current.target - animatedTarget) > 0.000001) {
      fill.value = current.reducedMotion ? clamp(current.target) : withTiming(clamp(current.target), {
        duration: REFRESH_DURATION_MS, easing: Easing.inOut(Easing.ease),
      });
    }
  }, [fill]);

  useLayoutEffect(() => {
    const current = state.current;
    const entered = active && !current.active;
    current.active = active;
    if (draining) {
      ++current.generation;
      current.entering = false;
      current.initialized = true;
      return; // Do not cancel or write over an in-progress pull drain.
    }
    if (!active) {
      ++current.generation;
      current.entering = false;
      current.initialized = false;
      cancelAnimation(fill);
      fill.value = clamp(entryFraction);
      return;
    }
    if (entered || !current.initialized) {
      if (entered) {
        ++current.generation;
        cancelAnimation(fill);
        fill.value = clamp(entryFraction);
      }
      if (target === null) return; // Keep the captured level until data arrives.
      current.initialized = true;
      current.entering = !reducedMotion;
      const generation = current.generation;
      fill.value = reducedMotion ? clamp(target) : withTiming(clamp(target), {
        duration: WELL_ENTRY_DURATION_MS, easing: Easing.inOut(Easing.ease),
      }, finished => {
        'worklet';
        if (finished) runOnJS(finishEntry)(generation, target);
      });
    } else if (!current.entering || reducedMotion) {
      if (target === null) return;
      if (reducedMotion) {
        ++current.generation;
        current.entering = false;
        cancelAnimation(fill);
      }
      fill.value = reducedMotion ? clamp(target) : withTiming(clamp(target), {
        duration: REFRESH_DURATION_MS, easing: Easing.inOut(Easing.ease),
      });
    }
  }, [active, target, entryFraction, draining, reducedMotion, fill, finishEntry]);

  useLayoutEffect(() => () => {
    ++state.current.generation;
    state.current.active = false;
    cancelAnimation(fill);
  }, [fill]);
}
