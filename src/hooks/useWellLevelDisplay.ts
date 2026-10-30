import { useCallback, useEffect, useState } from 'react';
import { runOnJS, useFrameCallback, useSharedValue, type SharedValue, type FrameInfo } from 'react-native-reanimated';

/** Water remains UI-thread driven. Sample the React labels at most 30 times
 * per second, only for visible tanks. A final frame is delivered even after
 * withTiming stops, without quantizing the level used by the calculations. */
export function useWellLevelDisplay(fill: SharedValue<number>, height: number, active: boolean) {
  const [feet, setFeet] = useState(0);
  const sent = useSharedValue({ fraction: -1, at: -Infinity, height: 0 });
  const sample = useCallback((info: FrameInfo) => {
    'worklet';
    const fraction = fill.value;
    const previous = sent.value;
    if (previous.fraction === fraction && previous.height === height) return;
    if (info.timestamp - previous.at < 1000 / 30) return;
    sent.value = { fraction, at: info.timestamp, height };
    runOnJS(setFeet)(fraction * height);
  }, [fill, height, sent]);
  const frame = useFrameCallback(sample, false);
  useEffect(() => {
    frame.setActive(active);
    return () => frame.setActive(false);
  }, [active, frame]);
  return feet;
}
