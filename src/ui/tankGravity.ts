import { clampGravity, type FlipGravity } from './flipFluid';

/** Android reports supporting acceleration; iOS reports gravity direction. */
export function gravityInDisplayAxes(gravity:FlipGravity,rotation=0):FlipGravity {
 const angle=(Number.isFinite(rotation)?rotation:0)*Math.PI/180;
 const c=Math.cos(angle),s=Math.sin(angle);
 return {gx:gravity.gx*c+gravity.gy*s,gy:-gravity.gx*s+gravity.gy*c};
}
export function tankGravityFromAccelerometer(x: number, y: number, platform: string,rotation=0): FlipGravity {
  const measured = clampGravity(gravityInDisplayAxes(platform === 'android' ? { gx: -x, gy: y } : { gx: x, gy: -y },rotation));
  // A phone flat on a table has gravity perpendicular to the display.
  // Keep the illustrated tank upright rather than feed near-zero gravity.
  if (Math.hypot(measured.gx, measured.gy) < 0.2) return { gx: 0, gy: 1 };
  // Reject stationary sensor noise, not deliberate tilt.
  return { gx: Math.abs(measured.gx) < 0.04 ? 0 : measured.gx, gy: measured.gy };
}
