import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TankFlipWater } from '../TankFlipWater';
const mockStyles: Array<() => any> = [];
jest.mock('react-native', () => ({ View: 'view', StyleSheet: { absoluteFill: {}, create: (s: any) => s } }));
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { View: 'water' }, useAnimatedStyle: (f: () => any) => { mockStyles.push(f); return f(); } }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('writes explicit column coordinates on inverted-to-upright return, with no stale bottom anchor', async () => {
  const fill = { value: 0.3 } as any, offsets = { value: Array(16).fill(0) } as any, inverted = { value: false } as any;
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(React.createElement(TankFlipWater, { width: 120, height: 200, fill, offsets, inverted })); });
  const styles = mockStyles.slice(-64);
  expect(styles).toHaveLength(64);
  for (const flipped of [false, true, false, true, false]) {
    inverted.value = flipped;
    for (const getStyle of styles) {
      const style = getStyle();
      expect(style.height).toBe(60);
      expect(style.top).toBe(flipped ? 0 : 140);
      expect(style).not.toHaveProperty('bottom');
    }
  }
  expect(fill.value).toBe(0.3);
  await act(async () => { tree.unmount(); });
});
