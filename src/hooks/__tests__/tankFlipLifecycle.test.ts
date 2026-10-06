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
function Tank({ active = true, reduced = false }) {
  useTankFlip(120, 200, fill, active, reduced);
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
