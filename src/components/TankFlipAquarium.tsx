import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { CENTER_EXCLUSION } from '../ui/tankWildlife';
import {
  createDuckFloat,
  duckBandForWidth,
  duckGlyphTopFromCeiling,
  stepDuckFloat,
  type DuckFloat,
} from '../ui/duckFloat';
import {
  createFlipWorld,
  FLIP_COLS,
  kineticEnergy,
  sampleSurfaceAtX,
  sampleVelocity,
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

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function TankFlipAquarium({
  width,
  height,
  fill,
  active,
  reducedMotion,
  showFish,
  fishCount,
  showDuck = false,
  duckOnLeft = true,
}: {
  width: number;
  height: number;
  fill: number;
  active: boolean;
  reducedMotion: boolean;
  showFish: boolean;
  fishCount: number;
  showDuck?: boolean;
  duckOnLeft?: boolean;
}) {
  const rest = clamp01(fill);
  const worldRef = useRef<FlipWorld | null>(null);
  if (worldRef.current === null) {
    worldRef.current = createFlipWorld(width, height, rest);
  }
  const fishRef = useRef<FishWander[] | null>(null);
  const duckRef = useRef<DuckFloat | null>(null);
  const [surface, setSurface] = useState<number[]>(() => Array(FLIP_COLS).fill(rest * height));
  const [fishDraw, setFishDraw] = useState<{ x: number; y: number; face: 1 | -1 }[]>([]);
  const [duckDraw, setDuckDraw] = useState<{ x: number; top: number; face: 1 | -1; tilt: number } | null>(null);
  const gravity = useTankImu(active && !reducedMotion);
  const gRef = useRef(gravity);
  gRef.current = gravity;
  const restRef = useRef(rest);
  restRef.current = rest;
  const fgRef = useRef(AppState.currentState === 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      fgRef.current = s === 'active';
    });
    return () => sub.remove();
  }, []);

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
    const band = duckBandForWidth(width, duckOnLeft);
    duckRef.current = createDuckFloat(band, waterH, rng);
  }, [width, height, duckOnLeft]);

  const paintStill = () => {
    const world = worldRef.current!;
    setRestFill(world, restRef.current);
    stepFlip(world, { gx: 0, gy: 1 }, 1 / 30, { reducedMotion: true });
    const heights = surfaceHeights(world, FLIP_COLS);
    setSurface(heights);
    setFishDraw([]);
    if (showDuck && duckRef.current && restRef.current > 0.04) {
      const band = duckBandForWidth(width, duckOnLeft);
      const local = sampleSurfaceAtX(heights, duckRef.current.x, width);
      const d = stepDuckFloat(duckRef.current, 1 / 30, local, band, { reducedMotion: true });
      duckRef.current = d;
      setDuckDraw({
        x: d.x,
        top: duckGlyphTopFromCeiling(height, d.hullY),
        face: d.facing,
        tilt: 0,
      });
    } else {
      setDuckDraw(null);
    }
  };

  useEffect(() => {
    if (!active || reducedMotion) {
      paintStill();
      return;
    }
    let raf = 0;
    let last = Date.now();
    let idleSkip = 0;
    const tick = () => {
      if (!fgRef.current) {
        last = Date.now();
        raf = requestAnimationFrame(tick);
        return;
      }
      const now = Date.now();
      const rawDt = (now - last) / 1000;
      last = now;
      const dt = Math.min(0.05, rawDt || 1 / 30); // no huge accumulated timestep
      const world = worldRef.current!;
      const fillNow = restRef.current;
      setRestFill(world, fillNow);
      if (fillNow <= 0) {
        stepFlip(world, { gx: 0, gy: 1 }, dt, { reducedMotion: true });
        setSurface(Array(FLIP_COLS).fill(0));
        setFishDraw([]);
        setDuckDraw(null);
        raf = requestAnimationFrame(tick);
        return;
      }
      stepFlip(world, gRef.current, dt);
      const heights = surfaceHeights(world, FLIP_COLS);
      const ke = kineticEnergy(world);
      const settled = ke < 40;
      idleSkip = settled ? idleSkip + 1 : 0;
      const publish = !settled || idleSkip % 8 === 0;
      if (publish) setSurface(heights);
      if (showFish && fishRef.current && fillNow > 0.08) {
        const waterH = fillNow * height;
        const bounds: WanderBounds = {
          minX: 8,
          maxX: width - 16,
          minY: 10,
          maxY: Math.max(16, waterH - 8),
        };
        const excl = { left: width * CENTER_EXCLUSION.left, right: width * CENTER_EXCLUSION.right };
        const next = fishRef.current.map((f) => {
          const local = sampleSurfaceAtX(heights, f.x, width);
          const cur = sampleVelocity(world, f.x, f.y);
          return stepFishWander(f, dt, bounds, excl, rng, {
            currentVx: cur.vx * 0.02,
            currentVy: cur.vy * 0.02,
            surfaceY: local,
          });
        });
        fishRef.current = next;
        if (publish) {
          setFishDraw(
            next.map((f) => {
              const local = sampleSurfaceAtX(heights, f.x, width);
              return {
                x: f.x,
                y: Math.max(0, local - f.y - 6),
                face: fishFacing(f),
              };
            }),
          );
        }
      } else if (publish) {
        setFishDraw([]);
      }
      if (showDuck && duckRef.current && fillNow > 0.04) {
        const band = duckBandForWidth(width, duckOnLeft);
        const local = sampleSurfaceAtX(heights, duckRef.current.x, width);
        const cur = sampleVelocity(world, duckRef.current.x, duckRef.current.hullY);
        const d = stepDuckFloat(duckRef.current, dt, local, band, { currentVx: cur.vx * 0.01 });
        duckRef.current = d;
        if (publish) {
          setDuckDraw({
            x: d.x,
            top: duckGlyphTopFromCeiling(height, d.hullY),
            face: d.facing,
            tilt: d.tilt,
          });
        }
      } else if (publish) {
        setDuckDraw(null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, reducedMotion, width, height, showFish, showDuck, duckOnLeft]);

  const waterH = rest * height;
  const enoughWaterForFish = rest > 0.08;
  const enoughWaterForDuck = rest > 0.04;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {rest > 0 && <TankFlipWater heights={surface} restFill={waterH} width={width} />}
      {enoughWaterForFish && (
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
      )}
      {showDuck && enoughWaterForDuck && duckDraw && (
        <View
          pointerEvents="none"
          style={[
            styles.duck,
            {
              left: duckDraw.x,
              top: duckDraw.top,
              transform: [{ scaleX: duckDraw.face }, { rotate: `${duckDraw.tilt}rad` }],
            },
          ]}
        >
          <Text accessible={false} importantForAccessibility="no" style={styles.duckGlyph}>
            🦆
          </Text>
        </View>
      )}
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
  duck: { position: 'absolute' },
  duckGlyph: { fontSize: 18 },
});
