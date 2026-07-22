// src/ui/safeAreaBadge.ts
// Pure inset math for the floating SyncAttentionBadge — RN-free so the
// placement rules are unit-testable. The badge must clear the status bar /
// notch / Dynamic Island on every device (Fold cover+main, S24, tablets,
// iPhones) in portrait and landscape, without a layout jump: the offsets
// are derived directly from the safe-area insets the app's existing
// provider supplies synchronously via initial window metrics.

/** Gap between the safe area edge and the badge. */
export const BADGE_TOP_MARGIN = 8;
/** Minimum distance from the right screen edge (landscape notches can
 *  push it further via the right inset). */
export const BADGE_RIGHT_MIN = 12;

/** Top offset: just below whatever the device reserves (status bar, notch,
 *  Dynamic Island). Zero/invalid insets (some tablets/landscape) still get
 *  the base margin so the badge never touches the screen edge. */
export function badgeTopOffset(insetTop: number): number {
  const inset = Number.isFinite(insetTop) && insetTop > 0 ? insetTop : 0;
  return inset + BADGE_TOP_MARGIN;
}

/** Right offset: at least the base margin, growing with the right inset
 *  (landscape notch/curved edges). */
export function badgeRightOffset(insetRight: number): number {
  const inset = Number.isFinite(insetRight) && insetRight > 0 ? insetRight : 0;
  return Math.max(inset + BADGE_RIGHT_MIN, BADGE_RIGHT_MIN);
}
