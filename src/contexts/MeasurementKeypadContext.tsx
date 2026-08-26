import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Animated,
  Keyboard,
  StyleSheet,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import TankLevelKeypad, { type KeypadVariant } from '../components/TankLevelKeypad';
import type { TextSelection } from '../utils/tankLevelEditing';
import type { KeypadEntryMode } from '../utils/measurementInputFocus';
import {
  applyKeyToSession,
  canCommitKeypadSession,
  commitKeypadSession,
  createKeypadSession,
  moveKeypadCursor,
  type KeypadKeyDef,
} from '../utils/measurementKeypadSession';
import {
  commandSelectionAppliesToField,
  createPendingKeypadNativeSync,
  resolveNativeSelectionReport,
  type KeypadSelectionSyncMode,
  type PendingKeypadNativeSync,
} from '../utils/measurementKeypadNativeSync';
import {
  selectionForFieldActivation,
  type PendingEntrySelectAll,
} from '../utils/measurementFieldActivation';
import {
  shouldApplyNativeNavigateFullBufferSelect,
  shouldConfirmNativeSelectOnFocus,
  shouldUseNativeSelectOnFocus,
  type PendingNativeSelectOnFocus,
} from '../utils/measurementNativeSelectOnFocus';
import { applyNativeFullBufferSelection } from '../utils/measurementInputDiagNative';
import {
  ownershipCleanupForType,
  type FormInputOwnerType,
} from '../utils/formInputOwnership';
import {
  beginNextTransition,
  logCheckpoint,
  recordFocusCall,
  scheduleNavigateNativeSamples,
  setNextDestinationField,
} from '../utils/measurementNextSelectionDiag';

export interface RequestInputOwnershipOptions {
  type: FormInputOwnerType;
  fieldKey?: string;
}

export interface OpenKeypadConfig {
  fieldKey: string;
  value: string;
  variant?: KeypadVariant;
  entryMode?: KeypadEntryMode;
  initialSelection?: TextSelection;
  onDismiss: () => void;
  onDone: (value: string) => void;
  /** Persist committed value without workflow navigation (direct field handoff). */
  onCommitValue?: (value: string) => void;
  onNext?: (value: string) => void;
  /** Select the destination's full buffer once on this field activation. */
  selectExistingValue?: boolean;
}

interface CommitLeavingOptions {
  /** When false, persist form value only — do not run onNext workflow navigation. */
  advanceWorkflow?: boolean;
}

interface KeypadSession extends OpenKeypadConfig {
  draft: string;
  selection: TextSelection;
  variant: KeypadVariant;
  /** Multi-haul ticket ownership (Phase A): the invoice docId whose form owned
   *  this session when it opened. A draft may commit ONLY to its owning
   *  ticket — a session that outlives a tab switch is dropped, never applied
   *  to the newly active ticket. null = no registered owner (single-ticket
   *  flows and non-Ticket callers behave exactly as before). */
  ownerDocId: string | null;
}

interface MeasurementKeypadContextValue {
  isOpen: boolean;
  activeFieldKey: string | null;
  showNext: boolean;
  draft: string;
  selection: TextSelection;
  variant: KeypadVariant;
  canCommit: boolean;
  /** Bumps on explicit keypad commands so LevelFieldInput can apply command selection. */
  keypadSyncSeq: number;
  /** Temporary controlled selection for explicit keypad commands; null when native owns selection. */
  keypadCommandSelection: TextSelection | null;
  /** Draft the active command selection was issued against (guards cross-field stale props). */
  keypadCommandSelectionDraft: string | null;
  getKeypadCommandSelectionForField: (fieldKey: string, displayValue: string) => TextSelection | null;
  /** One-use native selectTextOnFocus for populated field entry (tap or navigate). */
  nativeSelectOnFocus: PendingNativeSelectOnFocus | null;
  isNativeSelectOnFocusForField: (fieldKey: string) => boolean;
  /** Bumps when a pending entry select-all is queued for LevelFieldInput. */
  entrySelectAllSeq: number;
  isActiveField: (fieldKey: string) => boolean;
  applyPendingEntrySelectAll: (fieldKey: string) => void;
  /** Register the invoice docId that currently owns the mounted measurement
   *  form. New sessions are stamped with it; commits verify it (Phase A). */
  setMeasurementFormOwner: (docId: string | null) => void;
  requestInputOwnership: (options: RequestInputOwnershipOptions) => void;
  openKeypad: (config: OpenKeypadConfig) => void;
  handoffToField: (config: OpenKeypadConfig) => void;
  closeKeypad: () => void;
  updateSelection: (selection: TextSelection) => void;
  updateDraftFromNative: (draft: string) => void;
  applyPendingKeypadNativeSync: (
    fieldKey: string,
    inputRef: RefObject<TextInput | null>,
  ) => void;
  registerMeasurementInput: (fieldKey: string, inputRef: RefObject<TextInput | null>) => void;
  unregisterMeasurementInput: (fieldKey: string) => void;
  blurOrdinaryInputs: () => void;
  registerOrdinaryInput: (inputRef: RefObject<TextInput | null>) => () => void;
  /** Cancel stale delayed ordinary-field focus (e.g. workflow advance timers). */
  registerWorkflowFocusCancel: (cancel: (() => void) | null) => void;
  /** Blur all ordinary/search inputs outside the keypad ref registry. */
  registerBlurOrdinaryHandler: (handler: (() => void) | null) => void;
  applyKey: (key: KeypadKeyDef) => void;
  cursorLeft: () => void;
  cursorRight: () => void;
  commitDone: () => void;
  commitNext: () => void;
  /**
   * 7/26 ticket 19858 — flush the active session's draft into its field
   * WITHOUT advancing the workflow (the field stays selected). Returns the
   * committed {fieldKey, committed} so a synchronous caller (Depart
   * validation) can read the typed value immediately, or null when no
   * committable session is active.
   */
  flushActiveDraft: () => { fieldKey: string; committed: string } | null;
  /** 7/27 — the one shared "commit and dismiss active input" op (commit draft
   *  to field + run dependent calc + clear focus + hide keypad + native
   *  Keyboard.dismiss). Returns the committed value for a pre-validation read. */
  commitAndDismiss: () => { fieldKey: string; committed: string } | null;
}

