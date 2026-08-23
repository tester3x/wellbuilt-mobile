/**
 * Temporary Android native reader for live EditText selection state.
 * Diagnostic only — remove after Next-entry investigation.
 */

import { findNodeHandle, NativeModules, Platform, type TextInput } from 'react-native';
import type { RefObject } from 'react';
import type { NativeTextInputDiagState } from './measurementInputDiagClassify';

export type { NativeTextInputDiagState } from './measurementInputDiagClassify';
export { classifyNativeSelectionCase } from './measurementInputDiagClassify';

export interface NativeFullBufferSelectResult extends NativeTextInputDiagState {
  applied: boolean;
  reason?: string;
}

const MeasurementInputDiag = NativeModules.MeasurementInputDiag as {
  readTextInputState?: (reactTag: number) => Promise<NativeTextInputDiagState>;
  applyNativeFullBufferSelection?: (reactTag: number) => Promise<NativeFullBufferSelectResult>;
} | undefined;

export function canApplyNativeFullBufferSelection(): boolean {
  return Platform.OS === 'android'
    && typeof MeasurementInputDiag?.applyNativeFullBufferSelection === 'function';
}

export function canReadNativeTextInputSelection(): boolean {
  return Platform.OS === 'android' && typeof MeasurementInputDiag?.readTextInputState === 'function';
}

export async function readNativeTextInputSelection(
  inputRef: RefObject<TextInput | null>,
): Promise<NativeTextInputDiagState | null> {
  if (!canReadNativeTextInputSelection()) return null;
  const node = findNodeHandle(inputRef.current);
  if (node == null) return null;
  const read = MeasurementInputDiag?.readTextInputState;
  if (!read) return null;
  try {
    return await read(node);
  } catch {
    return null;
  }
}

export async function applyNativeFullBufferSelection(
  inputRef: RefObject<TextInput | null>,
): Promise<NativeFullBufferSelectResult | null> {
  if (!canApplyNativeFullBufferSelection()) return null;
  const node = findNodeHandle(inputRef.current);
  if (node == null) return null;
  const apply = MeasurementInputDiag?.applyNativeFullBufferSelection;
  if (!apply) return null;
  try {
    return await apply(node);
  } catch {
    return null;
  }
}

