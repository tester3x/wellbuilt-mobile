import { useEffect, useRef, type MutableRefObject } from 'react';
import { tankMotionImpulse, type TankMotion } from '../ui/tankMotion';
import { Accelerometer, DeviceMotion } from 'expo-sensors';
import { Platform } from 'react-native';
import { tankGravityFromAccelerometer, gravityInDisplayAxes } from '../ui/tankGravity';
import { clampGravity, type FlipGravity } from '../ui/flipFluid';

/** One sensor subscription for the visible tank; no React renders per sample. */
export function useTankGravity(enabled: boolean, motion?: MutableRefObject<TankMotion>) {
  const gravity = useRef<FlipGravity>({ gx: 0, gy: 1 });
  useEffect(() => {
    gravity.current = { gx: 0, gy: 1 };
    if (!enabled || Platform.OS === 'web') return;
    let disposed = false;
    let rotation=0;
    let latestRaw:{x:number;y:number;z:number}|undefined;
    let baseline: { x: number; y: number; z: number } | undefined;
    if (motion) motion.current = { gx: 0, gy: 0, energy: 0, sampledAt: 0 };
    let subscription: ReturnType<typeof Accelerometer.addListener> | undefined;
    let orientationSubscription: ReturnType<typeof DeviceMotion.addListener> | undefined;
    // Expo reads the actual display Surface rotation; aspect ratio cannot distinguish left/right.
    DeviceMotion?.isAvailableAsync().then(available=>{
      if(!available||disposed)return;
      DeviceMotion.setUpdateInterval(100);
      orientationSubscription=DeviceMotion.addListener(sample=>{
        if(rotation===sample.orientation)return;
        rotation=sample.orientation;baseline=latestRaw;
        if(latestRaw)gravity.current=tankGravityFromAccelerometer(latestRaw.x,latestRaw.y,Platform.OS,rotation);
        if(motion)motion.current={gx:0,gy:0,energy:0,sampledAt:Date.now()};
      });
    }).catch(()=>{});
    Accelerometer.isAvailableAsync().then(available => {
      if (!available || disposed) return;
      Accelerometer.setUpdateInterval(50);
      subscription = Accelerometer.addListener(({ x, y, z = 0 }) => {
        const raw = { x, y, z };latestRaw=raw;
        if (!baseline) baseline = raw;
        if (motion) {
          const impulse=tankMotionImpulse(raw,baseline,Platform.OS,Date.now());
          motion.current={...impulse,...gravityInDisplayAxes(impulse,rotation)};
        }
        // Slow baseline extracts translation/shake independently of held orientation.
        baseline = { x: baseline.x * 0.85 + x * 0.15, y: baseline.y * 0.85 + y * 0.15, z: baseline.z * 0.85 + z * 0.15 };
        const measured = tankGravityFromAccelerometer(x, y, Platform.OS,rotation);
        const old = gravity.current;
        gravity.current = clampGravity({ gx: old.gx * 0.7 + measured.gx * 0.3, gy: old.gy * 0.7 + measured.gy * 0.3 });
      });
    }).catch(() => { /* Cosmetic layer stays upright when sensors are unavailable. */ });
    return () => { disposed = true; subscription?.remove(); orientationSubscription?.remove(); gravity.current = { gx: 0, gy: 1 }; };
  }, [enabled, motion]);
  return gravity;
}