const MeasurementKeypadContext = createContext<MeasurementKeypadContextValue | null>(null);

export function MeasurementKeypadProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<KeypadSession | null>(null);
  const [keypadSyncSeq, setKeypadSyncSeq] = useState(0);
  const [entrySelectAllSeq, setEntrySelectAllSeq] = useState(0);
  const [keypadCommandSelection, setKeypadCommandSelection] = useState<TextSelection | null>(null);
  const [keypadCommandSelectionDraft, setKeypadCommandSelectionDraft] = useState<string | null>(null);
  const [nativeSelectOnFocus, setNativeSelectOnFocus] = useState<PendingNativeSelectOnFocus | null>(null);
  const keypadSyncSeqRef = useRef(0);
  const activationSeqRef = useRef(0);
  const sessionRef = useRef<KeypadSession | null>(null);
  const pendingNativeSyncRef = useRef<PendingKeypadNativeSync | null>(null);
  const pendingEntrySelectAllRef = useRef<PendingEntrySelectAll | null>(null);
  const pendingNativeSelectOnFocusRef = useRef<PendingNativeSelectOnFocus | null>(null);
  const measurementInputRefs = useRef<Record<string, RefObject<TextInput | null>>>({});
  const ordinaryInputRefs = useRef<Set<RefObject<TextInput | null>>>(new Set());
  const workflowFocusCancelRef = useRef<(() => void) | null>(null);
  const blurOrdinaryHandlerRef = useRef<(() => void) | null>(null);
  const applyNavigateNativeFullBufferSelectRef = useRef<
    (fieldKey: string, inputRef: RefObject<TextInput | null>) => void
  >(() => {});

  const cancelPendingWorkflowFocus = useCallback(() => {
    workflowFocusCancelRef.current?.();
  }, []);

  // ── Ticket ownership (multi-haul Phase A) ──────────────────────────────
  // The docId whose form currently owns measurement input. Registered by
  // TicketModule whenever the active invoice changes. A session commits only
  // when its stamped owner matches (or ownership was never registered —
  // preserving single-ticket behavior verbatim).
  const formOwnerDocIdRef = useRef<string | null>(null);
  const setMeasurementFormOwner = useCallback((docId: string | null) => {
    formOwnerDocIdRef.current = docId;
  }, []);
  const sessionOwnerMismatch = useCallback((current: KeypadSession): boolean => {
    return (
      !!current.ownerDocId &&
      !!formOwnerDocIdRef.current &&
      current.ownerDocId !== formOwnerDocIdRef.current
    );
  }, []);

  const clearNativeSelectOnFocus = useCallback(() => {
    pendingNativeSelectOnFocusRef.current = null;
    setNativeSelectOnFocus(null);
  }, []);

  const releaseKeypadCommandSelection = useCallback(() => {
    pendingNativeSyncRef.current = null;
    setKeypadCommandSelection(null);
    setKeypadCommandSelectionDraft(null);
  }, []);

  const queueKeypadNativeSync = useCallback((
    draft: string,
    selection: TextSelection,
    mode: KeypadSelectionSyncMode = 'collapsed',
  ) => {
    keypadSyncSeqRef.current += 1;
    const seq = keypadSyncSeqRef.current;
    const fieldKey = sessionRef.current?.fieldKey ?? '';
    pendingNativeSyncRef.current = createPendingKeypadNativeSync(draft, selection, seq, mode);
    setKeypadCommandSelection(selection);
    setKeypadCommandSelectionDraft(draft);
    setKeypadSyncSeq(seq);
  }, []);

  const applyPendingKeypadNativeSync = useCallback((
    fieldKey: string,
    _inputRef: RefObject<TextInput | null>,
  ) => {
    const pending = pendingNativeSyncRef.current;
    const current = sessionRef.current;
    if (!pending || !current || current.fieldKey !== fieldKey) return;
    if (current.draft !== pending.draft) return;
    // Fabric Android ignores setNativeProps selection; LevelFieldInput applies
    // keypadCommandSelection as a temporary controlled prop until confirmed.
  }, []);

  const focusMeasurementInput = useCallback((
    fieldKey: string,
    options?: {
      deferForNativeSelect?: boolean;
      applyNativeNavigateSelect?: boolean;
      diagSource?: string;
    },
  ) => {
    recordFocusCall(
      fieldKey,
      options?.diagSource ?? 'focusMeasurementInput',
      options?.deferForNativeSelect ?? false,
      !!measurementInputRefs.current[fieldKey],
    );
    const focus = () => {
      // Resolve at fire time, not call time — registration may land between
      // the request and the deferred frame.
      const inputRef = measurementInputRefs.current[fieldKey];
      inputRef?.current?.focus();
      if (options?.applyNativeNavigateSelect && inputRef) {
        applyNavigateNativeFullBufferSelectRef.current(fieldKey, inputRef);
      }
    };
    if (options?.deferForNativeSelect) {
      requestAnimationFrame(() => {
        requestAnimationFrame(focus);
      });
      return;
    }
    requestAnimationFrame(focus);
  }, []);

  const surrenderMeasurementSession = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;

    // Ownership gate (Phase A): a session that outlived its ticket must be
    // dropped, not silently committed onto the newly active ticket. The tab
    // boundary commits legitimate drafts BEFORE the switch, so anything
    // reaching here with a stale owner is leftovers from a race.
    if (sessionOwnerMismatch(current)) {
      console.log('[MeasurementKeypad] stale-owner draft dropped (surrender)', {
        fieldKey: current.fieldKey,
        sessionOwner: current.ownerDocId,
        currentOwner: formOwnerDocIdRef.current,
      });
    } else if (canCommitKeypadSession({
      draft: current.draft,
      selection: current.selection,
      variant: current.variant,
    })) {
      const committed = commitKeypadSession({
        draft: current.draft,
        selection: current.selection,
        variant: current.variant,
      });
      if (current.onCommitValue) {
        current.onCommitValue(committed);
      } else {
        current.onDone(committed);
      }
    }

    const inputRef = measurementInputRefs.current[current.fieldKey];
    inputRef?.current?.blur();
    sessionRef.current = null;
    pendingEntrySelectAllRef.current = null;
    clearNativeSelectOnFocus();
    releaseKeypadCommandSelection();
    setSession(null);
  }, [clearNativeSelectOnFocus, releaseKeypadCommandSelection, sessionOwnerMismatch]);

  const blurAllOrdinaryInputs = useCallback(() => {
    blurOrdinaryHandlerRef.current?.();
    ordinaryInputRefs.current.forEach((inputRef) => inputRef.current?.blur());
  }, []);

  const requestInputOwnership = useCallback((options: RequestInputOwnershipOptions) => {
    cancelPendingWorkflowFocus();
    const cleanup = ownershipCleanupForType(options.type);

    if (cleanup.surrenderMeasurement) {
      surrenderMeasurementSession();
    }
    if (cleanup.blurOrdinary) {
      blurAllOrdinaryInputs();
    }
    if (cleanup.dismissKeyboard) {
      Keyboard.dismiss();
    }
  }, [
    cancelPendingWorkflowFocus,
    surrenderMeasurementSession,
    blurAllOrdinaryInputs,
  ]);

  const closeKeypad = useCallback(() => {
    // Phase A: an explicit close also cancels any pending workflow-advance
    // focus timer — a closed keypad must never later yank focus to the next
    // field (e.g. after a tab switch). Next-key advancement (commitNext) does
    // not pass through here, so frozen Next behavior is unchanged.
    cancelPendingWorkflowFocus();
    surrenderMeasurementSession();
    Keyboard.dismiss();
  }, [cancelPendingWorkflowFocus, surrenderMeasurementSession]);

  const registerBlurOrdinaryHandler = useCallback((handler: (() => void) | null) => {
    blurOrdinaryHandlerRef.current = handler;
  }, []);

  const nextActivationId = useCallback(() => {
    activationSeqRef.current += 1;
    return activationSeqRef.current;
  }, []);

  const buildSession = useCallback((config: OpenKeypadConfig): KeypadSession => {
    const editing = createKeypadSession(config.value, config.variant ?? 'level');
    const selectExistingValue = config.selectExistingValue ?? false;
    const entryMode = config.entryMode ?? 'tap';
    const selectAllOnEntry = shouldUseNativeSelectOnFocus(
      entryMode,
      selectExistingValue,
      editing.draft.length,
    );
    const selection = config.initialSelection
      ?? selectionForFieldActivation(editing.draft, selectAllOnEntry);
    return {
      ...config,
      variant: config.variant ?? 'level',
      draft: editing.draft,
      selection,
      // Stamp the owning ticket at open time (Phase A). null when no owner is
      // registered — preserves non-Ticket / single-ticket behavior.
      ownerDocId: formOwnerDocIdRef.current,
    };
  }, []);

  const activateMeasurementField = useCallback((config: OpenKeypadConfig) => {
    const selectExistingValue = config.selectExistingValue ?? false;
    const entryMode = config.entryMode ?? 'tap';
    const activationId = nextActivationId();
    const next = buildSession({ ...config, selectExistingValue, entryMode });
    sessionRef.current = next;
    setSession(next);
    pendingEntrySelectAllRef.current = null;
    releaseKeypadCommandSelection();

    const useNativeSelectOnFocus = shouldUseNativeSelectOnFocus(
      entryMode,
      selectExistingValue,
      next.draft.length,
    );
    if (useNativeSelectOnFocus) {
      const pending: PendingNativeSelectOnFocus = {
        activationId,
        fieldKey: next.fieldKey,
        draft: next.draft,
      };
      pendingNativeSelectOnFocusRef.current = pending;
      setNativeSelectOnFocus(pending);
    } else {
      clearNativeSelectOnFocus();
    }

    const applyNativeNavigateSelect = shouldApplyNativeNavigateFullBufferSelect(
      entryMode,
      selectExistingValue,
      next.draft.length,
    );
    focusMeasurementInput(next.fieldKey, {
      deferForNativeSelect: useNativeSelectOnFocus,
      applyNativeNavigateSelect,
      diagSource: 'activateMeasurementField',
    });

    if (entryMode === 'navigate') {
      setNextDestinationField(next.fieldKey);
      logCheckpoint('after-session-activation', next.fieldKey, {
        entryMode,
        selectTextOnFocusProp: useNativeSelectOnFocus,
        nativeSelectPending: useNativeSelectOnFocus,
        jsSessionSelection: next.selection,
        draftLength: next.draft.length,
      });
      const destInputRef = measurementInputRefs.current[next.fieldKey];
      if (destInputRef) {
        scheduleNavigateNativeSamples(next.fieldKey, destInputRef, {
          entryMode,
          selectTextOnFocusProp: useNativeSelectOnFocus,
          nativeSelectPending: useNativeSelectOnFocus,
          jsSessionSelection: next.selection,
          draftLength: next.draft.length,
        });
      }
    }

    return next;
  }, [
    buildSession,
    clearNativeSelectOnFocus,
    focusMeasurementInput,
    nextActivationId,
    releaseKeypadCommandSelection,
  ]);

  const applyPendingEntrySelectAll = useCallback((_fieldKey: string) => {
    // Workflow entry select-all uses native selectTextOnFocus, not controlled selection.
  }, []);

  const commitKeypadCommand = useCallback((
    nextDraft: string,
    nextSelection: TextSelection,
    draftChanged: boolean,
  ) => {
    const current = sessionRef.current;
    if (!current) return;

    const updated = { ...current, draft: nextDraft, selection: nextSelection };
    sessionRef.current = updated;
    if (draftChanged) {
      setSession(updated);
    }
    queueKeypadNativeSync(nextDraft, nextSelection);
  }, [queueKeypadNativeSync]);

  const commitLeavingKeypadSession = useCallback((
    current: KeypadSession,
    options?: CommitLeavingOptions,
  ): boolean => {
    // Ownership gate (Phase A) — never write a stale ticket's draft into the
    // currently mounted form (see surrenderMeasurementSession note).
    if (sessionOwnerMismatch(current)) {
      console.log('[MeasurementKeypad] stale-owner draft dropped (commitLeaving)', {
        fieldKey: current.fieldKey,
        sessionOwner: current.ownerDocId,
        currentOwner: formOwnerDocIdRef.current,
      });
      return false;
    }
    if (!canCommitKeypadSession({
      draft: current.draft,
      selection: current.selection,
      variant: current.variant,
    })) {
      return false;
    }
    const advanceWorkflow = options?.advanceWorkflow !== false;
    const committed = commitKeypadSession({
      draft: current.draft,
      selection: current.selection,
      variant: current.variant,
    });
    if (advanceWorkflow && current.onNext) {
      current.onNext(committed);
    } else if (current.onCommitValue) {
      current.onCommitValue(committed);
    } else if (current.onNext) {
      current.onNext(committed);
    } else {
      current.onDone(committed);
    }
    return true;
  }, [sessionOwnerMismatch]);

  const handoffToField = useCallback((config: OpenKeypadConfig) => {
    const previousFieldKey = sessionRef.current?.fieldKey;

    if (previousFieldKey && previousFieldKey !== config.fieldKey) {
      measurementInputRefs.current[previousFieldKey]?.current?.blur();
    }

    activateMeasurementField({
      ...config,
      entryMode: config.entryMode ?? 'navigate',
      selectExistingValue: true,
    });
  }, [activateMeasurementField]);

  const openKeypad = useCallback((config: OpenKeypadConfig) => {
    requestInputOwnership({ type: 'measurement', fieldKey: config.fieldKey });
    const entryMode = config.entryMode ?? 'tap';
    const existing = sessionRef.current;

    if (existing?.fieldKey === config.fieldKey) {
      return;
    }

    if (existing && existing.fieldKey !== config.fieldKey) {
      const sourceFieldKey = existing.fieldKey;
      const sourceInputRef = measurementInputRefs.current[sourceFieldKey];
      commitLeavingKeypadSession(existing, { advanceWorkflow: false });
      sourceInputRef?.current?.blur();

      const afterCommit = sessionRef.current;
      if (afterCommit && afterCommit.fieldKey === config.fieldKey) {
        activateMeasurementField({
          ...config,
          entryMode,
          selectExistingValue: true,
        });
        return;
      }

      handoffToField({ ...config, entryMode, selectExistingValue: true });
      return;
    }

    activateMeasurementField({
      ...config,
      entryMode,
      selectExistingValue: true,
    });
  }, [
    requestInputOwnership,
    commitLeavingKeypadSession,
    activateMeasurementField,
    handoffToField,
  ]);

  const isActiveField = useCallback(
    // Owner check (Phase A): a session that outlived its ticket must not make
    // the new ticket's field render the stale draft (or a placeholder) in
    // place of its own committed value.
    (fieldKey: string) =>
      sessionRef.current?.fieldKey === fieldKey &&
      !sessionOwnerMismatch(sessionRef.current),
    [session?.fieldKey, sessionOwnerMismatch],
  );

  const updateSelection = useCallback((selection: TextSelection) => {
    const current = sessionRef.current;
    if (!current) return;

    const pendingBefore = pendingNativeSyncRef.current;
    const result = resolveNativeSelectionReport(
      {
        pending: pendingBefore,
        held: null,
      },
      selection,
      current.draft,
      current.fieldKey,
    );

    if (result.ignored) {
      return;
    }

    if (shouldConfirmNativeSelectOnFocus(
      pendingNativeSelectOnFocusRef.current,
      current.fieldKey,
      current.draft,
      {
        start: Math.max(0, Math.min(current.draft.length, selection.start)),
        end: Math.max(0, Math.min(current.draft.length, selection.end)),
      },
    )) {
      clearNativeSelectOnFocus();
    }

    pendingNativeSyncRef.current = result.pending;

    if (result.releaseCommandSelection) {
      releaseKeypadCommandSelection();
    }

    const accepted = result.acceptSelection;
    if (!accepted) {
      return;
    }

    if (
      current.selection.start === accepted.start
      && current.selection.end === accepted.end
    ) {
      return;
    }

    sessionRef.current = { ...current, selection: accepted };
  }, [releaseKeypadCommandSelection]);

  useEffect(() => {
    applyNavigateNativeFullBufferSelectRef.current = (fieldKey, inputRef) => {
      void (async () => {
        const current = sessionRef.current;
        if (!current || current.fieldKey !== fieldKey) return;
        const result = await applyNativeFullBufferSelection(inputRef);
        logCheckpoint('native-apply-full-buffer', fieldKey, {
          jsSessionSelection: current.selection,
          draftLength: current.draft.length,
          onSelectionChangeRange: result
            ? { start: result.selectionStart, end: result.selectionEnd }
            : null,
        });
        if (!result?.applied) return;
        updateSelection({
          start: result.selectionStart,
          end: result.selectionEnd,
        });
      })();
    };
  }, [updateSelection]);

  const getKeypadCommandSelectionForField = useCallback((
    fieldKey: string,
    displayValue: string,
  ): TextSelection | null => {
    if (!commandSelectionAppliesToField(
      fieldKey,
      displayValue,
      sessionRef.current?.fieldKey ?? null,
      keypadCommandSelection,
      keypadCommandSelectionDraft,
    )) {
      return null;
    }
    return keypadCommandSelection;
  }, [keypadCommandSelection, keypadCommandSelectionDraft]);

  const isNativeSelectOnFocusForField = useCallback((fieldKey: string): boolean => {
    return pendingNativeSelectOnFocusRef.current?.fieldKey === fieldKey
      || nativeSelectOnFocus?.fieldKey === fieldKey;
  }, [nativeSelectOnFocus]);

  const updateDraftFromNative = useCallback((draft: string) => {
    const current = sessionRef.current;
    if (!current || current.draft === draft) return;
    const next = { ...current, draft };
    sessionRef.current = next;
    setSession(next);
  }, []);

  const registerMeasurementInput = useCallback((
    fieldKey: string,
    inputRef: RefObject<TextInput | null>,
  ) => {
    measurementInputRefs.current[fieldKey] = inputRef;
  }, []);

  const unregisterMeasurementInput = useCallback((fieldKey: string) => {
    delete measurementInputRefs.current[fieldKey];
  }, []);

  const registerOrdinaryInput = useCallback((inputRef: RefObject<TextInput | null>) => {
    ordinaryInputRefs.current.add(inputRef);
    return () => {
      ordinaryInputRefs.current.delete(inputRef);
    };
  }, []);

  const registerWorkflowFocusCancel = useCallback((cancel: (() => void) | null) => {
    workflowFocusCancelRef.current = cancel;
  }, []);

  const blurOrdinaryInputs = useCallback(() => {
    blurAllOrdinaryInputs();
    Keyboard.dismiss();
  }, [blurAllOrdinaryInputs]);

  const applyKey = useCallback((key: KeypadKeyDef) => {
    const current = sessionRef.current;
    if (!current) return;
    const next = applyKeyToSession(
      { draft: current.draft, selection: current.selection, variant: current.variant },
      key,
    );
    commitKeypadCommand(next.draft, next.selection, next.draft !== current.draft);
  }, [commitKeypadCommand]);

  const cursorLeft = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    const next = moveKeypadCursor(
      { draft: current.draft, selection: current.selection, variant: current.variant },
      'left',
    );
    commitKeypadCommand(current.draft, next.selection, false);
  }, [commitKeypadCommand]);

  const cursorRight = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    const next = moveKeypadCursor(
      { draft: current.draft, selection: current.selection, variant: current.variant },
      'right',
    );
    commitKeypadCommand(current.draft, next.selection, false);
  }, [commitKeypadCommand]);

  const canCommit = session
    ? canCommitKeypadSession({
        draft: session.draft,
        selection: session.selection,
        variant: session.variant,
      })
    : false;

  const commitDone = useCallback(() => {
    const current = sessionRef.current;
    // Ownership gate (Phase A) — drop, don't apply, a stale ticket's draft.
    if (current && sessionOwnerMismatch(current)) {
      console.log('[MeasurementKeypad] stale-owner draft dropped (done)', {
        fieldKey: current.fieldKey,
        sessionOwner: current.ownerDocId,
        currentOwner: formOwnerDocIdRef.current,
      });
      sessionRef.current = null;
      clearNativeSelectOnFocus();
      releaseKeypadCommandSelection();
      setSession(null);
      Keyboard.dismiss();
      return;
    }
    if (!current || !canCommitKeypadSession({
      draft: current.draft,
      selection: current.selection,
      variant: current.variant,
    })) {
      return;
    }
    const committed = commitKeypadSession({
      draft: current.draft,
      selection: current.selection,
      variant: current.variant,
    });
    const inputRef = measurementInputRefs.current[current.fieldKey];
    current.onDone(committed);
    sessionRef.current = null;
    clearNativeSelectOnFocus();
    releaseKeypadCommandSelection();
    setSession(null);
    inputRef?.current?.blur();
    Keyboard.dismiss();
  }, [clearNativeSelectOnFocus, releaseKeypadCommandSelection, sessionOwnerMismatch]);

  // 7/26 ticket 19858 — flush the active draft into its field without
  // navigation. Depart calls this before validation so a value typed while a
  // measurement field still has focus counts immediately (no prior blur).
  const flushActiveDraft = useCallback((): { fieldKey: string; committed: string } | null => {
    const current = sessionRef.current;
    if (!current) return null;
    // Ownership gate (Phase A) — a stale ticket's draft must not flush into
    // the newly active ticket's form (nor be reported to the caller).
    if (sessionOwnerMismatch(current)) return null;
    if (!canCommitKeypadSession({
      draft: current.draft,
      selection: current.selection,
      variant: current.variant,
    })) {
      return null;
    }
    const committed = commitKeypadSession({
      draft: current.draft,
      selection: current.selection,
      variant: current.variant,
    });
    // Commit the value to the field WITHOUT advancing the workflow — the
    // field stays selected exactly as the driver left it.
    commitLeavingKeypadSession(current, { advanceWorkflow: false });
    return { fieldKey: current.fieldKey, committed };
  }, [commitLeavingKeypadSession, sessionOwnerMismatch]);

  // 7/27 — the ONE shared "commit and dismiss active input" operation. Commits
  // the active custom-keypad draft to its field (which runs dependent calc,
  // e.g. Bottom, via the field's onChange/effect), clears focus + hides the
  // custom keypad, blurs ordinary inputs, and dismisses the native keyboard.
  // Returns the committed {fieldKey, committed} so a caller can read the value
  // it just committed BEFORE validating. Every action that moves away from the
  // edited field calls this first so the last number is never lost.
  const commitAndDismiss = useCallback((): { fieldKey: string; committed: string } | null => {
    const flushed = flushActiveDraft();
    closeKeypad();              // surrender the measurement session + Keyboard.dismiss
    blurOrdinaryInputs();       // blur any ordinary/search TextInputs + Keyboard.dismiss
    return flushed;
  }, [flushActiveDraft, closeKeypad, blurOrdinaryInputs]);

  const commitNext = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    beginNextTransition(current.fieldKey);
    if (!commitLeavingKeypadSession(current, { advanceWorkflow: true })) {
      return;
    }
    const sourceFieldKey = current.fieldKey;
    logCheckpoint('commitNext-after-onNext', sessionRef.current?.fieldKey ?? sourceFieldKey, {
      jsSessionSelection: sessionRef.current?.selection ?? null,
      draftLength: sessionRef.current?.draft.length ?? 0,
    });
    const sourceInputRef = measurementInputRefs.current[sourceFieldKey];

    if (sessionRef.current && sessionRef.current.fieldKey !== sourceFieldKey) {
      sourceInputRef?.current?.blur();
      const nextField = sessionRef.current;
      setNextDestinationField(nextField.fieldKey);
      const entryMode = nextField.entryMode ?? 'navigate';
      focusMeasurementInput(nextField.fieldKey, {
        deferForNativeSelect: shouldUseNativeSelectOnFocus(
          entryMode,
          true,
          nextField.draft.length,
        ),
        applyNativeNavigateSelect: shouldApplyNativeNavigateFullBufferSelect(
          entryMode,
          true,
          nextField.draft.length,
        ),
        diagSource: 'commitNext-post-handoff',
      });
      return;
    }

    sessionRef.current = null;
    clearNativeSelectOnFocus();
    releaseKeypadCommandSelection();
    setSession(null);
    sourceInputRef?.current?.blur();
    Keyboard.dismiss();
  }, [clearNativeSelectOnFocus, commitLeavingKeypadSession, focusMeasurementInput, releaseKeypadCommandSelection]);

  const value = useMemo(
    () => ({
      isOpen: !!session,
      activeFieldKey: session?.fieldKey ?? null,
      showNext: !!session?.onNext,
      draft: session?.draft ?? '',
      selection: session?.selection ?? { start: 0, end: 0 },
      variant: session?.variant ?? 'level',
      canCommit,
      keypadSyncSeq,
      entrySelectAllSeq,
      keypadCommandSelection,
      keypadCommandSelectionDraft,
      getKeypadCommandSelectionForField,
      nativeSelectOnFocus,
      isNativeSelectOnFocusForField,
      isActiveField,
      applyPendingEntrySelectAll,
      setMeasurementFormOwner,
      requestInputOwnership,
      openKeypad,
      handoffToField,
      closeKeypad,
      updateSelection,
      updateDraftFromNative,
      applyPendingKeypadNativeSync,
      registerMeasurementInput,
      unregisterMeasurementInput,
      blurOrdinaryInputs,
      registerOrdinaryInput,
      registerWorkflowFocusCancel,
      registerBlurOrdinaryHandler,
      applyKey,
      cursorLeft,
      cursorRight,
      commitDone,
      commitNext,
      flushActiveDraft,
      commitAndDismiss,
    }),
    [
      session,
      setMeasurementFormOwner,
      canCommit,
      keypadSyncSeq,
      entrySelectAllSeq,
      keypadCommandSelection,
      keypadCommandSelectionDraft,
      getKeypadCommandSelectionForField,
      nativeSelectOnFocus,
      isNativeSelectOnFocusForField,
      isActiveField,
      applyPendingEntrySelectAll,
      requestInputOwnership,
      openKeypad,
      handoffToField,
      closeKeypad,
      updateSelection,
      updateDraftFromNative,
      applyPendingKeypadNativeSync,
      registerMeasurementInput,
      unregisterMeasurementInput,
      blurOrdinaryInputs,
      registerOrdinaryInput,
      registerWorkflowFocusCancel,
      registerBlurOrdinaryHandler,
      applyKey,
      cursorLeft,
      cursorRight,
      commitDone,
      commitNext,
      flushActiveDraft,
      commitAndDismiss,
    ],
  );

  return (
    <MeasurementKeypadContext.Provider value={value}>
      {children}
    </MeasurementKeypadContext.Provider>
  );
}

