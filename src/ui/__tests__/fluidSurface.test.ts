import { createFlipWorld, stepFlip, meanSurfaceHeight, FLIP_COLS } from '../flipFluid';
import { softenedFluidSurface, isRestingTankGravity, decayRestingSurface, restingFluidOffsets } from '../fluidSurface';
describe('soft FLIP surface', () => {
  it.each([0.01, 0.2, 0.5, 0.9, 0.99])('bounds relief and conserves fill at %s', fill => {
    const world = createFlipWorld(180, 280, fill);
    let offsets = Array(FLIP_COLS).fill(0);
    for (let frame = 0; frame < 180; frame++) {
      stepFlip(world, { gx: 1.2, gy: 0.5 }, 1 / 24);
      offsets = softenedFluidSurface(world, offsets, 1 / 24);
      expect(meanSurfaceHeight(offsets)).toBeCloseTo(0, 6);
      expect(Math.max(...offsets.map(Math.abs))).toBeLessThanOrEqual(14.000001);
      offsets.forEach(h => { expect(fill * 280 + h).toBeGreaterThanOrEqual(-1e-6); expect(fill * 280 + h).toBeLessThanOrEqual(280.000001); });
    }
    for (let i = 1; i < offsets.length - 1; i++) {
      expect(Math.abs(offsets[i + 1] - 2 * offsets[i] + offsets[i - 1])).toBeLessThan(4);
    }
  });
  it('recognizes upright rest but does not suppress deliberate tilt', () => {
    expect(isRestingTankGravity({ gx: 0, gy: 1 })).toBe(true);
    expect(isRestingTankGravity({ gx: 0.2, gy: 0.98 })).toBe(false);
  });
});

describe('resting surface', () => {
  it('settles exactly level without changing fill', () => {
    let offsets = Array.from({ length: 16 }, (_, i) => i - 7.5);
    for (let i = 0; i < 80; i++) offsets = decayRestingSurface(offsets, 0.5, 280, 1 / 24);
    expect(offsets).toEqual(Array(16).fill(0));
  });
  it.each([0, 1])('empty/full fill %s has no surface relief', fill => {
    const old = Array(16).fill(20);
    const world = createFlipWorld(180, 280, fill);
    expect(softenedFluidSurface(world, old, 1 / 24)).toEqual(Array(16).fill(0));
    expect(decayRestingSurface(old, fill, 280, 1 / 24)).toEqual(Array(16).fill(0));
  });
});

it('a held tilt rests on a straight, volume-conserving surface', () => {
  const offsets = restingFluidOffsets({ gx: 0.4, gy: 0.9 }, 180, 280, 0.5, 16);
  expect(meanSurfaceHeight(offsets)).toBeCloseTo(0, 8);
  for (let i = 1; i < 15; i++) expect(offsets[i + 1] - 2 * offsets[i] + offsets[i - 1]).toBeCloseTo(0, 8);
  expect(offsets[15]).toBeGreaterThan(offsets[0]);
});

it.each([0.2, 0.56, 0.9])('a nearly sideways held phone moves water to the low wall at fill %s', fill => {
  const offsets = restingFluidOffsets({ gx: -1, gy: 0.01 }, 180, 280, fill, 16);
  const heights = offsets.map(o => o + fill * 280);
  expect(heights[0]).toBeCloseTo(280, 5);
  expect(heights[15]).toBeCloseTo(0, 5);
  expect(meanSurfaceHeight(heights)).toBeCloseTo(fill * 280, 5);
  for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeLessThanOrEqual(heights[i - 1] + 1e-6);
});
