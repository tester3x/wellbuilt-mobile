// src/components/TankPelican.tsx
// ORIGINAL, repository-owned pelican — pure React Native View art (no
// third-party asset, no emoji, no new dependencies; Views stay sharp at
// any density). Playful silhouette matching the tank's visual language:
// long orange bill with a hanging pouch, round cream body, stubby wing,
// webbed feet. Drawn FACING LEFT; pass facingRight to flip safely.
// Decorative only: accessibility-hidden and non-interactive.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { PELICAN_HEIGHT, PELICAN_WIDTH } from '../ui/tankWildlife';

const CREAM = '#f2ead8';
const SHADE = '#d9cdb4';
const BILL = '#e8a33d';
const POUCH = '#d98a2b';
const DARK = '#1f2430';

export function TankPelican({ facingRight = false }: { facingRight?: boolean }) {
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, facingRight && styles.flipped]}
    >
      {/* body */}
      <View style={styles.body} />
      {/* wing shade */}
      <View style={styles.wing} />
      {/* head */}
      <View style={styles.head} />
      {/* long upper bill */}
      <View style={styles.bill} />
      {/* pouch hanging under the bill */}
      <View style={styles.pouch} />
      {/* eye */}
      <View style={styles.eye} />
      {/* webbed feet */}
      <View style={[styles.foot, styles.footFront]} />
      <View style={[styles.foot, styles.footBack]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: PELICAN_WIDTH,
    height: PELICAN_HEIGHT,
  },
  flipped: {
    transform: [{ scaleX: -1 }],
  },
  body: {
    position: 'absolute',
    right: 1,
    bottom: 3,
    width: 16,
    height: 12,
    borderRadius: 8,
    backgroundColor: CREAM,
  },
  wing: {
    position: 'absolute',
    right: 3,
    bottom: 5,
    width: 9,
    height: 6,
    borderRadius: 4,
    backgroundColor: SHADE,
  },
  head: {
    position: 'absolute',
    left: 9,
    top: 0,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: CREAM,
  },
  bill: {
    position: 'absolute',
    left: 0,
    top: 3,
    width: 12,
    height: 3,
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
    backgroundColor: BILL,
  },
  pouch: {
    position: 'absolute',
    left: 2,
    top: 5,
    width: 9,
    height: 6,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 3,
    backgroundColor: POUCH,
  },
  eye: {
    position: 'absolute',
    left: 13,
    top: 2,
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: DARK,
  },
  foot: {
    position: 'absolute',
    bottom: 0,
    width: 6,
    height: 3,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 3,
    backgroundColor: BILL,
  },
  footFront: { right: 6 },
  footBack: { right: 12 },
});
