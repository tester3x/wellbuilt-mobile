import React from 'react';
import { StyleSheet, View } from 'react-native';
import { FLIP_COLS } from '../ui/flipFluid';

/**
 * Visual water body: N columns whose heights (from the tank floor) come
 * from the FLIP free surface. Average column height tracks restFill so
 * the operational waterline stays honest while local slosh is visible.
 */
export function TankFlipWater({
  heights,
  restFill,
  width,
  color = '#2563EB',
}: {
  heights: number[];
  restFill: number;
  width: number;
  color?: string;
}) {
  const cols = heights.length > 0 ? heights : new Array(FLIP_COLS).fill(restFill);
  const colW = width / cols.length;
  return (
    <View pointerEvents="none" style={styles.row}>
      {cols.map((h, i) => (
        <View
          key={i}
          style={{
            width: colW,
            height: Math.max(0, h),
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
});
