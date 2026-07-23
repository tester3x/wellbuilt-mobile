// src/components/TankFisherman.tsx
// ORIGINAL, repository-owned mini fisherman — pure React Native View art
// (no third-party asset, no emoji). He SITS ON THE TANK RIM (the parent
// anchors this component at the interior's top edge — he never floats in
// the water) and visibly HOLDS the pole: the pole originates at his
// hands and angles down toward the water; the parent hangs the line from
// the pole-tip coordinate exported by tankWildlife's layout math.
// Drawn FACING RIGHT (pole to his right); pass facingLeft to mirror.
// Decorative only: accessibility-hidden and non-interactive.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { FISHERMAN_HEIGHT, FISHERMAN_WIDTH, POLE_REACH_X, POLE_TIP_DROP_Y } from '../ui/tankWildlife';

const HAT = '#3f6b45';
const SKIN = '#e8b98a';
const JACKET = '#b3552e';
const PANTS = '#31405e';
const POLE = '#8a6b42';

export function TankFisherman({ facingLeft = false }: { facingLeft?: boolean }) {
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, facingLeft && styles.flipped]}
    >
      {/* pole — held at the hands, tip reaching out/down over the water */}
      <View style={styles.pole} />
      {/* hat brim + dome */}
      <View style={styles.hatBrim} />
      <View style={styles.hatDome} />
      {/* head */}
      <View style={styles.head} />
      {/* body/jacket */}
      <View style={styles.body} />
      {/* arm toward the pole */}
      <View style={styles.arm} />
      {/* legs dangling over the rim edge */}
      <View style={[styles.leg, styles.legFront]} />
      <View style={[styles.leg, styles.legBack]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: FISHERMAN_WIDTH,
    height: FISHERMAN_HEIGHT,
  },
  flipped: {
    transform: [{ scaleX: -1 }],
  },
  pole: {
    position: 'absolute',
    left: FISHERMAN_WIDTH - 8,
    top: 10,
    width: POLE_REACH_X + 8,
    height: 2,
    borderRadius: 1,
    backgroundColor: POLE,
    // Anchored at the hands; tip dips toward the water.
    transform: [{ rotate: `${Math.atan2(POLE_TIP_DROP_Y - 10, POLE_REACH_X) * (180 / Math.PI)}deg` }],
  },
  hatBrim: {
    position: 'absolute',
    left: 1,
    top: 3,
    width: 12,
    height: 2,
    borderRadius: 1,
    backgroundColor: HAT,
  },
  hatDome: {
    position: 'absolute',
    left: 3,
    top: 0,
    width: 8,
    height: 4,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    backgroundColor: HAT,
  },
  head: {
    position: 'absolute',
    left: 4,
    top: 5,
    width: 6,
    height: 5,
    borderRadius: 3,
    backgroundColor: SKIN,
  },
  body: {
    position: 'absolute',
    left: 2,
    top: 9,
    width: 10,
    height: 9,
    borderRadius: 4,
    backgroundColor: JACKET,
  },
  arm: {
    position: 'absolute',
    left: 9,
    top: 10,
    width: 7,
    height: 2,
    borderRadius: 1,
    backgroundColor: JACKET,
  },
  leg: {
    position: 'absolute',
    top: 17,
    width: 3,
    height: 7,
    borderRadius: 1,
    backgroundColor: PANTS,
  },
  legFront: { left: 4 },
  legBack: { left: 8 },
});
