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
import { FISHERMAN_HANDS_LOCAL, FISHERMAN_HEIGHT, FISHERMAN_WIDTH } from '../ui/tankWildlife';

const HAT = '#3f6b45';
const SKIN = '#e8b98a';
const JACKET = '#b3552e';
const PANTS = '#31405e';
const POLE = '#8a6b42';

export function TankFisherman({
  facingLeft = false,
  poleLenPx = 30,
  poleAngleDeg = 8,
}: {
  facingLeft?: boolean;
  /** Hands→tip length from computeFishermanLayout — the drawn pole ends
   *  EXACTLY where the fishing line hangs, even when the tip is clamped
   *  away from the level-text column. */
  poleLenPx?: number;
  poleAngleDeg?: number;
}) {
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, facingLeft && styles.flipped]}
    >
      {/* pole — rotates FROM THE HANDS (transform origin at its butt) so
          hands, drawn tip, and the line's mathematical tip coincide */}
      <View
        style={[
          styles.pole,
          {
            width: Math.max(8, poleLenPx),
            transform: [{ rotate: `${poleAngleDeg}deg` }],
          },
        ]}
      />
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
    left: FISHERMAN_HANDS_LOCAL.x,
    top: FISHERMAN_HANDS_LOCAL.y,
    height: 2,
    borderRadius: 1,
    backgroundColor: POLE,
    // Rotate around the BUTT (hands), not the center — length/angle come
    // from layout math so the tip is exact.
    transformOrigin: 'left center',
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
