import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

const COLUMNS = 64;
function WaterColumn({ index, width, height, fill, offsets }: {
  index: number; width: number; height: number; fill: SharedValue<number>; offsets: SharedValue<number[]>;
}) {
  const style = useAnimatedStyle(() => {
    const samples = offsets.value;
    const x = (index + 0.5) / COLUMNS * samples.length - 0.5;
    const a = Math.max(0, Math.min(samples.length - 1, Math.floor(x)));
    const b = Math.min(samples.length - 1, a + 1);
    const t = Math.max(0, Math.min(1, x - a));
    const offset = (samples[a] || 0) * (1 - t) + (samples[b] || 0) * t;
    return { height: Math.max(0, Math.min(height, fill.value * height + offset)) };
  });
  return <Animated.View style={[styles.column, { width: width / COLUMNS + 0.3, left: index * width / COLUMNS }, style]} />;
}
export function TankFlipWater(props: { width: number; height: number; fill: SharedValue<number>; offsets: SharedValue<number[]> }) {
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    {Array.from({ length: COLUMNS }, (_, index) => <WaterColumn key={index} index={index} {...props} />)}
  </View>;
}
const styles = StyleSheet.create({ column: { position: 'absolute', bottom: 0, backgroundColor: '#2563EB', borderTopLeftRadius: 2, borderTopRightRadius: 2 } });
