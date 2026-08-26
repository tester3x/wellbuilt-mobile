import React, {
  useImperativeHandle,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useId,
  useLayoutEffect,
} from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Platform,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { useMeasurementKeypadOptional } from '../contexts/MeasurementKeypadContext';
import type { KeypadVariant } from './TankLevelKeypad';
import type { KeypadEntryMode } from '../utils/measurementInputFocus';
import { validateMeasurementDraft } from '../utils/tankLevelFormat';
import {
  measurementEditableTextStyle,
  measurementInputVisualProps,
  measurementRowContainerStyle,
} from '../utils/measurementFieldStyle';
import {
  isNextSelectionDiagTracingField,
  recordActiveFieldTap,
  recordOnFocus,
  recordOnLayout,
  recordOnSelectionChange,
  sampleNativeSelectionAtCheckpoint,
} from '../utils/measurementNextSelectionDiag';

export interface LevelFieldInputHandle {
  focus: () => void;
  blur: () => void;
  openKeypad: (options?: { initialValue?: string; entryMode?: KeypadEntryMode }) => void;
  activateAsHandoffTarget: (options?: { initialValue?: string }) => void;
  getAnchorNode: () => View | null;
}

interface LevelFieldInputProps {
  /** Stable id matching the form field (e.g. package field id). */
  fieldKey?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: object;
  hint?: string | null;
  label?: string;
  variant?: KeypadVariant;
  onBeforeOpen?: () => void;
  onDoneComplete?: (value: string) => void;
  onNextComplete?: (value: string) => void;
  /** Offer the committing Done action as Go in the keypad's workflow slot.
   *  Terminal submit-on-commit fields only (new-load BBLs). */
  showGoAction?: boolean;
}

const MEASUREMENT_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

