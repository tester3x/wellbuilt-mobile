/**
 * Phone IMU → tank gravity. Portrait rest is tank-down (gy = 1).
 * Accelerometer supplies gravity/linear; gyroscope adds a bounded twist
 * impulse. Noise is low-pass filtered; magnitude is clamped. No-ops when
 * disabled (background / reduced motion) or when expo-sensors is absent.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { FlipGravity } from '../ui/flipFluid';
import { clampGravity } from '../ui/flipFluid';

type AccelMod = {
  Accelerometer: {
    setUpdateInterval: (ms: number) => void;
    addListener: (fn: (a: { x: number; y: number; z: number }) => void) => { remove: () => void };
  };
  Gyroscope: {
    setUpdateInterval: (ms: number) => void;
    addListener: (fn: (a: { x: number; y: number; z: number }) => void) => { remove: () => void };
  };
};

function loadSensors(): AccelMod | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-sensors') as AccelMod;
  } catch {
    return null;
  }
}

const LP = 0.18;
const REST: FlipGravity = { gx: 0, gy: 1 };

export function useTankImu(enabled: boolean): FlipGravity {
  const [g, setG] = useState<FlipGravity>(REST);
  const acc = useRef({ x: 0, y: -1, z: 0 });
  const gyroZ = useRef(0);
  const fg = useRef(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      fg.current = s === 'active';
      if (s !== 'active') setG(REST);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!enabled) {
      setG(REST);
      return;
    }
    const sensors = loadSensors();
    if (!sensors) return;
    sensors.Accelerometer.setUpdateInterval(50);
    sensors.Gyroscope.setUpdateInterval(50);
    const aSub = sensors.Accelerometer.addListener((a) => {
      acc.current = {
        x: acc.current.x * (1 - LP) + a.x * LP,
        y: acc.current.y * (1 - LP) + a.y * LP,
        z: acc.current.z * (1 - LP) + a.z * LP,
      };
      if (!fg.current) return;
      // Device y is up; tank y is down. Resting portrait ≈ ay = -1 → gy = 1.
      const raw: FlipGravity = {
        gx: acc.current.x + gyroZ.current * 0.12,
        gy: -acc.current.y,
      };
      setG(clampGravity(raw));
    });
    const gSub = sensors.Gyroscope.addListener((gz) => {
      gyroZ.current = gyroZ.current * 0.7 + gz.z * 0.3;
    });
    return () => {
      aSub.remove();
      gSub.remove();
      gyroZ.current = 0;
    };
  }, [enabled]);

  return enabled ? g : REST;
}
