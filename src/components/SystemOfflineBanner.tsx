// src/components/SystemOfflineBanner.tsx
// Branded "System Offline" banner shown when Firebase is unreachable
// Displayed at top of screen with WellBuilt branding

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFirebaseStatus } from '../contexts/FirebaseStatusContext';
import { hp, wp, spacing } from '../ui/layout';

interface Props {
  onRetry?: () => void;
}

export function SystemOfflineBanner({ onRetry }: Props) {
  const { isOnline, reason, checkNow } = useFirebaseStatus();
  const insets = useSafeAreaInsets();

  if (isOnline) {
    return null;
  }

  const handleRetry = async () => {
    const result = await checkNow();
    if (result && onRetry) {
      onRetry();
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.xs }]}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>⚠</Text>
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title}>WellBuilt System Offline</Text>
          <Text style={styles.message}>
            {reason || 'Cannot connect to server'}
          </Text>
          <Text style={styles.subMessage}>
            Pulls will be saved locally and submitted when connection is restored
          </Text>
        </View>
        <TouchableOpacity style={styles.dismissButton} onPress={handleRetry} activeOpacity={0.7}>
          <Text style={styles.dismissText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#92400E', // Amber/warning color matching WellBuilt brand
    paddingBottom: spacing.sm,
    paddingHorizontal: wp('4%'),
    borderBottomWidth: 2,
    borderBottomColor: '#78350F',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  icon: {
    fontSize: 20,
    color: '#92400E',
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: hp('1.8%'),
    fontWeight: '700',
    color: '#FEF3C7',
  },
  message: {
    fontSize: hp('1.4%'),
    color: '#FDE68A',
    marginTop: 2,
  },
  subMessage: {
    fontSize: hp('1.2%'),
    color: '#FCD34D',
    marginTop: 2,
    opacity: 0.9,
  },
  dismissButton: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: hp('0.8%'),
    marginLeft: spacing.sm,
  },
  dismissText: {
    fontSize: hp('1.4%'),
    fontWeight: '600',
    color: '#92400E',
  },
});