export function useRegisterOrdinaryInput(inputRef: RefObject<TextInput | null>) {
  const ctx = useContext(MeasurementKeypadContext);
  useEffect(() => {
    if (!ctx) return undefined;
    return ctx.registerOrdinaryInput(inputRef);
  }, [ctx, inputRef]);
}

export function useMeasurementKeypad(): MeasurementKeypadContextValue {
  const ctx = useContext(MeasurementKeypadContext);
  if (!ctx) {
    throw new Error('useMeasurementKeypad must be used within MeasurementKeypadProvider');
  }
  return ctx;
}

export function useMeasurementKeypadOptional(): MeasurementKeypadContextValue | null {
  return useContext(MeasurementKeypadContext);
}

/** Tap must stay within this box and duration to count as a dismiss tap. */
const DISMISS_TAP_SLOP_PX = 12;
const DISMISS_TAP_MAX_MS = 300;

export function MeasurementKeypadDismissOverlay({ children }: { children: ReactNode }) {
  const ctx = useContext(MeasurementKeypadContext);
  const tapCandidateRef = useRef<{ x: number; y: number; at: number } | null>(null);

  // A Pressable wrap claimed the JS responder on touch-start whenever the
  // keypad was open, which starved the form ScrollView of drag gestures
  // (scroll dead/sticky only while the keypad was up). This wrapper never
  // claims the responder: onStartShouldSetResponder is asked only when no
  // interactive descendant (field, key, row) claimed the touch — i.e. blank
  // form area — and it still returns false so the ScrollView keeps the
  // gesture. Dismiss fires on release only if the touch stayed a tap.
  return (
    <View
      style={styles.dismissRoot}
      onStartShouldSetResponder={(event: GestureResponderEvent) => {
        const touch = event.nativeEvent;
        tapCandidateRef.current = { x: touch.pageX, y: touch.pageY, at: Date.now() };
        return false;
      }}
      onTouchEnd={(event: GestureResponderEvent) => {
        const start = tapCandidateRef.current;
        tapCandidateRef.current = null;
        if (!start || !ctx?.isOpen) return;
        const touch = event.nativeEvent;
        const movedPastSlop =
          Math.abs(touch.pageX - start.x) > DISMISS_TAP_SLOP_PX
          || Math.abs(touch.pageY - start.y) > DISMISS_TAP_SLOP_PX;
        if (movedPastSlop || Date.now() - start.at > DISMISS_TAP_MAX_MS) return;
        ctx.closeKeypad();
      }}
      onTouchCancel={() => {
        tapCandidateRef.current = null;
      }}
    >
      {children}
    </View>
  );
}

