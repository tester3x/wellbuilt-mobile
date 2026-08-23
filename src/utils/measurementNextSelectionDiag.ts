/**
 * Temporary trace for Next-entry native selection investigation.
 * Logs only — does not alter focus, selection, or session behavior.
 */

import type { RefObject } from 'react';
import type { TextInput } from 'react-native';
import type { TextSelection } from './tankLevelEditing';
import {
  canReadNativeTextInputSelection,
  classifyNativeSelectionCase,
  readNativeTextInputSelection,
  type NativeTextInputDiagState,
} from './measurementInputDiagNative';

/** Flip to false to silence logs without removing instrumentation. */
export const MEASUREMENT_NEXT_NATIVE_DIAG_ENABLED = true;

const LOG_PREFIX = '[MeasNextDiag]';

export interface NextDiagContext {
  selectTextOnFocusProp?: boolean;
  nativeSelectPending?: boolean;
  entryMode?: string;
  jsSessionSelection?: TextSelection | null;
  draftLength?: number;
  onFocusFired?: boolean;
  onSelectionChangeFired?: boolean;
  onLayoutFired?: boolean;
  onSelectionChangeRange?: TextSelection | null;
  focusCallIndex?: number;
  focusCallSource?: string;
  deferForNativeSelect?: boolean;
  /** Whether the destination ref existed in the measurement input registry. */
  registryHit?: boolean;
}

interface ActiveTrace {
  id: number;
  sourceFieldKey: string | null;
  destinationFieldKey: string | null;
  startedAt: number;
  focusCallCount: number;
  onFocusFired: boolean;
  onSelectionChangeFired: boolean;
  onLayoutFired: boolean;
  lastOnSelectionChange: TextSelection | null;
  preTapNativeCase: 'A' | 'B' | 'unknown' | null;
  checkpoints: string[];
}

let traceSeq = 0;
let activeTrace: ActiveTrace | null = null;

function traceActiveForField(fieldKey: string): boolean {
  if (!MEASUREMENT_NEXT_NATIVE_DIAG_ENABLED || !activeTrace) return false;
  return activeTrace.destinationFieldKey === fieldKey
    || (activeTrace.destinationFieldKey == null && activeTrace.sourceFieldKey !== fieldKey);
}

export function isNextSelectionDiagTracingField(fieldKey: string): boolean {
  return traceActiveForField(fieldKey);
}

export function beginNextTransition(sourceFieldKey: string | null): number {
  if (!MEASUREMENT_NEXT_NATIVE_DIAG_ENABLED) return 0;
  traceSeq += 1;
  activeTrace = {
    id: traceSeq,
    sourceFieldKey,
    destinationFieldKey: null,
    startedAt: Date.now(),
    focusCallCount: 0,
    onFocusFired: false,
    onSelectionChangeFired: false,
    onLayoutFired: false,
    lastOnSelectionChange: null,
    preTapNativeCase: null,
    checkpoints: [],
  };
  console.warn(LOG_PREFIX, JSON.stringify({
    event: 'next-begin',
    transitionId: traceSeq,
    sourceFieldKey,
    canReadNative: canReadNativeTextInputSelection(),
  }));
  return traceSeq;
}

export function setNextDestinationField(fieldKey: string): void {
  if (!activeTrace) return;
  activeTrace.destinationFieldKey = fieldKey;
}

export function recordFocusCall(
  fieldKey: string,
  source: string,
  deferForNativeSelect: boolean,
  registryHit: boolean,
): void {
  if (!activeTrace) return;
  activeTrace.focusCallCount += 1;
  logCheckpoint('focus-requested', fieldKey, {
    focusCallIndex: activeTrace.focusCallCount,
    focusCallSource: source,
    deferForNativeSelect,
    registryHit,
  });
}

export function recordOnFocus(fieldKey: string): void {
  if (!traceActiveForField(fieldKey) || !activeTrace) return;
  activeTrace.onFocusFired = true;
  logCheckpoint('onFocus', fieldKey, { onFocusFired: true });
}

export function recordOnSelectionChange(fieldKey: string, range: TextSelection): void {
  if (!traceActiveForField(fieldKey) || !activeTrace) return;
  activeTrace.onSelectionChangeFired = true;
  activeTrace.lastOnSelectionChange = range;
  logCheckpoint('onSelectionChange', fieldKey, {
    onSelectionChangeFired: true,
    onSelectionChangeRange: range,
  });
}

export function recordOnLayout(fieldKey: string): void {
  if (!traceActiveForField(fieldKey) || !activeTrace) return;
  activeTrace.onLayoutFired = true;
  logCheckpoint('onLayout-wrapper', fieldKey, { onLayoutFired: true });
}

