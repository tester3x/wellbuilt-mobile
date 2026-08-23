/**
 * Canonical measurement field activation — full-buffer select-all once per transition.
 */

import type { TextSelection } from './tankLevelEditing';

export interface PendingEntrySelectAll {
  activationId: number;
  fieldKey: string;
  draft: string;
  selection: TextSelection;
  queued: boolean;
}

/** Full-buffer selection using exact native string length (includes final "). */
export function fullBufferSelection(draft: string): TextSelection {
  return { start: 0, end: draft.length };
}

export function selectionForFieldActivation(
  draft: string,
  selectExistingValue: boolean,
): TextSelection {
  if (selectExistingValue && draft.length > 0) {
    return fullBufferSelection(draft);
  }
  return { start: 0, end: 0 };
}

export function shouldQueueEntrySelectAll(
  pending: PendingEntrySelectAll | null,
  fieldKey: string,
  draft: string,
): pending is PendingEntrySelectAll {
  if (!pending || pending.queued) return false;
  if (pending.fieldKey !== fieldKey) return false;
  return pending.draft === draft;
}

export function isFullBufferSelection(draft: string, selection: TextSelection): boolean {
  return selection.start === 0 && selection.end === draft.length && draft.length > 0;
}