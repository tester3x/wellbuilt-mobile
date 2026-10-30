import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { runOnJS, useFrameCallback, useSharedValue, type SharedValue, type FrameInfo } from 'react-native-reanimated';

/** Water remains UI-thread driven. Sample the React labels at most 30 times
 * per second, only for visible tanks. A final frame is delivered even after
 * withTiming stops, without quantizing the level used by the calculations. */
export function useWellLevelDisplay(fill: SharedValue<number>, height: number, active: boolean, entryFraction: number) {
  const [feet, setFeet] = useState(() => entryFraction * height);
  const generation = useRef(0);
  const sampleGeneration = useSharedValue(0);
  const publish = useCallback((nextFeet: number, sampledGeneration: number) => {
    if (sampledGeneration === generation.current) setFeet(nextFeet);
  }, []);
  const sent = useSharedValue({ fraction: -1, at: -Infinity, height: 0 });
  const sample = useCallback((info: FrameInfo) => {
    'worklet';
    const fraction = fill.value;
    const previous = sent.value;
    if (previous.fraction === fraction && previous.height === height) return;
    if (info.timestamp - previous.at < 1000 / 30) return;
    sent.value = { fraction, at: info.timestamp, height };
    runOnJS(publish)(fraction * height, sampleGeneration.value);
  }, [fill, height, sent, publish, sampleGeneration]);
  const frame = useFrameCallback(sample, false);
  useLayoutEffect(() => {
    // Offscreen water is staged by the transition owner's layout effect. Its
    // label must catch up before this card is painted, rather than showing the
    // mount-time zero until a UI frame crosses back to React.
    // Stage neighbours too: they are already exposed during a drag before the
    // pager marks them active. This runs once per seed/activation, not per frame.
    sampleGeneration.value = ++generation.current;
    setFeet(fill.value * height);
    if (active) {
      sent.value = { fraction: -1, at: -Infinity, height: 0 };
    }
  }, [active, fill, height, entryFraction, sent, sampleGeneration]);
  useEffect(() => {
    frame.setActive(active);
    return () => frame.setActive(false);
  }, [active, frame]);
  return feet;
}
