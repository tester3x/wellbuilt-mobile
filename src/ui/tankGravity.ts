import { clampGravity, type FlipGravity } from './flipFluid';

/** Android reports supporting acceleration; iOS reports gravity direction. */
export function tankGravityFromAccelerometer(x: number, y: number, platform: string): FlipGravity {
  const measured = clampGravity(platform === 'android' ? { gx: -x, gy: y } : { gx: x, gy: -y });
  // A phone flat on a table has gravity perpendicular to the display.
  // Keep the illustrated tank upright rather than feed near-zero gravity.
  if (Math.hypot(measured.gx, measured.gy) < 0.2) return { gx: 0, gy: 1 };
  // Reject stationary sensor noise, not deliberate tilt.
  return { gx: Math.abs(measured.gx) < 0.04 ? 0 : measured.gx, gy: measured.gy };
}
