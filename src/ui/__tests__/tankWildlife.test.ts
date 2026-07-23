// Tank wildlife proofs — lanes, clamps, schedules (all pure/deterministic;
// randomness and time are injected, so nothing here is flaky).
import * as fs from 'fs';
import * as path from 'path';
import {
  CENTER_EXCLUSION,
  DUCK_GLYPH_WIDTH,
  DUCK_LIFT_PX,
  EDGE_MARGIN_PX,
  FISH_HOOK_DEPTH_PX,
  FISH_MIN_SUBMERGE_PX,
  FISHERMAN_WIDTH,
  PELICAN_FOOT_OVERLAP_PX,
  PELICAN_HEIGHT,
  PELICAN_MAX_INTERVAL_MS,
  PELICAN_MIN_INTERVAL_MS,
  PELICAN_MIN_SCALE,
  PELICAN_TOP_SAFE_MARGIN_PX,
  PELICAN_WIDTH,
  RIPPLE_MAX_AMPLITUDE_PX,
  RIPPLE_MAX_SLOPE,
  computeDuckBand,
  computeFishermanLayout,
  duckTopOffset,
  duckTravelBounds,
  fishHookedCenterY,
  fishingLineHeight,
  nextPelicanDelayMs,
  pelicanLayout,
  pelicanPerchX,
  pelicanTopPx,
  poleTipSway,
  rippleGeometry,
} from '../tankWildlife';

/** Interior widths for phone / Fold cover / Fold main / tablet layouts. */
const WIDTHS = [180, 240, 300, 420, 560];

describe('duck — surface lane', () => {
  test('travels both directions inside its band, never touching edges or the level-text column', () => {
    for (const w of WIDTHS) {
      for (const onLeft of [true, false]) {
        for (const jitter of [0, 0.25, 0.5, 0.75, 1]) {
          const spawn = computeDuckBand(w, onLeft, jitter);
          const { minPx, maxPx } = duckTravelBounds(spawn);
          expect(minPx).toBeGreaterThanOrEqual(EDGE_MARGIN_PX - 0.001);
          expect(maxPx + DUCK_GLYPH_WIDTH).toBeLessThanOrEqual(w - EDGE_MARGIN_PX + 0.001);
          if (onLeft) {
            expect(maxPx + DUCK_GLYPH_WIDTH).toBeLessThanOrEqual(w * CENTER_EXCLUSION.left + 0.001);
          } else {
            expect(minPx).toBeGreaterThanOrEqual(w * CENTER_EXCLUSION.right - 0.001);
          }
        }
      }
    }
  });

  test('start position varies with jitter (tanks are not mechanically synchronized)', () => {
    const a = computeDuckBand(300, true, 0);
    const b = computeDuckBand(300, true, 1);
    expect(a.basePx).not.toBe(b.basePx);
  });

  test('degenerate/narrow interiors degrade to a stationary but afloat duck', () => {
    const spawn = computeDuckBand(40, true, 0.5);
    expect(spawn.rangePx).toBe(0);
    expect(computeDuckBand(0, true).rangePx).toBe(0);
    expect(computeDuckBand(Number.NaN as unknown as number, false).rangePx).toBe(0);
  });

  test('floats mostly above the waterline at mid level; clamped inside the tank when nearly full', () => {
    expect(duckTopOffset(120)).toBe(-DUCK_LIFT_PX); // normal mid-level ride height
    expect(duckTopOffset(5)).toBe(-5);              // nearly full: never pokes above the interior
    expect(duckTopOffset(0)).toBe(0);
    expect(duckTopOffset(Number.NaN)).toBe(0);      // malformed input stays visible
  });
});