export function MeasurementKeypadSlot({ doneEnabled = true }: { doneEnabled?: boolean }) {
  const ctx = useContext(MeasurementKeypadContext);
  const [rendered, setRendered] = useState(false);
  const [showNext, setShowNext] = useState(true);
  const slide = useRef(new Animated.Value(0)).current;
  const keypadWasOpenRef = useRef(false);

  useEffect(() => {
    if (ctx?.isOpen) {
      setShowNext(ctx.showNext);
      if (!keypadWasOpenRef.current) {
        setRendered(true);
        slide.setValue(0);
        Animated.spring(slide, {
          toValue: 1,
          useNativeDriver: true,
          tension: 68,
          friction: 11,
        }).start();
      }
      keypadWasOpenRef.current = true;
      return;
    }

    keypadWasOpenRef.current = false;
    if (rendered) {
      Animated.timing(slide, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [ctx?.isOpen, ctx?.showNext, rendered, slide]);

  if (!rendered || !ctx) return null;

  const translateY = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [195, 0],
  });

  return (
    <Animated.View style={[styles.slot, { transform: [{ translateY }] }]}>
      <TankLevelKeypad visible showNext={showNext} doneAllowed={doneEnabled} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dismissRoot: {
    flex: 1,
  },
  slot: {
    width: '100%',
  },
});