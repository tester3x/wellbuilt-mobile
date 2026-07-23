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

/** Left offset: mirror of the right rule for left-side placement. */
export function badgeLeftOffset(insetLeft: number): number {
  const inset = Number.isFinite(insetLeft) && insetLeft > 0 ? insetLeft : 0;
  return Math.max(inset + BADGE_RIGHT_MIN, BADGE_RIGHT_MIN);
}

export type BadgePlacement = 'left' | 'right' | 'hidden';

/**
 * Route-aware placement (field-test fix): the badge must never sit on top
 * of another control.
 *  - Tank overview ('/', the (tabs) home): the settings gear owns the top-
 *    right corner → badge goes LEFT.
 *  - Sync Status: the screen IS the status display → badge hidden.
 *  - Record Load and every other audited route (settings/history/manager/
 *    well-data/…): back/menu controls sit top-LEFT → badge stays RIGHT.
 */
export function badgePlacementForRoute(pathname: string | null | undefined): BadgePlacement {
  const p = String(pathname || '').toLowerCase();
  if (p.includes('sync-status')) return 'hidden';
  if (p === '/' || p === '' || p === '/index' || p.includes('(tabs)')) return 'left';
  return 'right';
}
