import type { View } from 'react-native';

/**
 * Keys-only keypad: 4 rows × 40px + gaps + padding (no title/display).
 */
export const MEASUREMENT_KEYPAD_HEIGHT = 195;

/** ShellFooter button row height excluding safe-area padding. */
export const SHELL_FOOTER_CONTENT_HEIGHT = 58;

/** A bottom inset is usable only if it is a finite, positive number. */
function sanitizeInset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * One authoritative effective bottom clearance from every candidate inset. The
 * live safe-area bottom is 0 while WB-M hides the Android nav bar (immersive
 * overlay-swipe), but the pre-hide `initialWindowSafeAreaInsets.bottom` still
 * carries the real protected region — so we take the LARGER of the candidates
 * (never their sum). Missing / non-finite / negative values clamp to 0, so a
 * genuine zero-inset device (iOS with no home indicator, tablets) stays at 0.
 */
export function getEffectiveBottomClearance(
  ...candidates: Array<number | null | undefined>
): number {
  return candidates.reduce<number>((max, v) => Math.max(max, sanitizeInset(v)), 0);
}

/**
 * Single authoritative geometry for the measurement keypad slot. The slot is
 * the one geometry owner: it reserves the base keypad height PLUS the bottom
 * safe-area inset — added here exactly once — so the bottom key row clears the
 * Android/iOS navigation / gesture bar. The keypad component keeps its own
 * internal bottom padding; the inset is NOT added again there. A zero inset
 * (tablets, some landscape) returns the base geometry unchanged.
 */
export function getMeasurementSlotGeometry(safeAreaBottom: number): {
  keypadHeight: number;
  safeAreaPadding: number;
  reservedHeight: number;
  entryTranslateY: number;
} {
  const inset = Number.isFinite(safeAreaBottom) && safeAreaBottom > 0 ? safeAreaBottom : 0;
  return {
    keypadHeight: MEASUREMENT_KEYPAD_HEIGHT,
    safeAreaPadding: inset,
    reservedHeight: MEASUREMENT_KEYPAD_HEIGHT + inset,
    entryTranslateY: MEASUREMENT_KEYPAD_HEIGHT + inset,
  };
}

/** Combined bottom zone: keypad + footer + safe area. */
export function getMeasurementBottomInset(safeAreaBottom: number): number {
  return MEASUREMENT_KEYPAD_HEIGHT + SHELL_FOOTER_CONTENT_HEIGHT + safeAreaBottom + 8;
}

/** Room above keypad for active field + label context. */
export const KEYPAD_FIELD_VIEWPORT_OFFSET = 120;

type ScrollIntoViewHost = {
  scrollIntoView?: (
    element: View,
    options?: {
      getScrollPosition?: (
        parentLayout: { x: number; y: number; width: number; height: number },
        childLayout: { x: number; y: number; width: number; height: number },
        contentOffset: { x: number; y: number },
      ) => { x: number; y: number; animated?: boolean };
    },
  ) => Promise<void>;
};

export function scrollFieldForKeypad(
  scrollRef: ScrollIntoViewHost | null | undefined,
  anchor: View | null,
  offsetFromTop = KEYPAD_FIELD_VIEWPORT_OFFSET,
): void {
  if (!scrollRef?.scrollIntoView || !anchor) return;

  scrollRef.scrollIntoView(anchor, {
    getScrollPosition: (parentLayout, childLayout, contentOffset) => ({
      x: 0,
      y: Math.max(
        0,
        childLayout.y - parentLayout.y + contentOffset.y - offsetFromTop,
      ),
      animated: true,
    }),
  }).catch(() => {});
}

export function getKeypadScrollExtra(safeAreaBottom = 0): number {
  return getMeasurementBottomInset(safeAreaBottom);
}