import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { runOnJS, useFrameCallback, useSharedValue, type SharedValue, type FrameInfo } from 'react-native-reanimated';

/** Water remains UI-thread driven. Sample the React labels at most 30 times
 * per second, only for visible tanks. A final frame is delivered even after
 * withTiming stops, without quantizing the level used by the calculations. */
export function useWellLevelDisplay(fill: SharedValue<number>, height: number, active: boolean, entryFraction: number, prepared = true) {
  const [feet, setFeet] = useState(() => entryFraction * height);
  const generation = useRef(0);
  const sampleGeneration = useSharedValue(0);
  const latest = useSharedValue({ feet: entryFraction * height, generation: 0 });
  const queued = useSharedValue(false);
  const publish = useCallback(() => {
    // At most one bridge task may wait behind JS rendering. Consume the newest
    // UI sample, not a historical frame that would replay after a fast swipe.
    const sample = latest.value;
    queued.value = false;
    if (sample.generation === generation.current) setFeet(sample.feet);
  }, [latest, queued]);
  const sent = useSharedValue({ fraction: -1, at: -Infinity, height: 0 });
  const sample = useCallback((info: FrameInfo) => {
    'worklet';
    const fraction = fill.value;
    const previous = sent.value;
    if (previous.fraction === fraction && previous.height === height) return;
    if (info.timestamp - previous.at < 1000 / 30) return;
    sent.value = { fraction, at: info.timestamp, height };
    latest.value = { feet: fraction * height, generation: sampleGeneration.value };
    if (!queued.value) {
      queued.value = true;
      runOnJS(publish)();
    }
  }, [fill, height, sent, publish, sampleGeneration, latest, queued]);
  const frame = useFrameCallback(sample, false);
  useLayoutEffect(() => {
    // The transition owner queues this same seed to the UI thread. A synchronous
    // fill.value read here can still see the PREVIOUS UI value before that task
    // runs. Use the captured seed directly, including for neighbours exposed
    // during a drag before the pager marks them active.
    sampleGeneration.value = ++generation.current;
    if (prepared || active) setFeet(entryFraction * height);
    if (active) {
      sent.value = { fraction: -1, at: -Infinity, height: 0 };
    }
  }, [active, fill, height, entryFraction, sent, sampleGeneration, prepared]);
  useEffect(() => {
    frame.setActive(active);
    return () => frame.setActive(false);
  }, [active, frame]);
  return feet;
}
