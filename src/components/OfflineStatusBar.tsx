// src/components/OfflineStatusBar.tsx
// Slim offline indicator + sync confirmation for WB Mobile.
// Designed to be non-annoying — just a thin bar, no dismiss button.
// Shows sync confirmation alert when queued packets are sent.

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Alert } from 'react-native';
import {
  isOnlineSync,
  onConnectivityChange,
  onFlushComplete,
  getQueueCount,
  type FlushResult,
} from '../services/packetQueue';

export function OfflineStatusBar() {
  const [offline, setOffline] = useState(!isOnlineSync());
  const [queueCount, setQueueCount] = useState(0);
  const slideAnim = useRef(new Animated.Value(offline ? 0 : -36)).current;

  // Track connectivity
  useEffect(() => {
    const unsub = onConnectivityChange((online) => {
      setOffline(!online);
    });
    return unsub;
  }, []);

  // Update queue count when offline
  useEffect(() => {
    if (offline) {
      const update = async () => setQueueCount(await getQueueCount());
      update();
      const interval = setInterval(update, 5000);
      return () => clearInterval(interval);
    } else {
      setQueueCount(0);
    }
  }, [offline]);

  // Animate
  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: offline ? 0 : -36,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [offline]);

  // Sync confirmation
  useEffect(() => {
    const unsub = onFlushComplete((result: FlushResult) => {
      const wells = result.wellNames.join(', ');
      const lines: string[] = [];
      lines.push(`${result.sent} pull${result.sent > 1 ? 's' : ''} sent`);
      if (wells) lines.push(`Wells: ${wells}`);
      if (result.failed > 0) lines.push(`${result.failed} still pending`);
      Alert.alert('Back Online — Pulls Synced', lines.join('\n'));
    });
    return unsub;
  }, []);

  if (!offline) return null;

  return (
    <Animated.View style={[styles.bar, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.dot} />
      <Text style={styles.text}>
        No Connection{queueCount > 0 ? ` · ${queueCount} pull${queueCount > 1 ? 's' : ''} queued` : ''}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#92400E',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
    zIndex: 999,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FDE68A',
    marginRight: 8,
  },
  text: {
    color: '#FEF3C7',
    fontSize: 12,
    fontWeight: '600',
  },
});
