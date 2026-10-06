import { clampGravity, type FlipGravity } from './flipFluid';

/** Android reports supporting acceleration; iOS reports gravity direction. */
export function tankGravityFromAccelerometer(x: number, y: number, platform: string): FlipGravity {
  return clampGravity(platform === 'android' ? { gx: -x, gy: y } : { gx: x, gy: -y });
}
