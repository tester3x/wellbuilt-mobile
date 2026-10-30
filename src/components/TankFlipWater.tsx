import React from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { waterDepthAt } from '../ui/fluidWildlife';
import { waterColumnBounds } from '../ui/waterColumns';

const COLUMNS = 64;
function WaterColumn({ index, width, height, fill, offsets, inverted, renderScale = 1 }: {
  index: number; width: number; height: number; fill: SharedValue<number>; offsets: SharedValue<number[]>; inverted: SharedValue<boolean>; renderScale?: number;
}) {
  const style = useAnimatedStyle(() => {
    const depth = waterDepthAt((index + 0.5) / COLUMNS * width, width, height, fill.value, offsets.value);
    // A fixed-height strip moves inside the clipped tank. Animating 64 layout
    // heights/tops forced Fabric/Yoga commits every frame, including on swipes.
    return { transform: [{ translateY: inverted.value ? depth - height : height - depth }] };
  });
  return <Animated.View style={[styles.column, {height,top:0}, waterColumnBounds(index,COLUMNS,width,renderScale,PixelRatio.get()), style]} />;
}
export const TankFlipWater = React.memo(function TankFlipWater(props: { width: number; height: number; fill: SharedValue<number>; offsets: SharedValue<number[]>; inverted: SharedValue<boolean>; renderScale?: number }) {
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill,{overflow:'hidden'}]}>
    {Array.from({ length: COLUMNS }, (_, index) => <WaterColumn key={index} index={index} {...props} />)}
  </View>;
});
const styles = StyleSheet.create({ column: { position: 'absolute', backgroundColor: '#2563EB', borderTopLeftRadius: 2, borderTopRightRadius: 2 } });