export function recordActiveFieldTap(fieldKey: string): void {
  if (!traceActiveForField(fieldKey)) return;
  logCheckpoint('user-tap-while-active', fieldKey, {});
}

export function logCheckpoint(
  checkpoint: string,
  fieldKey: string,
  context: NextDiagContext = {},
): void {
  if (!MEASUREMENT_NEXT_NATIVE_DIAG_ENABLED) return;
  if (!activeTrace) return;
  if (activeTrace.destinationFieldKey && activeTrace.destinationFieldKey !== fieldKey) return;
  if (!activeTrace.destinationFieldKey && activeTrace.sourceFieldKey === fieldKey) return;

  activeTrace.checkpoints.push(checkpoint);
  const payload = {
    event: 'checkpoint',
    transitionId: activeTrace.id,
    checkpoint,
    fieldKey,
    sourceFieldKey: activeTrace.sourceFieldKey,
    focusCallCount: activeTrace.focusCallCount,
    onFocusFired: activeTrace.onFocusFired || context.onFocusFired || false,
    onSelectionChangeFired: activeTrace.onSelectionChangeFired || context.onSelectionChangeFired || false,
    onLayoutFired: activeTrace.onLayoutFired || context.onLayoutFired || false,
    lastOnSelectionChange: activeTrace.lastOnSelectionChange,
    ...context,
  };
  console.warn(LOG_PREFIX, JSON.stringify(payload));
}

export async function sampleNativeSelectionAtCheckpoint(
  checkpoint: string,
  fieldKey: string,
  inputRef: RefObject<TextInput | null>,
  context: NextDiagContext = {},
): Promise<void> {
  if (!traceActiveForField(fieldKey)) return;

  const native = await readNativeTextInputSelection(inputRef);
  const draftLength = context.draftLength ?? native?.textLength ?? 0;
  const selectionCase = classifyNativeSelectionCase(native, draftLength);

  if (checkpoint === 'pre-tap-settled' && activeTrace) {
    activeTrace.preTapNativeCase = selectionCase;
  }

  let caseTransition: 'C' | null = null;
  if (checkpoint === 'after-user-tap' && activeTrace?.preTapNativeCase === 'B' && selectionCase === 'A') {
    caseTransition = 'C';
  }

  console.warn(LOG_PREFIX, JSON.stringify({
    event: 'native-sample',
    transitionId: activeTrace?.id,
    checkpoint,
    fieldKey,
    native,
    jsSessionSelection: context.jsSessionSelection ?? null,
    selectTextOnFocusProp: context.selectTextOnFocusProp ?? null,
    nativeSelectPending: context.nativeSelectPending ?? null,
    selectionCase,
    caseTransition,
    preTapNativeCase: activeTrace?.preTapNativeCase ?? null,
    nativeMatchesSession: native && context.jsSessionSelection
      ? native.selectionStart === context.jsSessionSelection.start
        && native.selectionEnd === context.jsSessionSelection.end
      : null,
  }));
}

/** Observe post-handoff frames without changing existing focus deferral. */
export function scheduleNavigateNativeSamples(
  fieldKey: string,
  inputRef: RefObject<TextInput | null>,
  context: NextDiagContext,
): void {
  if (!traceActiveForField(fieldKey)) return;

  const sample = (checkpoint: string) => {
    void sampleNativeSelectionAtCheckpoint(checkpoint, fieldKey, inputRef, context);
  };

  logCheckpoint('after-handoff-sync', fieldKey, context);
  sample('after-handoff-sync');

  requestAnimationFrame(() => {
    logCheckpoint('after-raf-1', fieldKey, context);
    sample('after-raf-1');
    requestAnimationFrame(() => {
      logCheckpoint('after-raf-2', fieldKey, context);
      sample('after-raf-2');
      logCheckpoint('pre-tap-settled', fieldKey, {
        ...context,
        onFocusFired: activeTrace?.onFocusFired,
        onSelectionChangeFired: activeTrace?.onSelectionChangeFired,
        onLayoutFired: activeTrace?.onLayoutFired,
        onSelectionChangeRange: activeTrace?.lastOnSelectionChange,
      });
      sample('pre-tap-settled');
    });
  });
}

export function finishNextTransitionSummary(fieldKey: string): void {
  if (!activeTrace) return;
  console.warn(LOG_PREFIX, JSON.stringify({
    event: 'next-trace-summary',
    transitionId: activeTrace.id,
    destinationFieldKey: fieldKey,
    checkpoints: activeTrace.checkpoints,
    focusCallCount: activeTrace.focusCallCount,
    onFocusFired: activeTrace.onFocusFired,
    onSelectionChangeFired: activeTrace.onSelectionChangeFired,
    onLayoutFired: activeTrace.onLayoutFired,
    lastOnSelectionChange: activeTrace.lastOnSelectionChange,
  }));
}