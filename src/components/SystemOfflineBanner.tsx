// src/components/SystemOfflineBanner.tsx
// Branded "System Offline" banner shown when Firebase is unreachable
// Displayed at top of screen with WellBuilt branding

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useFirebaseStatus } from '../contexts/FirebaseStatusContext';
import { hp, wp, spacing } from '../ui/layout';

interface Props {
  onRetry?: () => void;
}

export function SystemOfflineBanner({ onRetry }: Props) {
  const { isOnline, reason, kind, code, checkNow } = useFirebaseStatus();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const showAuth = kind === 'auth_session' || kind === 'permission';
  if (isOnline && !showAuth) {
    return null;
  }
  if (!isOnline && kind === 'ok') {
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
          <Text style={styles.title}>
            {kind === 'auth_session' ? t('offlineBanner.authTitle')
              : kind === 'permission' ? t('offlineBanner.permissionTitle')
                : kind === 'timeout' ? t('offlineBanner.timeoutTitle')
                  : kind === 'no_network' ? t('offlineBanner.networkTitle')
                    : t('offlineBanner.title')}
          </Text>
          <Text style={styles.message}>
            {kind === 'auth_session' ? t('offlineBanner.authMessage')
              : kind === 'permission' ? t('offlineBanner.permissionMessage')
                : kind === 'timeout' ? t('offlineBanner.timeoutMessage')
                  : kind === 'no_network' ? t('offlineBanner.networkMessage')
                    : (reason || t('offlineBanner.cannotConnect'))}
          </Text>
          <Text style={styles.subMessage}>
            {showAuth ? t('offlineBanner.authHint') : t('offlineBanner.queuedHint')}
            {code ? `  ·  ${code}` : ''}
          </Text>
        </View>
        <TouchableOpacity style={styles.dismissButton} onPress={handleRetry} activeOpacity={0.7}>
          <Text style={styles.dismissText}>{t('offlineBanner.dismiss')}</Text>
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
