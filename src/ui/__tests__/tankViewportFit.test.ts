import { tankSceneScale, tankViewport } from '../tankViewport';

test.each([
  ['S24 portrait', 360, 780, 255],
  ['Fold cover', 384, 900, 280],
  ['Fold unfolded', 748, 690, 175],
  ['tablet landscape', 1280, 720, 230],
  ['short landscape', 800, 360, 40],
] as const)('%s fits the tank in the measured remainder without taking control space', (_, width, height, remaining) => {
  const { cardWidth } = tankViewport(width, height);
  const scale = tankSceneScale(cardWidth, remaining, 300, 360);
  expect(scale * 360).toBeLessThanOrEqual(remaining);
  expect(scale * 300).toBeLessThanOrEqual(cardWidth - 24);
  expect(scale).toBeGreaterThan(0);
});

test('folding and resizing use each new slot instead of the launch-time window height', () => {
  const portrait = tankSceneScale(384, 300, 300, 360);
  const unfolded = tankSceneScale(374, 150, 300, 360);
  expect(unfolded).toBeLessThan(portrait);
  expect(unfolded * 360).toBe(150);
  expect(tankSceneScale(384, 300, 300, 360)).toBe(portrait);
});

test('unmeasured or exhausted slots do not impose a minimum overflowing tank size', () => {
  expect(tankSceneScale(360, 0, 300, 360)).toBe(0);
  expect(tankSceneScale(360, 12, 300, 360) * 360).toBe(12);
  expect(tankSceneScale(20, 100, 300, 360)).toBe(0);
  expect(tankSceneScale(360, NaN, 300, 360)).toBe(0);
});
