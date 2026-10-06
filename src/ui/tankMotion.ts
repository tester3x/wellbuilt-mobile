export type TankMotion = { gx: number; gy: number; energy: number; sampledAt: number };
export function tankMotionImpulse(raw: { x: number; y: number; z: number }, baseline: { x: number; y: number; z: number }, platform: string, sampledAt: number): TankMotion {
  const sign = platform === 'android' ? -1 : 1;
  const dx = raw.x - baseline.x, dy = raw.y - baseline.y, dz = raw.z - baseline.z;
  const magnitude = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(magnitude) || magnitude < 0.08) return { gx: 0, gy: 0, energy: 0, sampledAt };
  const cap = (n: number) => Math.max(-2, Math.min(2, n));
  return { gx: cap(sign * dx), gy: cap(-sign * dy), energy: Math.min(1, (magnitude - 0.08) / 1.5), sampledAt };
}
