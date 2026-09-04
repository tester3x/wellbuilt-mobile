/**
 * WellBuiltAsyncButton — canonical CONTAINED async action primitive (V1).
 *
 * Contract (see BUSY-STATE-CONTRACT.md):
 *  - Disables repeated submission IMMEDIATELY on press (exactly one operation
 *    per tap) and gives immediate pressed/disabled feedback.
 *  - Shows a small inline ActivityIndicator while busy; the rest of the screen
 *    stays usable (use WellBuiltBusyOverlay when the whole form must block).
 *  - Keeps button width stable (locks the measured width while busy) so text
 *    and controls never jump.
 *  - `busy` may be controlled by the parent; otherwise the button manages its
 *    own busy state for the lifetime of the onPress promise.
 *  - Always clears busy on resolve/reject; guards against setState after unmount
 *    so a thrown/cancelled operation never leaves a stuck spinner.
 *
 * Uses the WellBuilt action accent and RN's built-in ActivityIndicator.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { WELLBUILT_ACCENT } from './WellBuiltBusyOverlay';
import { createSingleFlight } from '../utils/singleFlight';

export interface WellBuiltAsyncButtonProps {
  onPress: () => void | Promise<unknown>;
  label: string;
  /** Optional label shown while busy (defaults to `label`, width locked). */
  busyLabel?: string;
  /** Controlled busy state. Omit to let the button track its own onPress promise. */
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /** Spinner + text color when the button surface is dark/light. */
  spinnerColor?: string;
  testID?: string;
  accessibilityLabel?: string;
}

export function WellBuiltAsyncButton({
  onPress,
  label,
  busyLabel,
  busy: controlledBusy,
  disabled = false,
  style,
  textStyle,
  spinnerColor = '#FFFFFF',
  testID = 'wb-async-button',
  accessibilityLabel,
}: WellBuiltAsyncButtonProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const [lockedWidth, setLockedWidth] = useState<number | undefined>(undefined);
  const mounted = useRef(true);
  // One-operation-per-tap guard: flips synchronously, clears on resolve OR reject.
  const flight = useRef(createSingleFlight());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const busy = controlledBusy ?? internalBusy;

  const handlePress = useCallback(() => {
    // Synchronous duplicate-tap guard (before any await) — exactly one operation.
    if (disabled || flight.current.running) return;
    if (controlledBusy === undefined) setInternalBusy(true);
    const p = flight.current.run(() => Promise.resolve(onPress()));
    // Always clears busy — success or failure — and never setState after unmount.
    p?.finally(() => {
      if (mounted.current && controlledBusy === undefined) setInternalBusy(false);
    });
  }, [onPress, disabled, controlledBusy]);

  return (
    <TouchableOpacity
      testID={testID}
      onPress={handlePress}
      activeOpacity={0.7}
      disabled={busy || disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy, disabled: busy || disabled }}
      onLayout={(e) => {
        // Lock the resting width the first time we measure it, so entering the
        // busy state (spinner + possibly shorter text) doesn't reflow.
        if (lockedWidth === undefined) setLockedWidth(e.nativeEvent.layout.width);
      }}
      style={[
        styles.button,
        (busy || disabled) && styles.disabled,
        lockedWidth ? { minWidth: lockedWidth } : null,
        style,
      ]}
    >
      <View style={styles.content}>
        {busy ? (
          <>
            <ActivityIndicator
              size="small"
              color={spinnerColor}
              style={styles.spinner}
              testID={`${testID}-spinner`}
            />
            <Text style={[styles.label, textStyle]} numberOfLines={1}>
              {busyLabel ?? label}
            </Text>
          </>
        ) : (
          <Text style={[styles.label, textStyle]} numberOfLines={1}>
            {label}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: WELLBUILT_ACCENT,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: { marginRight: 10 },
  label: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});

export default WellBuiltAsyncButton;