describe('fisherman scene — rim lane, pole, line, hooked fish', () => {
  test('fisherman is seated inside the rim at each width/side; the line hangs outside the level-text column', () => {
    for (const w of WIDTHS) {
      for (const onLeft of [true, false]) {
        for (const jitter of [0, 0.5, 1]) {
          const lay = computeFishermanLayout(w, onLeft, jitter);
          expect(lay.fishermanLeftPx).toBeGreaterThanOrEqual(EDGE_MARGIN_PX - 0.001);
          expect(lay.fishermanLeftPx + FISHERMAN_WIDTH).toBeLessThanOrEqual(w - EDGE_MARGIN_PX + 0.001);
          expect(lay.poleTipXPx).toBeGreaterThanOrEqual(EDGE_MARGIN_PX - 0.001);
          expect(lay.poleTipXPx).toBeLessThanOrEqual(w - EDGE_MARGIN_PX + 0.001);
          if (onLeft) expect(lay.poleTipXPx).toBeLessThanOrEqual(w * CENTER_EXCLUSION.left);
          else expect(lay.poleTipXPx).toBeGreaterThanOrEqual(w * CENTER_EXCLUSION.right);
        }
      }
    }
  });

  test('the line connects the pole tip to the fish and adapts to the water level', () => {
    const lay = computeFishermanLayout(300, true, 0.5);
    const low = fishingLineHeight(200, lay.poleTipYPx, 0);   // low water → long line
    const high = fishingLineHeight(40, lay.poleTipYPx, 0);   // high water → short line
    expect(low).toBeGreaterThan(high);
    expect(fishingLineHeight(200, lay.poleTipYPx, 0)).toBe(200 + FISH_HOOK_DEPTH_PX - lay.poleTipYPx);
    expect(fishingLineHeight(0, 50, 0)).toBeGreaterThanOrEqual(0); // never negative
  });

  test('the hooked fish NEVER rises above the waterline, even at max tug', () => {
    for (const waterTop of [0, 10, 60, 200]) {
      for (const tug of [-5, 0, 2, 3, 99]) {
        const fishY = fishHookedCenterY(waterTop, tug);
        expect(fishY).toBeGreaterThanOrEqual(waterTop + FISH_MIN_SUBMERGE_PX);
      }
    }
  });
});

describe('pelican — schedule + perch', () => {
  test('appearance delay is randomized but strictly bounded, deterministic under a seeded rand', () => {
    expect(nextPelicanDelayMs(0)).toBe(PELICAN_MIN_INTERVAL_MS);
    expect(nextPelicanDelayMs(1)).toBe(PELICAN_MAX_INTERVAL_MS);
    expect(nextPelicanDelayMs(0.5)).toBe((PELICAN_MIN_INTERVAL_MS + PELICAN_MAX_INTERVAL_MS) / 2);
    expect(nextPelicanDelayMs(0.5)).toBe(nextPelicanDelayMs(0.5)); // deterministic
    expect(nextPelicanDelayMs(Number.NaN)).toBeGreaterThanOrEqual(PELICAN_MIN_INTERVAL_MS);
    expect(nextPelicanDelayMs(99)).toBeLessThanOrEqual(PELICAN_MAX_INTERVAL_MS);
  });

  test('perches fully above the number top edge — digits are never covered', () => {
    for (const numberTop of [30, 80, 150]) {
      const top = pelicanTopPx(numberTop);
      // art box bottom = top + height; feet may overlap the top EDGE by
      // the seated allowance but the body stays above the digits.
      expect(top + PELICAN_HEIGHT).toBeLessThanOrEqual(numberTop + 2);
    }
  });

  test('perch x stays inside the interior on every width/side and varies with jitter', () => {
    for (const w of WIDTHS) {
      for (const side of ['left', 'right'] as const) {
        for (const j of [0, 0.5, 1]) {
          const x = pelicanPerchX(w, side, j);
          expect(x).toBeGreaterThanOrEqual(EDGE_MARGIN_PX);
          expect(x + PELICAN_WIDTH).toBeLessThanOrEqual(w - EDGE_MARGIN_PX);
        }
      }
      expect(pelicanPerchX(w, 'left', 0)).not.toBe(pelicanPerchX(w, 'right', 0));
    }
  });
});

describe('lane coordination — wildlife never intersects', () => {
  test('duck band and fisherman line share sides but the kinds are mutually exclusive; pelican lane is disjoint from both', () => {
    const w = 300;
    // Pelican occupies the center column above the number; duck bands and
    // the fisherman's line are excluded from the center column entirely.
    for (const side of ['left', 'right'] as const) {
      const px = pelicanPerchX(w, side, 1);
      expect(px + PELICAN_WIDTH / 2).toBeGreaterThan(w * CENTER_EXCLUSION.left * 0.9);
      expect(px + PELICAN_WIDTH / 2).toBeLessThan(w * CENTER_EXCLUSION.right * 1.1);
    }
    const duckL = duckTravelBounds(computeDuckBand(w, true, 1));
    expect(duckL.maxPx + DUCK_GLYPH_WIDTH).toBeLessThanOrEqual(w * CENTER_EXCLUSION.left + 0.001);
    const line = computeFishermanLayout(w, false, 1);
    expect(line.poleTipXPx).toBeGreaterThanOrEqual(w * CENTER_EXCLUSION.right);
  });
});

