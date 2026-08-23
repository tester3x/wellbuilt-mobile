/**
 * Pure helpers for classifying native vs session selection (diag only).
 */

export interface NativeTextInputDiagState {
  textLength: number;
  selectionStart: number;
  selectionEnd: number;
  isFocused: boolean;
  hasFocus: boolean;
  viewClass: string;
}

export function classifyNativeSelectionCase(
  native: NativeTextInputDiagState | null,
  draftLength: number,
): 'A' | 'B' | 'unknown' {
  if (!native || draftLength <= 0) return 'unknown';
  const { selectionStart, selectionEnd } = native;
  const fullBuffer = selectionStart === 0 && selectionEnd === draftLength;
  const collapsed = selectionStart === selectionEnd;
  if (fullBuffer) return 'A';
  if (collapsed || selectionEnd !== draftLength) return 'B';
  return 'unknown';
}