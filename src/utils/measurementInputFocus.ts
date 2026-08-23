/**
 * Input ownership helpers for ordinary Samsung-keyboard fields vs measurement keypad fields.
 * Pure coordination logic — testable without React Native runtime.
 */

import type { TextSelection } from './tankLevelEditing';

export type InputOwner = 'ordinary' | 'measurement' | 'none';
export type KeypadEntryMode = 'tap' | 'navigate';

export interface InputOwnershipState {
  ordinaryFieldKey: string | null;
  measurementFieldKey: string | null;
  keypadOpen: boolean;
  keyboardDismissCount: number;
}

export interface MeasurementFocusTransition {
  fromFieldKey: string;
  toFieldKey: string;
  entryMode: KeypadEntryMode;
  dismissedKeyboard: boolean;
  blurredOrdinary: boolean;
  openedKeypad: boolean;
  requestedMeasurementFocus: boolean;
}

export function createInputOwnershipTracker() {
  let ordinaryFieldKey: string | null = null;
  let measurementFieldKey: string | null = null;
  let keypadOpen = false;
  let keyboardDismissCount = 0;

  return {
    setOrdinaryFocused(fieldKey: string | null) {
      ordinaryFieldKey = fieldKey;
    },
    setMeasurementFocused(fieldKey: string | null) {
      measurementFieldKey = fieldKey;
    },
    setKeypadOpen(open: boolean) {
      keypadOpen = open;
    },
    dismissKeyboard() {
      keyboardDismissCount += 1;
    },
    getState(): InputOwnershipState {
      return {
        ordinaryFieldKey,
        measurementFieldKey,
        keypadOpen,
        keyboardDismissCount,
      };
    },
    assertExclusiveOwnership() {
      if (ordinaryFieldKey && measurementFieldKey) {
        throw new Error(
          `dual input ownership: ordinary=${ordinaryFieldKey} measurement=${measurementFieldKey}`,
        );
      }
      if (keypadOpen && ordinaryFieldKey) {
        throw new Error(`keypad open while ordinary field focused: ${ordinaryFieldKey}`);
      }
    },
    assertNoDualKeyboard() {
      if (keypadOpen && ordinaryFieldKey) {
        throw new Error('native keyboard and measurement keypad cannot both own input');
      }
    },
  };
}

export function selectionForKeypadEntry(
  draft: string,
  entryMode: KeypadEntryMode,
  nativeSelection?: TextSelection,
): TextSelection {
  if (nativeSelection) return nativeSelection;
  if (draft.length === 0) return { start: 0, end: 0 };
  if (entryMode === 'navigate') return { start: 0, end: draft.length };
  /** Tap entry: native TextInput owns caret placement until onSelectionChange. */
  return { start: 0, end: 0 };
}

export function transitionOrdinaryToMeasurement(
  tracker: ReturnType<typeof createInputOwnershipTracker>,
  fromFieldKey: string,
  toFieldKey: string,
  entryMode: KeypadEntryMode,
): MeasurementFocusTransition {
  tracker.dismissKeyboard();
  tracker.setOrdinaryFocused(null);
  tracker.setMeasurementFocused(toFieldKey);
  tracker.setKeypadOpen(true);
  tracker.assertExclusiveOwnership();
  tracker.assertNoDualKeyboard();

  return {
    fromFieldKey,
    toFieldKey,
    entryMode,
    dismissedKeyboard: true,
    blurredOrdinary: true,
    openedKeypad: true,
    requestedMeasurementFocus: true,
  };
}

export function transitionMeasurementToMeasurement(
  tracker: ReturnType<typeof createInputOwnershipTracker>,
  fromFieldKey: string,
  toFieldKey: string,
): MeasurementFocusTransition {
  tracker.dismissKeyboard();
  tracker.setMeasurementFocused(toFieldKey);
  tracker.setKeypadOpen(true);
  tracker.assertExclusiveOwnership();

  return {
    fromFieldKey,
    toFieldKey,
    entryMode: 'navigate',
    dismissedKeyboard: true,
    blurredOrdinary: false,
    openedKeypad: true,
    requestedMeasurementFocus: true,
  };
}

export function transitionMeasurementToOrdinary(
  tracker: ReturnType<typeof createInputOwnershipTracker>,
  fromFieldKey: string,
  toFieldKey: string,
): void {
  tracker.setMeasurementFocused(null);
  tracker.setKeypadOpen(false);
  tracker.setOrdinaryFocused(toFieldKey);
  tracker.assertExclusiveOwnership();
}

export function closeMeasurementKeypad(
  tracker: ReturnType<typeof createInputOwnershipTracker>,
): void {
  tracker.dismissKeyboard();
  tracker.setMeasurementFocused(null);
  tracker.setKeypadOpen(false);
  tracker.assertExclusiveOwnership();
}

export interface FocusChainField {
  id: string;
}

export function resolveNextFieldId(
  chain: FocusChainField[],
  currentFieldId: string,
): string | null {
  const idx = chain.findIndex((field) => field.id === currentFieldId);
  if (idx < 0 || idx >= chain.length - 1) return null;
  return chain[idx + 1].id;
}

export interface KeypadHandoffState {
  fieldKey: string;
  draft: string;
  selection: TextSelection;
  closeCalled: boolean;
}

/** Same-keypad handoff: swap active field without closing keypad. */
export function handoffMeasurementField(
  state: KeypadHandoffState,
  toFieldKey: string,
  toDraft: string,
  entryMode: KeypadEntryMode = 'navigate',
): KeypadHandoffState {
  if (state.closeCalled) {
    throw new Error('handoff must not run after closeKeypad');
  }
  return {
    fieldKey: toFieldKey,
    draft: toDraft,
    selection: selectionForKeypadEntry(toDraft, entryMode),
    closeCalled: false,
  };
}

export function commitNextWithOptionalHandoff(
  state: KeypadHandoffState,
  handoffToFieldKey: string | null,
  handoffDraft: string,
): { state: KeypadHandoffState; closed: boolean } {
  if (handoffToFieldKey) {
    return {
      state: handoffMeasurementField(state, handoffToFieldKey, handoffDraft),
      closed: false,
    };
  }
  return {
    state: { ...state, closeCalled: true },
    closed: true,
  };
}

export function shouldPreserveNativeKeyboard(
  fromUsesMeasurementKeypad: boolean,
  toUsesMeasurementKeypad: boolean,
): boolean {
  return !fromUsesMeasurementKeypad && !toUsesMeasurementKeypad;
}

export interface NativeToNativeTransition {
  fromFieldKey: string;
  toFieldKey: string;
  dismissedKeyboard: boolean;
  blurredSource: boolean;
}

export function transitionNativeToNative(
  tracker: ReturnType<typeof createInputOwnershipTracker>,
  fromFieldKey: string,
  toFieldKey: string,
): NativeToNativeTransition {
  tracker.setOrdinaryFocused(toFieldKey);
  tracker.assertExclusiveOwnership();

  return {
    fromFieldKey,
    toFieldKey,
    dismissedKeyboard: false,
    blurredSource: false,
  };
}