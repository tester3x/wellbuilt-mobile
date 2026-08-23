/**
 * Native selectTextOnFocus path for populated measurement field entry.
 * Android paints selection when EditText selects on focus — not via RN selection prop.
 */

import type { TextSelection } from './tankLevelEditing';
import { isFullBufferSelection } from './measurementFieldActivation';
import type { KeypadEntryMode } from './measurementInputFocus';

export interface PendingNativeSelectOnFocus {
  activationId: number;
  fieldKey: string;
  draft: string;
}

export function shouldUseNativeSelectOnFocus(
  entryMode: KeypadEntryMode,
  selectExistingValue: boolean,
  draftLength: number,
): boolean {
  return selectExistingValue && draftLength > 0;
}

/** Navigate/Next entry: RN selectTextOnFocus misses on programmatic handoff — use native setSelection. */
export function shouldApplyNativeNavigateFullBufferSelect(
  entryMode: KeypadEntryMode,
  selectExistingValue: boolean,
  draftLength: number,
): boolean {
  return entryMode === 'navigate' && selectExistingValue && draftLength > 0;
}

export function isNativeSelectOnFocusActive(
  pending: PendingNativeSelectOnFocus | null,
  fieldKey: string,
): boolean {
  if (!pending) return false;
  return pending.fieldKey === fieldKey;
}

export function shouldConfirmNativeSelectOnFocus(
  pending: PendingNativeSelectOnFocus | null,
  fieldKey: string,
  draft: string,
  reported: TextSelection,
): boolean {
  if (!pending || pending.fieldKey !== fieldKey || pending.draft !== draft) return false;
  return isFullBufferSelection(draft, reported);
}