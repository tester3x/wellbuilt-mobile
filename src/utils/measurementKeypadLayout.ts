import type { View } from 'react-native';

/**
 * Keys-only keypad: 4 rows × 40px + gaps + padding (no title/display).
 */
export const MEASUREMENT_KEYPAD_HEIGHT = 195;

/** ShellFooter button row height excluding safe-area padding. */
export const SHELL_FOOTER_CONTENT_HEIGHT = 58;

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