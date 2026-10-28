import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useWellLevelTransition, WELL_ENTRY_DURATION_MS } from '../useWellLevelTransition';
import { tankFillFraction } from '../../utils/tankHeight';

const mockTiming = jest.fn((target: number, config: any, complete?: (finished: boolean) => void) => ({ target, config, complete }));
const mockCancel = jest.fn((fill: any) => { fill.animation = null; });
jest.mock('react-native-reanimated', () => ({
  cancelAnimation: (fill: unknown) => mockCancel(fill),
  withTiming: (...args: Parameters<typeof mockTiming>) => mockTiming(...args),
  Easing: { ease: 'ease', inOut: (value: unknown) => value },
  runOnJS: (fn: unknown) => fn,
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function water() {
  let drawn = 0;
  const fill = {
    animation: null as any,
    writes: [] as any[],
    get value() { return drawn; },
    set value(value: any) {
      this.writes.push({ from: drawn, value });
      if (typeof value === 'number') { drawn = value; this.animation = null; }
      else this.animation = value;
    },
    sample(value: number) { drawn = value; },
    finish() {
      const animation = this.animation;
      drawn = animation.target; this.animation = null;
      animation.complete?.(true);
    },
  };
  return fill;
}
type Props = Parameters<typeof useWellLevelTransition>[0];
function Tank(props: Props) { useWellLevelTransition(props); return null; }
function mount(overrides: Partial<Props> = {}) {
  const fill = water();
  let props: Props = { fill: fill as any, target: 0.8, active: false, entryFraction: 0.2, draining: false, reducedMotion: false, ...overrides };
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => { tree = TestRenderer.create(React.createElement(Tank, props)); });
  return { fill, update(next: Partial<Props>) { props = { ...props, ...next }; act(() => tree.update(React.createElement(Tank, props))); },
    unmount() { act(() => tree.unmount()); } };
}
beforeEach(() => { jest.clearAllMocks(); });

test('preloaded destination starts at the departing frame and refresh cannot shorten entry', () => {
  const h = mount();
  expect(h.fill.value).toBe(0.2); // Already staged before the new card becomes visible.
  expect(mockTiming).not.toHaveBeenCalled();
  h.update({ active: true });
  expect(h.fill.writes.at(-1).from).toBe(0.2);
  expect(h.fill.animation).toMatchObject({ target: 0.8, config: { duration: WELL_ENTRY_DURATION_MS } });
  h.fill.sample(0.45);
  h.update({ target: 0.81 }); // A storage refresh/live estimate arrives mid-grow.
  expect(mockTiming).toHaveBeenCalledTimes(1);
  expect(h.fill.value).toBe(0.45);
  act(() => h.fill.finish());
  expect(h.fill.writes.at(-1)).toMatchObject({ from: 0.8, value: { target: 0.81 } });
  h.unmount();
});

test('a shrinking well and rapid reversal use the most recently drawn fraction', () => {
  const h = mount({ entryFraction: 0.85, target: 0.15, active: true });
  expect(h.fill.writes.at(-1).from).toBe(0.85);
  const abandoned = h.fill.animation;
  h.fill.sample(0.62);
  h.update({ active: false, entryFraction: 0.62 });
  h.update({ active: true, target: 0.9 });
  expect(h.fill.writes.at(-1).from).toBe(0.62);
  const current = h.fill.animation;
  act(() => abandoned.complete(true));
  expect(h.fill.animation).toBe(current); // A late old callback cannot retarget the new entry.
  h.unmount();
});

test('activation before data arrives holds the captured source until the target is ready', () => {
  const h = mount({ active: true, target: null, entryFraction: 0.33 });
  expect(h.fill.value).toBe(0.33);
  expect(mockTiming).not.toHaveBeenCalled();
  h.update({ target: 0.75 });
  expect(h.fill.writes.at(-1).from).toBe(0.33);
  expect(h.fill.animation.config.duration).toBe(WELL_ENTRY_DURATION_MS);
  h.unmount();
});

test('an accepted refresh on the mounted well applies without a swipe or source reset', () => {
  const h = mount({ active: true, target: 0.5 });
  act(() => h.fill.finish());
  h.update({ target: 0.25 });
  expect(h.fill.writes.at(-1)).toMatchObject({ from: 0.5, value: { target: 0.25, config: { duration: 400 } } });
  h.unmount();
});

test('ordinary updates never overwrite an authoritative pending-pull drain', () => {
  const h = mount({ active: true });
  const abandoned = h.fill.animation;
  h.fill.sample(0.4);
  h.fill.writes.length = 0;
  h.update({ draining: true, target: 0.1 });
  act(() => abandoned.complete(true));
  expect(h.fill.writes).toEqual([]);
  h.update({ draining: false });
  expect(h.fill.writes.at(-1).from).toBe(0.4);
  h.unmount();
});

test.each([20, 25])('%s-foot target uses actual height and reduced motion skips the animation', height => {
  const h = mount({ target: tankFillFraction(10, height), active: true, reducedMotion: true });
  expect(h.fill.value).toBe(10 / height);
  expect(mockTiming).not.toHaveBeenCalled();
  h.unmount();
});

test('two visible tanks have independent entry and refresh state', () => {
  const left = mount({ active: true, target: 0.3 });
  const right = mount({ active: true, target: 0.9 });
  left.update({ target: 0.35 });
  act(() => left.fill.finish());
  expect(left.fill.animation.target).toBe(0.35);
  expect(right.fill.animation.target).toBe(0.9);
  left.unmount(); right.unmount();
});
