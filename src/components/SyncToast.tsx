// src/components/SyncToast.tsx
// Branded, nonblocking sync feedback (field-test fix): routine events show
// a WB-styled toast — logo mark, dark navy surface, gold/teal/blue accents,
// plain driver wording — that auto-dismisses after ~3 s and never blocks
// the driver. Wording is TRUTHFUL: an accepted upload is "submitted";
// "Delivered" appears only after packets/processed confirms.
//
// Persistent/action-required states (future timestamp, rejections, sync
// failures, blocked edits) deliberately do NOT use this — they stay on the
// blocking AppAlert / Sync Status surfaces with their action buttons.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onReconcileResult } from '../services/deliveryStatus';
import { onFlushComplete } from '../services/packetQueue';

export const SYNC_TOAST_DURATION_MS = 3000;

export type SyncToastTone = 'blue' | 'teal' | 'gold';

export interface SyncToastOpts {
  title: string;
  body: string;
  tone?: SyncToastTone;
}

let _listener: ((o: SyncToastOpts) => void) | null = null;

/** Show a branded, auto-dismissing toast. Safe no-op before the host mounts. */
export function showSyncToast(opts: SyncToastOpts): void {
  _listener?.(opts);
}

const TONE_BORDER: Record<SyncToastTone, string> = {
  blue: '#3b82f6',  // informational (submitted / back online)
  teal: '#14b8a6',  // positive (delivered/confirmed)
  gold: '#eab308',  // saved locally, waiting
};

export function SyncToastHost() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<SyncToastOpts | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    _listener = (o) => setToast(o);

    // Routine event wiring — truthful wording only:
    // a flushed packet reached packets/incoming → "submitted", never "sent".
    const unsubFlush = onFlushComplete((r) => {
      if (r.sent > 0) {
        showSyncToast({
          title: 'Back online',
          body: `${r.sent} pull${r.sent === 1 ? '' : 's'} submitted. Waiting for confirmation.`,
          tone: 'blue',
        });
      }
    });
    // "Delivered" ONLY when packets/processed confirmed the packet(s).
    const unsubReconcile = onReconcileResult((r) => {
      if (r.confirmedSent > 0) {
        showSyncToast({
          title: 'Delivered',
          body: `${r.confirmedSent} pull${r.confirmedSent === 1 ? '' : 's'} confirmed.`,
          tone: 'teal',
        });
      }
    });
    return () => {
      _listener = null;
      unsubFlush();
      unsubReconcile();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    const timer = setTimeout(() => setToast(null), SYNC_TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast, opacity]);

  if (!toast) return null;
  const border = TONE_BORDER[toast.tone ?? 'blue'];

  return (
    <Animated.View
      pointerEvents="none" // nonblocking — the driver keeps working
      style={[styles.wrap, { top: (Number.isFinite(insets.top) ? insets.top : 0) + 10, opacity }]}
    >
      <View style={[styles.card, { borderColor: border }]}>
        <Image source={require('../../assets/images/icon.png')} style={styles.mark} />
        <View style={styles.textWrap}>
          <Text style={[styles.title, { color: border }]}>{toast.title}</Text>
          <Text style={styles.body}>{toast.body}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 1000,
    elevation: 10,
    alignItems: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10131c', // WB dark navy surface
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: 420,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  mark: {
    width: 28,
    height: 28,
    borderRadius: 6,
    marginRight: 10,
  },
  textWrap: { flexShrink: 1 },
  title: { fontSize: 14, fontWeight: '700' },
  body: { color: '#c7cede', fontSize: 13, marginTop: 1 },
});
