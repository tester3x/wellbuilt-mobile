import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CENTER_EXCLUSION } from '../ui/tankWildlife';
import {
  createFlipWorld,
  FLIP_COLS,
  setRestFill,
  stepFlip,
  surfaceHeights,
  type FlipWorld,
} from '../ui/flipFluid';
import {
  createFishWander,
  fishFacing,
  stepFishWander,
  type FishWander,
  type WanderBounds,
} from '../ui/fishWander';
import { useTankImu } from '../hooks/useTankImu';
import { TankFlipWater } from './TankFlipWater';

function rng(): number {
  return Math.random();
}

export function TankFlipAquarium({
  width,
  height,
  fill,
  active,
  reducedMotion,
  showFish,
  fishCount,
}: {
  width: number;
  height: number;
  fill: number;
  active: boolean;
  reducedMotion: boolean;
  showFish: boolean;
  fishCount: number;
}) {
  const rest = Math.max(0.04, Math.min(1, fill));
  const worldRef = useRef<FlipWorld | null>(null);
  if (worldRef.current === null) {
    worldRef.current = createFlipWorld(width, height, rest);
  }
  const fishRef = useRef<FishWander[] | null>(null);
  const [surface, setSurface] = useState<number[]>(() => Array(FLIP_COLS).fill(rest * height));
  const [fishDraw, setFishDraw] = useState<{ x: number; y: number; face: 1 | -1 }[]>([]);
  const gravity = useTankImu(active && !reducedMotion);
  const gRef = useRef(gravity);
  gRef.current = gravity;
  const restRef = useRef(rest);
  restRef.current = rest;

  useEffect(() => {
    if (worldRef.current) setRestFill(worldRef.current, rest);
  }, [rest]);

  useEffect(() => {
    const waterH = rest * height;
    const bounds: WanderBounds = {
      minX: 8,
      maxX: width - 16,
      minY: 10,
      maxY: Math.max(16, waterH - 8),
    };
    const excl = { left: width * CENTER_EXCLUSION.left, right: width * CENTER_EXCLUSION.right };
    fishRef.current = [0, 1, 2].map(() => createFishWander(bounds, excl, rng));
  }, [width, height]); // spawn once; bounds update in the loop

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      const dt = Math.min(0.05, (now - last) / 1000) || 1 / 30;
      last = now;
      const world = worldRef.current!;
      const fillNow = restRef.current;
      setRestFill(world, fillNow);
      stepFlip(world, gRef.current, dt, { reducedMotion });
      const heights = surfaceHeights(world, FLIP_COLS);
      setSurface(heights);
      if (showFish && fishRef.current) {
        const waterH = fillNow * height;
        const bounds: WanderBounds = {
          minX: 8,
          maxX: width - 16,
          minY: 10,
          maxY: Math.max(16, waterH - 8),
        };
        const excl = { left: width * CENTER_EXCLUSION.left, right: width * CENTER_EXCLUSION.right };
        const next = fishRef.current.map((f) =>
          reducedMotion ? { ...f, vx: 0, vy: 0 } : stepFishWander(f, dt, bounds, excl, rng),
        );
        fishRef.current = next;
        setFishDraw(
          next.map((f) => ({
            x: f.x,
            // Water clip layer is top-origin; sim y is from the floor.
            y: Math.max(0, waterH - f.y - 6), // top of water clip = surface; sim y from floor
            face: fishFacing(f),
          })),
        );
      } else {
        setFishDraw([]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reducedMotion, width, height, showFish]);

  const waterH = rest * height;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <TankFlipWater heights={surface} restFill={waterH} width={width} />
      <View style={[styles.clip, { height: Math.max(1, waterH) }]}>
        {showFish &&
          fishDraw.slice(0, fishCount).map((f, i) => (
            <View key={i} style={[styles.fish, { left: f.x, top: f.y }]}>
              <Text
                accessible={false}
                importantForAccessibility="no"
                style={[styles.glyph, { transform: [{ scaleX: f.face }] }]}
              >
                🐟
              </Text>
            </View>
          ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  fish: { position: 'absolute' },
  glyph: { fontSize: 11 },
});
