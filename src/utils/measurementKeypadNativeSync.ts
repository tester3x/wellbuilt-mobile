/**
 * Keypad → native TextInput synchronization helpers.
 * Selection must be applied after the controlled value reaches the native layer.
 */

import type { TextSelection } from './tankLevelEditing';

export type KeypadSelectionSyncMode = 'collapsed' | 'entry-range';

export interface PendingKeypadNativeSync {
  draft: string;
  selection: TextSelection;
  seq: number;
  mode: KeypadSelectionSyncMode;
}

export interface HeldEntrySelection {
  fieldKey: string;
  draft: string;
  selection: TextSelection;
}

export interface KeypadSelectionSyncState {
  pending: PendingKeypadNativeSync | null;
  held: HeldEntrySelection | null;
}

export interface KeypadSelectionSyncResult {
  pending: PendingKeypadNativeSync | null;
  held: HeldEntrySelection | null;
  releaseCommandSelection: boolean;
  acceptSelection: TextSelection | null;
  ignored: boolean;
}

export function selectionMatches(a: TextSelection, b: TextSelection): boolean {
  return a.start === b.start && a.end === b.end;
}

export function normalizeReportedSelection(
  reported: TextSelection,
  draftLength: number,
): TextSelection {
  return {
    start: Math.max(0, Math.min(draftLength, reported.start)),
    end: Math.max(0, Math.min(draftLength, reported.end)),
  };
}

/** Ignore stale native selection reports while a keypad command sync is pending. */
export function shouldIgnoreNativeSelectionDuringSync(
  pending: PendingKeypadNativeSync | null,
  reported: TextSelection,
): boolean {
  if (!pending) return false;
  return !selectionMatches(reported, pending.selection);
}

export function shouldReleaseCollapsedCommandOnNativeConfirm(
  pending: PendingKeypadNativeSync | null,
  reported: TextSelection,
): boolean {
  if (!pending || pending.mode !== 'collapsed') return false;
  return selectionMatches(reported, pending.selection);
}

export function shouldRetainEntryRangeOnNativeConfirm(
  pending: PendingKeypadNativeSync | null,
  reported: TextSelection,
): boolean {
  if (!pending || pending.mode !== 'entry-range') return false;
  return selectionMatches(reported, pending.selection);
}

export function isUserTakeoverOfHeldEntryRange(
  held: HeldEntrySelection | null,
  fieldKey: string,
  reported: TextSelection,
): held is HeldEntrySelection {
  if (!held || held.fieldKey !== fieldKey) return false;
  return !selectionMatches(reported, held.selection);
}

export function resolveNativeSelectionReport(
  state: KeypadSelectionSyncState,
  reported: TextSelection,
  draft: string,
  fieldKey: string,
): KeypadSelectionSyncResult {
  const normalized = normalizeReportedSelection(reported, draft.length);
  const unchanged: KeypadSelectionSyncResult = {
    pending: state.pending,
    held: state.held,
    releaseCommandSelection: false,
    acceptSelection: null,
    ignored: false,
  };

  if (shouldIgnoreNativeSelectionDuringSync(state.pending, normalized)) {
    return { ...unchanged, ignored: true };
  }

  if (isUserTakeoverOfHeldEntryRange(state.held, fieldKey, normalized)) {
    return {
      pending: null,
      held: null,
      releaseCommandSelection: true,
      acceptSelection: normalized,
      ignored: false,
    };
  }

  if (shouldRetainEntryRangeOnNativeConfirm(state.pending, normalized)) {
    return {
      pending: null,
      held: state.held,
      releaseCommandSelection: false,
      acceptSelection: normalized,
      ignored: false,
    };
  }

  if (shouldReleaseCollapsedCommandOnNativeConfirm(state.pending, normalized)) {
    return {
      pending: null,
      held: null,
      releaseCommandSelection: true,
      acceptSelection: normalized,
      ignored: false,
    };
  }

  return {
    ...unchanged,
    acceptSelection: normalized,
  };
}

export function createPendingKeypadNativeSync(
  draft: string,
  selection: TextSelection,
  seq: number,
  mode: KeypadSelectionSyncMode = 'collapsed',
): PendingKeypadNativeSync {
  return { draft, selection, seq, mode };
}

export function createHeldEntrySelection(
  fieldKey: string,
  draft: string,
  selection: TextSelection,
): HeldEntrySelection {
  return { fieldKey, draft, selection };
}

export function commandSelectionAppliesToField(
  fieldKey: string,
  displayValue: string,
  activeFieldKey: string | null,
  commandSelection: TextSelection | null,
  commandSelectionDraft: string | null,
): boolean {
  if (!commandSelection || activeFieldKey !== fieldKey) return false;
  return commandSelectionDraft === displayValue;
}