const LevelFieldInput = forwardRef<LevelFieldInputHandle, LevelFieldInputProps>(function LevelFieldInput(
  {
    fieldKey: fieldKeyProp,
    value,
    onChange,
    placeholder = '10 4',
    style,
    hint,
    label,
    variant = 'level',
    onBeforeOpen,
    onDoneComplete,
    onNextComplete,
    showGoAction = false,
  },
  ref,
) {
  const reactId = useId();
  const fieldKey = fieldKeyProp ?? reactId;
  const keypadCtx = useMeasurementKeypadOptional();
  const anchorRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);
  const pendingEntryMode = useRef<KeypadEntryMode | null>(null);

  // Registry membership must not be focus-gated: programmatic handoff (Next)
  // resolves the destination ref from this registry BEFORE the field has ever
  // held native focus. Register for the whole mounted lifetime so
  // focusMeasurementInput can always reach the native TextInput.
  const registerMeasurementInput = keypadCtx?.registerMeasurementInput;
  const unregisterMeasurementInput = keypadCtx?.unregisterMeasurementInput;
  useEffect(() => {
    if (!registerMeasurementInput || !unregisterMeasurementInput) return undefined;
    registerMeasurementInput(fieldKey, inputRef);
    return () => unregisterMeasurementInput(fieldKey);
  }, [registerMeasurementInput, unregisterMeasurementInput, fieldKey]);

  const isActive = keypadCtx?.isActiveField(fieldKey) ?? false;
  const displayValue = isActive && keypadCtx ? keypadCtx.draft : value;
  const keypadCommandSelection = isActive
    ? keypadCtx?.getKeypadCommandSelectionForField(fieldKey, displayValue) ?? null
    : null;
  const validation = variant === 'level' && displayValue
    ? validateMeasurementDraft(displayValue)
    : { valid: true as const };
  const activeVisualProps = measurementInputVisualProps();
  const nativeSelectOnFocus = isActive
    ? keypadCtx?.isNativeSelectOnFocusForField(fieldKey) ?? false
    : false;

  useLayoutEffect(() => {
    if (!isActive || !keypadCtx) return;
    keypadCtx.applyPendingKeypadNativeSync(fieldKey, inputRef);
  }, [isActive, keypadCtx, keypadCtx?.keypadSyncSeq, displayValue, fieldKey]);

  const buildKeypadConfig = useCallback((options?: {
    initialValue?: string;
    entryMode?: KeypadEntryMode;
  }) => ({
    fieldKey,
    value: options?.initialValue ?? value,
    variant,
    entryMode: options?.entryMode ?? 'tap',
    onDismiss: () => {
      inputRef.current?.blur();
    },
    onDone: (formatted: string) => {
      onChange(formatted);
      onDoneComplete?.(formatted);
    },
    onCommitValue: (formatted: string) => {
      onChange(formatted);
    },
    onNext: onNextComplete
      ? (formatted: string) => {
          onChange(formatted);
          onNextComplete(formatted);
        }
      : undefined,
    showGoAction,
  }), [fieldKey, value, variant, onChange, onDoneComplete, onNextComplete, showGoAction]);

  const openKeypadSession = useCallback((options?: {
    initialValue?: string;
    entryMode?: KeypadEntryMode;
  }) => {
    onBeforeOpen?.();
    if (!keypadCtx) {
      console.warn('[LevelFieldInput] MeasurementKeypadProvider missing — keypad unavailable');
      return;
    }

    const entryMode = options?.entryMode ?? 'tap';
    pendingEntryMode.current = entryMode;
    keypadCtx.openKeypad(buildKeypadConfig(options));
  }, [onBeforeOpen, keypadCtx, buildKeypadConfig]);

  const activateAsHandoffTarget = useCallback((options?: { initialValue?: string }) => {
    if (!keypadCtx) return;
    keypadCtx.handoffToField({
      ...buildKeypadConfig({ initialValue: options?.initialValue, entryMode: 'navigate' }),
    });
  }, [keypadCtx, buildKeypadConfig]);

  useImperativeHandle(ref, () => ({
    focus: () => openKeypadSession({ entryMode: 'navigate' }),
    blur: () => {
      inputRef.current?.blur();
    },
    openKeypad: openKeypadSession,
    activateAsHandoffTarget,
    getAnchorNode: () => anchorRef.current,
  }), [openKeypadSession, activateAsHandoffTarget]);

  const handleFocus = useCallback(() => {
    if (keypadCtx?.isActiveField(fieldKey)) {
      if (isNextSelectionDiagTracingField(fieldKey)) {
        recordOnFocus(fieldKey);
        void sampleNativeSelectionAtCheckpoint('onFocus-active', fieldKey, inputRef, {
          selectTextOnFocusProp: nativeSelectOnFocus,
          nativeSelectPending: keypadCtx?.isNativeSelectOnFocusForField(fieldKey) ?? false,
          jsSessionSelection: keypadCtx?.selection ?? null,
          draftLength: keypadCtx?.draft.length ?? 0,
          onFocusFired: true,
        });
      }
      return;
    }

    const entryMode = pendingEntryMode.current ?? 'tap';
    pendingEntryMode.current = null;
    openKeypadSession({ entryMode });
  }, [fieldKey, keypadCtx, openKeypadSession, nativeSelectOnFocus]);

  const handleSelectionChange = useCallback((
    event: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    if (!keypadCtx?.isActiveField(fieldKey)) return;
    const { start, end } = event.nativeEvent.selection;
    if (isNextSelectionDiagTracingField(fieldKey)) {
      recordOnSelectionChange(fieldKey, { start, end });
      void sampleNativeSelectionAtCheckpoint('onSelectionChange', fieldKey, inputRef, {
        selectTextOnFocusProp: nativeSelectOnFocus,
        nativeSelectPending: keypadCtx?.isNativeSelectOnFocusForField(fieldKey) ?? false,
        jsSessionSelection: keypadCtx?.selection ?? null,
        draftLength: keypadCtx?.draft.length ?? 0,
        onSelectionChangeFired: true,
        onSelectionChangeRange: { start, end },
      });
    }
    keypadCtx.updateSelection({ start, end });
  }, [fieldKey, keypadCtx, nativeSelectOnFocus]);

  const handlePressIn = useCallback(() => {
    if (!keypadCtx?.isActiveField(fieldKey)) return;
    if (!isNextSelectionDiagTracingField(fieldKey)) return;
    recordActiveFieldTap(fieldKey);
    void sampleNativeSelectionAtCheckpoint('after-user-tap', fieldKey, inputRef, {
      selectTextOnFocusProp: nativeSelectOnFocus,
      nativeSelectPending: keypadCtx?.isNativeSelectOnFocusForField(fieldKey) ?? false,
      jsSessionSelection: keypadCtx?.selection ?? null,
      draftLength: keypadCtx?.draft.length ?? 0,
    });
  }, [fieldKey, keypadCtx, nativeSelectOnFocus]);

  const handleFieldWrapLayout = useCallback(() => {
    if (!keypadCtx?.isActiveField(fieldKey)) return;
    if (!isNextSelectionDiagTracingField(fieldKey)) return;
    recordOnLayout(fieldKey);
  }, [fieldKey, keypadCtx]);

  const handleChangeText = useCallback((text: string) => {
    if (!keypadCtx?.isActiveField(fieldKey)) return;
    keypadCtx.updateDraftFromNative(text);
  }, [fieldKey, keypadCtx]);

  return (
    <View ref={anchorRef} collapsable={false}>
      <View style={styles.fieldWrap} onLayout={handleFieldWrapLayout}>
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            style,
            isActive ? styles.inputActive : null,
            !isActive && !validation.valid ? styles.invalidText : null,
            { fontFamily: MEASUREMENT_FONT },
          ]}
          value={displayValue}
          {...(keypadCommandSelection && !nativeSelectOnFocus ? { selection: keypadCommandSelection } : {})}
          placeholder={placeholder}
          placeholderTextColor="#555"
          showSoftInputOnFocus={activeVisualProps.showSoftInputOnFocus}
          selectTextOnFocus={nativeSelectOnFocus}
          editable
          multiline={false}
          onFocus={handleFocus}
          onPressIn={handlePressIn}
          onChangeText={isActive ? handleChangeText : undefined}
          onSelectionChange={handleSelectionChange}
          contextMenuHidden={activeVisualProps.contextMenuHidden}
          autoCorrect={false}
          autoCapitalize="none"
          {...(isActive ? {
            cursorColor: activeVisualProps.cursorColor,
            selectionColor: activeVisualProps.selectionColor,
            caretHidden: activeVisualProps.caretHidden,
          } : {})}
          {...(Platform.OS === 'android' ? {
            includeFontPadding: false,
            textAlignVertical: 'center' as const,
          } : {})}
        />
      </View>
      {hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
});

export default LevelFieldInput;

const styles = StyleSheet.create({
  fieldWrap: {
    position: 'relative',
    alignSelf: 'stretch',
    ...measurementRowContainerStyle(),
  },
  input: {
    color: '#fff',
    ...measurementEditableTextStyle(),
    ...measurementRowContainerStyle(),
    paddingHorizontal: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  inputActive: {
    borderBottomColor: '#FFD700',
    borderBottomWidth: 2,
  },
  invalidText: {
    color: '#ff4444',
  },
  hint: {
    color: '#666',
    fontSize: 10,
    marginTop: 2,
  },
});