/**
 * Text editing state for the tank-level measurement keypad.
 * Independent of parser/storage — only governs draft UX.
 */

export type TextSelection = { start: number; end: number };

export function clampSelection(selection: TextSelection, length: number): TextSelection {
  const start = Math.max(0, Math.min(length, selection.start));
  const end = Math.max(0, Math.min(length, selection.end));
  if (start <= end) return { start, end };
  return { start: end, end: start };
}

export function isCollapsed(selection: TextSelection): boolean {
  return selection.start === selection.end;
}

export function initialSelection(draft: string): TextSelection {
  return draft.length > 0 ? { start: 0, end: draft.length } : { start: 0, end: 0 };
}

export function insertAtSelection(
  draft: string,
  selection: TextSelection,
  text: string,
): { draft: string; selection: TextSelection } {
  const sel = clampSelection(selection, draft.length);
  if (!isCollapsed(sel)) {
    const nextDraft = draft.slice(0, sel.start) + text + draft.slice(sel.end);
    const pos = sel.start + text.length;
    return { draft: nextDraft, selection: { start: pos, end: pos } };
  }
  const pos = sel.start;
  const nextDraft = draft.slice(0, pos) + text + draft.slice(pos);
  const nextPos = pos + text.length;
  return { draft: nextDraft, selection: { start: nextPos, end: nextPos } };
}

export function deleteBackward(
  draft: string,
  selection: TextSelection,
): { draft: string; selection: TextSelection } {
  const sel = clampSelection(selection, draft.length);
  if (!isCollapsed(sel)) {
    const nextDraft = draft.slice(0, sel.start) + draft.slice(sel.end);
    return { draft: nextDraft, selection: { start: sel.start, end: sel.start } };
  }
  if (sel.start === 0) return { draft, selection: sel };
  const nextDraft = draft.slice(0, sel.start - 1) + draft.slice(sel.start);
  const nextPos = sel.start - 1;
  return { draft: nextDraft, selection: { start: nextPos, end: nextPos } };
}

/**
 * Pure caret/selection movement — never changes draft, never changes focus/field.
 * Partial selection: collapse to start (left) or end (right) without deleting text.
 * Collapsed caret: step one character; clamp at boundaries (no wrap).
 */
export function moveSelection(
  draft: string,
  selection: TextSelection,
  dir: 'left' | 'right',
): TextSelection {
  const sel = clampSelection(selection, draft.length);
  if (!isCollapsed(sel)) {
    return dir === 'left'
      ? { start: sel.start, end: sel.start }
      : { start: sel.end, end: sel.end };
  }
  const pos = sel.start;
  if (dir === 'left') {
    if (pos <= 0) return sel;
    return { start: pos - 1, end: pos - 1 };
  }
  if (pos >= draft.length) return sel;
  return { start: pos + 1, end: pos + 1 };
}

export function clearAll(): { draft: string; selection: TextSelection } {
  return { draft: '', selection: { start: 0, end: 0 } };
}

/** Map a horizontal tap ratio (0–1) to the nearest collapsed caret boundary. */
export function selectionFromTapRatio(draft: string, ratio: number): TextSelection {
  if (draft.length === 0) return { start: 0, end: 0 };
  const clamped = Math.max(0, Math.min(1, ratio));
  const pos = Math.round(clamped * draft.length);
  const caret = Math.max(0, Math.min(draft.length, pos));
  return { start: caret, end: caret };
}

/** @deprecated Use TextSelection */
export type EditMode = TextSelection;

/** @deprecated Use initialSelection */
export const initialEditMode = initialSelection;

/** @deprecated Use moveSelection */
export const moveCursor = moveSelection;

/** @deprecated Use selectionFromTapRatio */
export const cursorFromTapRatio = selectionFromTapRatio;