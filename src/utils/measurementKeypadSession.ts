/**
 * Pure session helpers for direct form-field keypad editing.
 * Draft lives in context; committed form values update only on Done/Next.
 */

import {
  type TextSelection,
  initialSelection,
  insertAtSelection,
  deleteBackward,
  moveSelection,
  selectionFromTapRatio,
} from './tankLevelEditing';
import {
  canCommitMeasurementDraft,
  canCommitNumericDraft,
  formatLevelOnCommit,
  formatNumericOnCommit,
} from './tankLevelFormat';

export type KeypadVariant = 'level' | 'numeric';

export type KeypadKeyAction = 'delete' | 'space';

export interface KeypadKeyDef {
  label: string;
  value?: string;
  action?: KeypadKeyAction;
  levelOnly?: boolean;
}

export interface KeypadEditingState {
  draft: string;
  selection: TextSelection;
  variant: KeypadVariant;
}

export function createKeypadSession(
  value: string,
  variant: KeypadVariant = 'level',
): KeypadEditingState {
  return {
    draft: value,
    selection: initialSelection(value),
    variant,
  };
}

export function applyKeyToSession(
  state: KeypadEditingState,
  key: KeypadKeyDef,
): KeypadEditingState {
  if (key.action === 'delete') {
    const next = deleteBackward(state.draft, state.selection);
    return { ...state, draft: next.draft, selection: next.selection };
  }
  if (key.action === 'space') {
    const next = insertAtSelection(state.draft, state.selection, ' ');
    return { ...state, draft: next.draft, selection: next.selection };
  }
  if (key.value) {
    const next = insertAtSelection(state.draft, state.selection, key.value);
    return { ...state, draft: next.draft, selection: next.selection };
  }
  return state;
}

export function moveKeypadCursor(
  state: KeypadEditingState,
  dir: 'left' | 'right',
): KeypadEditingState {
  return {
    ...state,
    selection: moveSelection(state.draft, state.selection, dir),
  };
}

export function placeKeypadCursor(
  state: KeypadEditingState,
  ratio: number,
): KeypadEditingState {
  return {
    ...state,
    selection: selectionFromTapRatio(state.draft, ratio),
  };
}

export function canCommitKeypadSession(state: KeypadEditingState): boolean {
  return state.variant === 'numeric'
    ? canCommitNumericDraft(state.draft)
    : canCommitMeasurementDraft(state.draft);
}

export function commitKeypadSession(state: KeypadEditingState): string {
  return state.variant === 'numeric'
    ? formatNumericOnCommit(state.draft)
    : formatLevelOnCommit(state.draft);
}

/** Keypad is keys-only — no title or duplicate display region. */
export const KEYPAD_HAS_INLINE_DISPLAY = false;