describe('wiring — index.tsx integration facts', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../app/(tabs)/index.tsx'), 'utf8');

  test('duck renders ABOVE the water fill (later sibling than the blue layer) inside the surface layer', () => {
    const waterIdx = src.indexOf('styles.tankWater');
    const duckIdx = src.indexOf("showFloat && aliveEgg.kind === 'duck'"); // the RENDER site, not the swim effect
    const numberIdx = src.indexOf('styles.numberContainer');
    expect(waterIdx).toBeGreaterThan(-1);
    expect(duckIdx).toBeGreaterThan(waterIdx);
    expect(duckIdx).toBeLessThan(numberIdx);
  });

  test('duck uses the clamped surface offset, band math, velocity flip, and bob', () => {
    expect(src).toContain('duckTopOffset(waterTop)');
    expect(src).toContain('computeDuckBand(INTERIOR_WIDTH');
    expect(src).toMatch(/duckFaceStyle[\s\S]{0,200}Math\.cos/);
    expect(src).toContain('duckMoveStyle');
    expect(src).not.toMatch(/aliveFloat[\s\S]{0,60}🦆/); // old drowning float gone
  });

  test('fisherman scene is rim-anchored with pole-tip line and hooked fish helpers', () => {
    expect(src).toContain('computeFishermanLayout(INTERIOR_WIDTH');
    expect(src).toContain('fishingLineHeight(waterTop, tipY, tug)'); // tip rides the sway
    expect(src).toContain('fishHookedCenterY(waterTop, tug)');
    expect(src).toContain('styles.fishermanSeat');
    expect(src).not.toMatch(/aliveFloat[\s\S]{0,60}🎣/); // old floating pole gone
  });

  test('pelican: single ref-held timer chain, cleanup on inactive/unmount, bounded schedule, perch math', () => {
    expect(src).toContain('nextPelicanDelayMs(Math.random())');
    expect(src).toContain('pelicanTimerRef');
    expect(src).toMatch(/clearTimeout\(pelicanTimerRef\.current\)/);
    expect(src).toContain('pelicanPerchX(INTERIOR_WIDTH');
    expect(src).toContain('PELICAN_TOP_SAFE_MARGIN_PX'); // safe-clamped placement (inline worklet math)
    // one state slot → one pelican, ever
    expect(src.split('setPelicanVisit(').length - 1).toBeGreaterThanOrEqual(3); // set + two clears
    expect(src).toContain('<TankPelican');
  });

  test('reduced motion: swim loop gated; duck/fisherman/pelican fall back to stationary-but-correct', () => {
    expect(src).toContain('useReducedMotion');
    expect(src).toMatch(/!reducedMotion && \(aliveEgg\.kind === 'fish' \|\| aliveEgg\.kind === 'duck'\)/);
    expect(src).toMatch(/reducedMotion \? 0 :/); // motionless transforms
    expect(src).toMatch(/reducedMotion\) \{ pelicanIn\.value = 1/); // stationary perch, no flight
  });

  test('single swim loop with cancel-before-restart; wildlife is decorative and accessibility-hidden', () => {
    const effect = src.slice(src.indexOf('const needsSwim'), src.indexOf('const needsSwim') + 500);
    expect(effect).toContain('cancelAnimation(swim)');
    expect(effect).toContain('return () => cancelAnimation(swim)');
    expect(src).toMatch(/aliveDuckWrap[\s\S]{0,400}accessible=\{false\}/);
    expect(src).toContain('pointerEvents="none"');
  });

  test('pelican asset is original/local (repo component, no emoji, no remote asset)', () => {
    const pelican = fs.readFileSync(path.join(__dirname, '../../components/TankPelican.tsx'), 'utf8');
    expect(pelican).not.toMatch(/https?:\/\//);
    expect(pelican).not.toMatch(/[🦩🦜🦆🐦]/u);
    expect(pelican).toContain('importantForAccessibility="no-hide-descendants"');
    expect(pelican).toContain('pouch'); // the pelican-defining feature
    expect(pelican).toContain('scaleX: -1'); // safe facing flip
    const fisherman = fs.readFileSync(path.join(__dirname, '../../components/TankFisherman.tsx'), 'utf8');
    expect(fisherman).toContain('pole');
    expect(fisherman).toContain('importantForAccessibility="no-hide-descendants"');
  });

  test('dev override stays disabled in commits', () => {
    expect(src).toMatch(/FORCE_EGG: 'fish' \| 'fisherman' \| 'duck' \| null = null;/);
  });
});

