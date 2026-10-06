import { tankGravityFromAccelerometer } from '../tankGravity';
describe('platform sensor coordinates', () => {
  it('maps upright portrait to tank-down on both platforms', () => {
    expect(tankGravityFromAccelerometer(0, 1, 'android')).toEqual({ gx: -0, gy: 1 });
    expect(tankGravityFromAccelerometer(0, -1, 'ios')).toEqual({ gx: 0, gy: 1 });
  });
  it('maps matching rightward tilt to matching fluid acceleration', () => {
    expect(tankGravityFromAccelerometer(-0.6, 0.8, 'android')).toEqual(tankGravityFromAccelerometer(0.6, -0.8, 'ios'));
  });
  it('clamps excessive movement and rejects nonfinite readings', () => {
    expect(tankGravityFromAccelerometer(NaN, Infinity, 'android')).toEqual({ gx: 0, gy: 0 });
    const g = tankGravityFromAccelerometer(100, 100, 'android');
    expect(Math.hypot(g.gx, g.gy)).toBeCloseTo(4);
  });
});
