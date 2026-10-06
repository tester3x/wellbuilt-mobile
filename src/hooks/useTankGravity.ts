import { useEffect, useRef } from 'react';
import { Accelerometer } from 'expo-sensors';
import { Platform } from 'react-native';
import { tankGravityFromAccelerometer } from '../ui/tankGravity';
import { clampGravity, type FlipGravity } from '../ui/flipFluid';

/** One sensor subscription for the visible tank; no React renders per sample. */
export function useTankGravity(enabled: boolean) {
  const gravity = useRef<FlipGravity>({ gx: 0, gy: 1 });
  useEffect(() => {
    gravity.current = { gx: 0, gy: 1 };
    if (!enabled || Platform.OS === 'web') return;
    let disposed = false;
    let subscription: ReturnType<typeof Accelerometer.addListener> | undefined;
    Accelerometer.isAvailableAsync().then(available => {
      if (!available || disposed) return;
      Accelerometer.setUpdateInterval(200);
      subscription = Accelerometer.addListener(({ x, y }) => {
        const measured = tankGravityFromAccelerometer(x, y, Platform.OS);
        const old = gravity.current;
        gravity.current = clampGravity({ gx: old.gx * 0.7 + measured.gx * 0.3, gy: old.gy * 0.7 + measured.gy * 0.3 });
      });
    }).catch(() => { /* Cosmetic layer stays upright when sensors are unavailable. */ });
    return () => { disposed = true; subscription?.remove(); gravity.current = { gx: 0, gy: 1 }; };
  }, [enabled]);
  return gravity;
}