describe('shallow ripple geometry (follow-up fix)', () => {
  test('relief never exceeds the amplitude cap at ANY interior width', () => {
    for (const w of WIDTHS.concat([80, 900])) {
      const g = rippleGeometry(w);
      expect(g.crestPx).toBeLessThanOrEqual(RIPPLE_MAX_AMPLITUDE_PX);
      expect(g.crestBPx).toBeLessThanOrEqual(g.crestPx); // two UNEQUAL gentle crests
      expect(g.crestBPx).toBeGreaterThan(0);
    }
  });

  test('no deep V-point geometry: crests are wide, shallow, and heavily overlapped', () => {
    for (const w of WIDTHS) {
      const g = rippleGeometry(w);
      // Shallow slope (the old humps were 5/16 = 0.31 - visibly pointy).
      expect(g.crestPx / g.crestWidthPx).toBeLessThanOrEqual(RIPPLE_MAX_SLOPE + 0.001);
      // Stride < drawn width => every shoulder hides behind its neighbor,
      // so the profile can never dip to the base in a sharp cusp.
      expect(g.wavelengthPx).toBeLessThan(g.crestWidthPx);
      expect((g.crestWidthPx - g.wavelengthPx) / g.crestWidthPx).toBeGreaterThanOrEqual(0.3);
    }
  });

  test('wavelength scales responsively and stays bounded; rows cover the interior plus drift overhang', () => {
    const small = rippleGeometry(110);
    const big = rippleGeometry(560);
    expect(small.wavelengthPx).toBeGreaterThanOrEqual(22);
    expect(big.wavelengthPx).toBeLessThanOrEqual(44);
    expect(big.wavelengthPx).toBeGreaterThan(small.wavelengthPx);
    for (const w of WIDTHS) {
      const g = rippleGeometry(w);
      expect(g.humpCount * g.wavelengthPx).toBeGreaterThanOrEqual(w + 2 * g.wavelengthPx);
    }
  });

  test('degenerate widths still produce sane geometry', () => {
    for (const bad of [0, -5, Number.NaN]) {
      const g = rippleGeometry(bad as number);
      expect(g.crestPx).toBeGreaterThan(0);
      expect(g.humpCount).toBeGreaterThan(2);
    }
  });
});

describe('pelican safe clamp (follow-up fix)', () => {
  test('normal phone mid-level: full size, feet on the number top edge', () => {
    const lay = pelicanLayout(101.8)!; // 390-pt phone, mid level
    expect(lay.scale).toBe(1);
    expect(lay.topPx + PELICAN_HEIGHT * lay.scale).toBeCloseTo(101.8 + PELICAN_FOOT_OVERLAP_PX, 5);
    expect(lay.topPx).toBeGreaterThanOrEqual(PELICAN_TOP_SAFE_MARGIN_PX);
  });

  test('nearly-full on Fold-cover geometry: scales down but stays inside the interior and above the digits', () => {
    // Fold cover ~344x748: interior height ~202, number clamp min 30.3,
    // NUMBER_OFFSET ~11.2 -> numberTop ~19.1 - tighter than the pelican.
    const lay = pelicanLayout(19.1)!;
    expect(lay.scale).toBeLessThan(1);
    expect(lay.scale).toBeGreaterThanOrEqual(PELICAN_MIN_SCALE);
    expect(lay.topPx).toBeGreaterThanOrEqual(PELICAN_TOP_SAFE_MARGIN_PX); // never behind the frame
    // Never covers the digits: bottom stays at/above numberTop + seated overlap.
    expect(lay.topPx + PELICAN_HEIGHT * lay.scale).toBeLessThanOrEqual(19.1 + PELICAN_FOOT_OVERLAP_PX + 0.001);
  });

  test('insufficient space: the visit is skipped entirely, never squeezed or escaping', () => {
    expect(pelicanLayout(8)).toBeNull();   // < min-scale room
    expect(pelicanLayout(0)).toBeNull();
    expect(pelicanLayout(-10)).toBeNull();
  });

  test('empty-tank geometry (number clamped low) is unconstrained full size', () => {
    const lay = pelicanLayout(159)!;
    expect(lay.scale).toBe(1);
  });
});

