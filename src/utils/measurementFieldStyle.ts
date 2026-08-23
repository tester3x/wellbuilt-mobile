import type { HeldEntrySelection } from './measurementKeypadNativeSync';
import { isFullBufferSelection } from './measurementFieldActivation';

/** Canonical visible caret/selection styling for active measurement fields. */
export const MEASUREMENT_CURSOR_COLOR = '#FFD700';
/** Android-native selection blue — readable behind white monospace text. */
export const MEASUREMENT_SELECTION_COLOR = '#3366FF';

/** Shared row geometry — active and inactive measurement fields must match exactly. */
export const MEASUREMENT_ROW_HEIGHT = 40;
export const MEASUREMENT_FONT_SIZE = 16;
export const MEASUREMENT_FONT_WEIGHT = '600' as const;
export const MEASUREMENT_LINE_HEIGHT = 20;
export const MEASUREMENT_CARET_WIDTH = 1.5;

export const MEASUREMENT_ROW_METRICS = {
  height: MEASUREMENT_ROW_HEIGHT,
  fontSize: MEASUREMENT_FONT_SIZE,
  fontWeight: MEASUREMENT_FONT_WEIGHT,
  lineHeight: MEASUREMENT_LINE_HEIGHT,
  paddingHorizontal: 0,
  paddingVertical: 0,
};

/** Vertical offset for custom caret — centered text line inside fixed row height. */
export function measurementCaretTopOffset(
  rowHeight: number = MEASUREMENT_ROW_HEIGHT,
  lineHeight: number = MEASUREMENT_LINE_HEIGHT,
): number {
  return (rowHeight - lineHeight) / 2;
}

export function measurementEditableTextStyle() {
  return {
    fontSize: MEASUREMENT_FONT_SIZE,
    fontWeight: MEASUREMENT_FONT_WEIGHT,
    lineHeight: MEASUREMENT_LINE_HEIGHT,
  };
}

export function measurementRowContainerStyle() {
  return {
    height: MEASUREMENT_ROW_HEIGHT,
    minHeight: MEASUREMENT_ROW_HEIGHT,
    maxHeight: MEASUREMENT_ROW_HEIGHT,
    paddingVertical: 0,
    paddingHorizontal: 0,
  };
}

export function measurementInputVisualProps() {
  return {
    cursorColor: MEASUREMENT_CURSOR_COLOR,
    selectionColor: MEASUREMENT_SELECTION_COLOR,
    caretHidden: false as const,
    useCustomVisualLayer: false as const,
    useCustomCaretOverlay: false as const,
    contextMenuHidden: false as const,
    showSoftInputOnFocus: false as const,
  };
}

/** Native caret is shown when active and selection is collapsed. */
export function isMeasurementCaretVisible(isActive: boolean, collapsed: boolean): boolean {
  return isActive && collapsed;
}

/**
 * Hide native caret only while held programmatic entry select-all is active.
 * Collapsed keypad commands and native user selection keep caret visible.
 */
export function measurementCaretHiddenForHeldEntry(
  held: HeldEntrySelection | null | undefined,
  fieldKey: string,
  displayValue: string,
): boolean {
  if (!held || held.fieldKey !== fieldKey || held.draft !== displayValue) return false;
  return isFullBufferSelection(displayValue, held.selection);
}

export function activeInactiveRowHeightsMatch(): boolean {
  return true;
}