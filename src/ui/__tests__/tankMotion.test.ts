import { tankMotionImpulse } from '../tankMotion';
const base = { x: 0, y: 1, z: 0 };
it('rejects stationary noise, and faster lateral movement produces stronger directed forcing', () => {
  expect(tankMotionImpulse({ x: 0.02, y: 1, z: 0.01 }, base, 'android', 1).energy).toBe(0);
  const slow = tankMotionImpulse({ x: 0.2, y: 1, z: 0 }, base, 'android', 2);
  const fast = tankMotionImpulse({ x: 1, y: 1, z: 0 }, base, 'android', 3);
  expect(fast.energy).toBeGreaterThan(slow.energy);
  expect(fast.gx).toBeLessThan(slow.gx);
  expect(tankMotionImpulse({ x: -1, y: 1, z: 0 }, base, 'android', 4).gx).toBeGreaterThan(0);
});
it('detects out-of-plane shakes and caps violent input', () => {
  expect(tankMotionImpulse({ x: 0, y: 1, z: 2 }, base, 'android', 1).energy).toBe(1);
  const violent = tankMotionImpulse({ x: 100, y: -100, z: 100 }, base, 'android', 1);
  expect(violent.energy).toBe(1);
  expect(Math.abs(violent.gx)).toBe(2);
  expect(Math.abs(violent.gy)).toBe(2);
});
