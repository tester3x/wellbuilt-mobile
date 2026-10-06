import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Accelerometer } from 'expo-sensors';
import { useTankFlip } from '../useTankFlip';
import { useTankGravity } from '../useTankGravity';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-sensors', () => ({ Accelerometer: {
  isAvailableAsync: jest.fn(async () => true), setUpdateInterval: jest.fn(),
  addListener: jest.fn(() => ({ remove: mockRemove })),
} }));
const mockRemove = jest.fn();
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (initial: unknown) => React.useRef({ value: initial }).current,
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const fill = { value: 0.5 } as any;
let surface: any;
const inverted = { value: false } as any;
function Tank({ active = true, reduced = false }) {
  surface = useTankFlip(120, 200, fill, active, reduced, inverted);
  return null;
}
describe('FLIP lifecycle', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); fill.value = 0.5; });
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  it('has one timer and sensor, leaves operational fill intact, and stops on background', async () => {
    const schedule = jest.spyOn(globalThis, 'setTimeout');
    const clear = jest.spyOn(globalThis, 'clearTimeout');
    const ticks = () => schedule.mock.calls.filter(call => call[1] === 42).length;
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => { tree = TestRenderer.create(React.createElement(Tank)); });
    expect(Accelerometer.addListener).toHaveBeenCalledTimes(1);
    expect(ticks()).toBe(1);
    act(() => { jest.advanceTimersByTime(420); });
    expect(fill.value).toBe(0.5);
    expect(ticks()).toBe(11);
    await act(async () => { tree.update(React.createElement(Tank, { active: false })); });
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalled();
    const stoppedAt = ticks();
    act(() => { jest.advanceTimersByTime(420); });
    expect(ticks()).toBe(stoppedAt);
    await act(async () => { tree.update(React.createElement(Tank)); });
    expect(ticks()).toBe(stoppedAt + 1);
    await act(async () => { tree.unmount(); });
    expect(mockRemove).toHaveBeenCalledTimes(2);
    const unmountedAt = ticks();
    act(() => { jest.advanceTimersByTime(420); });
    expect(ticks()).toBe(unmountedAt);
  });
  it('reduced motion creates no timer or sensor', async () => {
    const schedule = jest.spyOn(globalThis, 'setTimeout');
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => { tree = TestRenderer.create(React.createElement(Tank, { reduced: true })); });
    expect(Accelerometer.addListener).not.toHaveBeenCalled();
    expect(schedule.mock.calls.filter(call => call[1] === 42)).toHaveLength(0);
    await act(async () => { tree.unmount(); });
  });
  it('does not attach a late sensor after unmount', async () => {
    let resolve!: (available: boolean) => void;
    (Accelerometer.isAvailableAsync as jest.Mock).mockImplementationOnce(() => new Promise<boolean>(r => { resolve = r; }));
    function Sensor() { useTankGravity(true); return null; }
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => { tree = TestRenderer.create(React.createElement(Sensor)); });
    await act(async () => { tree.unmount(); });
    await act(async () => { resolve(true); });
    expect(Accelerometer.addListener).not.toHaveBeenCalled();
  });
});

it.each([{ name: 'upright', x: 0, y: 1 }, { name: 'flat table', x: 0.02, y: 0.01 }])('returns the live tank to exactly level at rest: $name', async (reading) => {
  jest.useFakeTimers();
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(React.createElement(Tank)); });
  const sample = (Accelerometer.addListener as jest.Mock).mock.calls.at(-1)[0];
  act(() => { sample({ x: -1, y: 1 }); jest.advanceTimersByTime(1000); });
  expect(surface.value.some((h: number) => Math.abs(h) > 0.05)).toBe(true);
  act(() => {
    for (let i = 0; i < 12; i++) { sample(reading); jest.advanceTimersByTime(200); }
    jest.advanceTimersByTime(6000);
  });
  expect(surface.value).toEqual(Array(16).fill(0));
  act(() => { jest.advanceTimersByTime(30000); });
  expect(surface.value).toEqual(Array(16).fill(0));
  expect(fill.value).toBe(0.5);
  await act(async () => { tree.unmount(); });
  jest.useRealTimers();
});


it('inverts the rendered water wall and returns upright without changing volume', async () => {
  jest.useFakeTimers();
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(React.createElement(Tank)); });
  const sample = (Accelerometer.addListener as jest.Mock).mock.calls.at(-1)[0];
  act(() => {
    for (let i = 0; i < 20; i++) { sample({ x: 0, y: -1 }); jest.advanceTimersByTime(200); }
    jest.advanceTimersByTime(5000);
  });
  expect(inverted.value).toBe(true);
  expect(surface.value).toEqual(Array(16).fill(0));
  expect(fill.value).toBe(0.5);
  act(() => {
    for (let i = 0; i < 20; i++) { sample({ x: 0, y: 1 }); jest.advanceTimersByTime(200); }
    jest.advanceTimersByTime(5000);
  });
  expect(inverted.value).toBe(false);
  expect(surface.value).toEqual(Array(16).fill(0));
  await act(async () => { tree.unmount(); });
  jest.useRealTimers();
});
