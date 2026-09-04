/**
 * WellBuiltBusyOverlay — canonical BLOCKING busy state (V1).
 *
 * Contract (see BUSY-STATE-CONTRACT.md):
 *  - Controlled by `visible`. The consumer flips it true on submit, false when
 *    the operation settles (success OR failure OR cancel OR unmount).
 *  - Does NOT render immediately: waits `delayMs` (~200ms) so fast operations
 *    never flash a full-screen overlay. No artificial MINIMUM display time.
 *  - Once shown: dims the underlying form and shows a centered large
 *    ActivityIndicator with a stable localized label beneath it.
 *  - After `longRunningMs` (~5s) of continuous display, swaps to `longLabel`
 *    ("Still saving…"). The punctuation is never animated.
 *  - Announces the operation ONCE to screen readers (not the changing label).
 *  - All timers are cleared on hide and on unmount — no stuck overlay.
 *
 * Uses the WellBuilt action accent (#2563EB) and RN's built-in ActivityIndicator.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { busyLabelFor } from './busyDisplay';

export const WELLBUILT_ACCENT = '#2563EB';
export const BUSY_DELAY_MS = 200;
export const BUSY_LONG_MS = 5000;

export interface WellBuiltBusyOverlayProps {
  /** Busy state. The overlay decides (via delayMs) when to actually paint. */
  visible: boolean;
  /** Stable localized action text, e.g. "Sending pull…". */
  label: string;
  /** Localized long-running label shown after longRunningMs, e.g. "Still sending…". */
  longLabel?: string;
  /** Delay before the overlay paints (anti-flash). Default ~200ms. */
  delayMs?: number;
  /** Continuous-display time before switching to longLabel. Default ~5s. */
  longRunningMs?: number;
  /** Spinner size. Blocking overlays default to large. */
  size?: 'large' | 'small';
  /** Screen-reader label; defaults to `label`. Announced ONCE when shown. */
  accessibilityLabel?: string;
  testID?: string;
}

export function WellBuiltBusyOverlay({
  visible,
  label,
  longLabel,
  delayMs = BUSY_DELAY_MS,
  longRunningMs = BUSY_LONG_MS,
  size = 'large',
  accessibilityLabel,
  testID = 'wb-busy-overlay',
}: WellBuiltBusyOverlayProps) {
  const [shown, setShown] = useState(false);
  const [long, setLong] = useState(false);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announced = useRef(false);

  useEffect(() => {
    const clear = () => {
      if (showTimer.current) {
        clearTimeout(showTimer.current);
        showTimer.current = null;
      }
      if (longTimer.current) {
        clearTimeout(longTimer.current);
        longTimer.current = null;
      }
    };

    if (visible) {
      // Arm the anti-flash delay. Only paint if still busy when it fires.
      showTimer.current = setTimeout(() => {
        setShown(true);
        longTimer.current = setTimeout(() => setLong(true), longRunningMs);
      }, delayMs);
    } else {
      // Settle immediately — no minimum display time.
      clear();
      setShown(false);
      setLong(false);
      announced.current = false;
    }

    return clear;
  }, [visible, delayMs, longRunningMs]);

  // Announce exactly once, when the overlay first paints.
  useEffect(() => {
    if (shown && !announced.current) {
      announced.current = true;
      try {
        AccessibilityInfo.announceForAccessibility(accessibilityLabel ?? label);
      } catch {
        // no-op: accessibility announce is best-effort
      }
    }
  }, [shown, label, accessibilityLabel]);

  if (!shown) return null;

  const shownLabel = busyLabelFor(long ? 'shownLong' : 'shown', label, longLabel);

  return (
    <View
      style={styles.overlay}
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: true }}
      // Live region announces the (stable) label, not per-frame spinner changes.
      accessibilityLiveRegion="polite"
      pointerEvents="auto"
    >
      <View style={styles.card}>
        <ActivityIndicator size={size} color={WELLBUILT_ACCENT} />
        <Text style={styles.label} testID={`${testID}-label`}>
          {shownLabel}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 6, 11, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  card: {
    minWidth: 160,
    paddingVertical: 24,
    paddingHorizontal: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(16, 19, 28, 0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 14,
    color: '#E5E9F0',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default WellBuiltBusyOverlay;
