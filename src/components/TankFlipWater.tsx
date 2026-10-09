import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { waterDepthAt } from '../ui/fluidWildlife';

const COLUMNS = 64;
function WaterColumn({ index, width, height, fill, offsets, inverted }: {
  index: number; width: number; height: number; fill: SharedValue<number>; offsets: SharedValue<number[]>; inverted: SharedValue<boolean>;
}) {
  const style = useAnimatedStyle(() => {
    const depth = waterDepthAt((index + 0.5) / COLUMNS * width, width, height, fill.value, offsets.value);
    // Always write a numeric position: undefined may leave a stale native anchor.
    return { height: depth, top: inverted.value ? 0 : height - depth };
  });
  return <Animated.View style={[styles.column, { width: width / COLUMNS + 0.3, left: index * width / COLUMNS }, style]} />;
}
export function TankFlipWater(props: { width: number; height: number; fill: SharedValue<number>; offsets: SharedValue<number[]>; inverted: SharedValue<boolean> }) {
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    {Array.from({ length: COLUMNS }, (_, index) => <WaterColumn key={index} index={index} {...props} />)}
  </View>;
}
const styles = StyleSheet.create({ column: { position: 'absolute', backgroundColor: '#2563EB', borderTopLeftRadius: 2, borderTopRightRadius: 2 } });
