// src/components/SyncAttentionBadge.tsx
// Persistent floating badge: unsent/attention packet visibility (GS3).
// Shows whenever anything is pending, transport-failed, stuck in
// submitted, or server-rejected. Tapping opens the Sync Status screen.
// Evidence is never hidden until the underlying state is resolved.

import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DeliveryCounts, getDeliveryCounts } from '../services/deliveryStatus';
import { onFlushComplete } from '../services/packetQueue';
import { badgeRightOffset, badgeTopOffset } from '../ui/safeAreaBadge';

const POLL_MS = 30 * 1000;

export function SyncAttentionBadge() {
  const router = useRouter();
  // Safe-area placement from the app's EXISTING provider (expo-router's
  // root supplies initial window metrics, so insets resolve synchronously
  // — no layout jump on first render). Clears the status bar/notch/
  // Dynamic Island on Fold cover+main, S24, tablets, and iPhones, in
  // portrait and landscape.
  const insets = useSafeAreaInsets();
  const [counts, setCounts] = useState<DeliveryCounts | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCounts(await getDeliveryCounts());
    } catch {
      // storage hiccup — keep the last known counts
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsub = onFlushComplete(() => { refresh(); });
    const timer = setInterval(refresh, POLL_MS);
    return () => { unsub(); clearInterval(timer); };
  }, [refresh]);

  if (!counts || (counts.pending === 0 && counts.attention === 0)) return null;

  const urgent = counts.attention > 0;
  const label = urgent
    ? `⚠ ${counts.attention} need${counts.attention === 1 ? 's' : ''} attention`
    : `${counts.pending} unsent pull${counts.pending === 1 ? '' : 's'}`;

  return (
    <TouchableOpacity
      style={[
        styles.badge,
        urgent ? styles.badgeUrgent : styles.badgePending,
        { top: badgeTopOffset(insets.top), right: badgeRightOffset(insets.right) },
      ]}
      onPress={() => router.push('/sync-status')}
      accessibilityRole="button"
      accessibilityLabel="Open sync status"
    >
      <Text style={styles.text}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    // top/right come from safe-area insets at render time (see above) —
    // never fixed offsets that collide with status bars or notches.
    zIndex: 999,
    elevation: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 32, // preserve a comfortable tap target on dense screens
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
  },
  badgePending: {
    backgroundColor: '#1c2a3a',
    borderColor: '#3b82f6',
  },
  badgeUrgent: {
    backgroundColor: '#3a1c1c',
    borderColor: '#ef4444',
  },
  text: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
});