describe('pole-line attachment (follow-up fix)', () => {
  test('drawn pole length equals hands-to-tip distance - the art can never overshoot a clamped tip', () => {
    for (const w of WIDTHS) {
      for (const onLeft of [true, false]) {
        const lay = computeFishermanLayout(w, onLeft, 0.5);
        const dist = Math.hypot(lay.poleTipXPx - lay.handsXPx, lay.poleTipYPx - lay.handsYPx);
        expect(lay.poleLenPx).toBeCloseTo(dist, 6);
        expect(lay.poleAngleDeg).toBeGreaterThan(0); // always dips toward the water
      }
    }
  });

  test('line anchor follows the exact rigid-body tip displacement at both sway extremes', () => {
    const lay = computeFishermanLayout(300, true, 0.5);
    for (const angle of [-1, 1]) { // the sway extremes used in production
      const sway = poleTipSway(lay.swayRxPx, lay.swayRyPx, angle);
      // Sub-pixel movement - and by construction the LINE uses this same
      // displacement, so tip and line coincide exactly: zero air gap.
      expect(Math.abs(sway.dx)).toBeLessThan(1);
      expect(Math.abs(sway.dy)).toBeLessThan(1);
    }
    const rest = poleTipSway(lay.swayRxPx, lay.swayRyPx, 0);
    expect(Math.abs(rest.dx)).toBe(0); // exactly at rest with no sway
    expect(Math.abs(rest.dy)).toBe(0);
  });

  test('right-side spawn mirrors correctly (negative sway radius)', () => {
    const lay = computeFishermanLayout(300, false, 0.5);
    expect(lay.swayRxPx).toBeLessThan(0);
    const sway = poleTipSway(lay.swayRxPx, lay.swayRyPx, 1);
    expect(Number.isFinite(sway.dx)).toBe(true);
  });
});

describe('follow-up wiring: waterline stability, lifecycle, reduced motion', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../app/(tabs)/index.tsx'), 'utf8');

  test('ripple drifts LATERALLY only - the nominal waterline never moves', () => {
    const rowA = src.slice(src.indexOf('rippleRowAStyle'), src.indexOf('rippleRowAStyle') + 400);
    expect(rowA).toContain('translateX');
    expect(rowA).not.toContain('translateY'); // no vertical sloshing
    // Wildlife anchors to the NOMINAL line (waterFraction math), never the crests.
    expect(src).toContain('duckTopOffset(waterTop)');
    expect(src.split('INTERIOR_HEIGHT * (1 - waterFraction.value)').length - 1).toBeGreaterThanOrEqual(4);
    expect(src).not.toMatch(/duck[\s\S]{0,120}RIPPLE\.crest/); // duck ignores decorative relief
  });

  test('all loops and the pelican schedule are gated on sceneActive (isActive AND app foreground)', () => {
    expect(src).toContain("AppState.addEventListener('change', (s) => setAppForeground(s === 'active'))");
    expect(src).toContain('const sceneActive = isActive && appForeground;');
    expect(src).toMatch(/!sceneActive \|\| reducedMotion\) \{ cancelAnimation\(wavePhase\)/);
    expect(src).toMatch(/!sceneActive \|\| reducedMotion\) \{ cancelAnimation\(drift\)/);
    expect(src).toMatch(/sceneActive && !reducedMotion && \(aliveEgg\.kind === 'fish'/);
    expect(src).toMatch(/if \(!sceneActive\) \{ setPelicanVisit\(null\); return; \}/);
  });

  test('reduced motion: ripple drift is zeroed and its loop never starts', () => {
    expect(src).toMatch(/translateX: reducedMotion \? 0 : drift\.value/);
    expect(src).toMatch(/translateX: reducedMotion \? 0 : -drift\.value/);
  });

  test('line and hooked fish ride the swayed pole tip', () => {
    expect(src.split('poleTipSway(fisher.swayRxPx, fisher.swayRyPx, angle)').length - 1).toBe(2);
    expect(src).toContain('left: fisher.poleTipXPx + sway.dx');
    expect(src).toContain('poleLenPx={fisher.poleLenPx}');
    expect(src).toContain('poleAngleDeg={fisher.poleAngleDeg}');
  });

  test('worklet-called helpers carry the worklet directive (UI-thread safety)', () => {
    const lib = fs.readFileSync(path.join(__dirname, '../tankWildlife.ts'), 'utf8');
    for (const fn of ['duckTopOffset', 'fishingLineHeight', 'fishHookedCenterY', 'poleTipSway', 'pelicanTopPx']) {
      const idx = lib.indexOf(`export function ${fn}`);
      expect(lib.slice(idx, idx + 220)).toContain("'worklet'");
    }
  });

  test('pelican scales bottom-anchored so its feet stay on the number', () => {
    expect(src).toContain("transformOrigin: 'center bottom'");
    expect(src).toContain('PELICAN_FOOT_OVERLAP_PX * scale - PELICAN_HEIGHT');
  });
});
