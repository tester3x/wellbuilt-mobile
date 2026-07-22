// Placement proofs for the floating SyncAttentionBadge (pure inset math).
import * as fs from 'fs';
import * as path from 'path';
import { BADGE_RIGHT_MIN, BADGE_TOP_MARGIN, badgeRightOffset, badgeTopOffset } from '../safeAreaBadge';

describe('badgeTopOffset', () => {
  test('nonzero inset: sits just below the reserved area (status bar/notch/Dynamic Island)', () => {
    expect(badgeTopOffset(24)).toBe(24 + BADGE_TOP_MARGIN);   // typical Android status bar
    expect(badgeTopOffset(59)).toBe(59 + BADGE_TOP_MARGIN);   // iPhone Dynamic Island
    expect(badgeTopOffset(32)).toBe(32 + BADGE_TOP_MARGIN);   // Fold main display
  });

  test('zero inset (some tablets/landscape) still keeps a margin off the edge', () => {
    expect(badgeTopOffset(0)).toBe(BADGE_TOP_MARGIN);
  });

  test('invalid insets never produce NaN or negative placement', () => {
    expect(badgeTopOffset(Number.NaN)).toBe(BADGE_TOP_MARGIN);
    expect(badgeTopOffset(-10)).toBe(BADGE_TOP_MARGIN);
    expect(badgeTopOffset(Infinity)).toBe(BADGE_TOP_MARGIN);
  });
});

describe('badgeRightOffset', () => {
  test('grows with the right inset (landscape notch) and never drops below the minimum', () => {
    expect(badgeRightOffset(0)).toBe(BADGE_RIGHT_MIN);
    expect(badgeRightOffset(44)).toBe(44 + BADGE_RIGHT_MIN);
    expect(badgeRightOffset(Number.NaN)).toBe(BADGE_RIGHT_MIN);
  });
});

describe('component wiring', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../components/SyncAttentionBadge.tsx'),
    'utf8',
  );

  test('badge derives placement from safe-area insets, not fixed offsets', () => {
    expect(src).toContain('useSafeAreaInsets');
    expect(src).toContain('badgeTopOffset(insets.top)');
    expect(src).toContain('badgeRightOffset(insets.right)');
    expect(src).not.toMatch(/top:\s*52/);
  });

  test('no extra SafeAreaProvider is introduced (the app already has one)', () => {
    expect(src).not.toContain('SafeAreaProvider');
  });
});
