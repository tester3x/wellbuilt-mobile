/**
 * Pure spec for the canonical blocking busy overlay's timing thresholds.
 * WellBuiltBusyOverlay drives its timers to match this; tests pin the spec.
 *
 *  - elapsed < delayMs           → 'hidden'  (no flash for fast operations)
 *  - delayMs <= elapsed < longMs → 'shown'   (dim + spinner + action label)
 *  - elapsed >= longMs           → 'shownLong'(label swaps to "Still…")
 *
 * When not visible, the phase is always 'hidden' regardless of elapsed.
 */
export type BusyPhase = 'hidden' | 'shown' | 'shownLong';

export function busyDisplayState(
  visible: boolean,
  elapsedMs: number,
  delayMs: number,
  longMs: number,
): BusyPhase {
  if (!visible) return 'hidden';
  if (elapsedMs < delayMs) return 'hidden';
  if (elapsedMs < longMs) return 'shown';
  return 'shownLong';
}

/** The label to show for a phase given the base + long labels. */
export function busyLabelFor(
  phase: BusyPhase,
  label: string,
  longLabel?: string,
): string {
  return phase === 'shownLong' && longLabel ? longLabel : label;
}
