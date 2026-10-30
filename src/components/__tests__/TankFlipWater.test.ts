import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TankFlipWater } from '../TankFlipWater';
const mockStyles: Array<() => any> = [];
jest.mock('react-native', () => ({ View: 'view', PixelRatio: { get: () => 3 }, StyleSheet: { absoluteFill: {}, create: (s: any) => s } }));
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { View: 'water' }, useAnimatedStyle: (f: () => any) => { mockStyles.push(f); return f(); } }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it('moves fixed-height clipped columns without per-frame Yoga dimensions or stale anchors', async () => {
  const fill = { value: 0.3 } as any, offsets = { value: Array(16).fill(0) } as any, inverted = { value: false } as any;
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(React.createElement(TankFlipWater, { width: 120, height: 200, fill, offsets, inverted })); });
  const styles = mockStyles.slice(-64);
  expect(styles).toHaveLength(64);
  const initialWorklets=mockStyles.length;
  await act(async () => { tree.update(React.createElement(TankFlipWater, { width:120,height:200,fill,offsets,inverted })); });
  expect(mockStyles).toHaveLength(initialWorklets); // Parent label renders do not recreate 64 column worklets.
  for (const flipped of [false, true, false, true, false]) {
    inverted.value = flipped;
    for (const getStyle of styles) {
      const style = getStyle();
      const translation=style.transform[0].translateY;
      expect(translation).toBe(flipped ? -140 : 140);
      const visibleTop=Math.max(0,translation),visibleBottom=Math.min(200,translation+200);
      expect(visibleBottom-visibleTop).toBe(60);
      expect(visibleTop).toBe(flipped?0:140);
      expect(style).not.toHaveProperty('height');
      expect(style).not.toHaveProperty('top');
      expect(style).not.toHaveProperty('bottom');
    }
  }
  expect(fill.value).toBe(0.3);
  await act(async () => { tree.unmount(); });
});
