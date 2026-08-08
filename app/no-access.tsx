// app/no-access.tsx
// Shown when a driver without real routes tries to use WB M.
// Unrouted drivers use WB T + dispatch — they don't self-manage routes.

import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { clearDriverSession } from '../src/services/driverAuth';

export default function NoAccessScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  const handleLogout = async () => {
    await clearDriverSession();
    router.replace('/driver-login');
  };

  return (
    <View style={styles.container}>
      <MaterialCommunityIcons name="shield-lock-outline" size={64} color="#4B5563" />
      <Text style={styles.title}>{t('noAccess.title')}</Text>
      <Text style={styles.message}>{t('noAccess.message')}</Text>
      <Text style={styles.subMessage}>{t('noAccess.subMessage')}</Text>
      <Pressable style={styles.logoutButton} onPress={handleLogout}>
        <MaterialCommunityIcons name="logout" size={18} color="#FCA5A5" />
        <Text style={styles.logoutText}>{t('noAccess.logOut')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#05060B',
    paddingHorizontal: 40,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 24,
    marginBottom: 12,
  },
  message: {
    color: '#9CA3AF',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 8,
  },
  subMessage: {
    color: '#6B7280',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 40,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#1F2937',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  logoutText: {
    color: '#FCA5A5',
    fontSize: 15,
    fontWeight: '600',
  },
});
