/**
 * Retriable verification — never the /no-access denial copy.
 * Shown when eligibility is unknown after a valid (or durable) session.
 */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { authorizeEstablishedSession } from '../src/services/postAuthGate';
import { clearDriverSession, revalidateDriverSessionClassified } from '../src/services/driverAuth';

export default function SessionVerifyScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  const retry = async () => {
    setBusy(true);
    try {
      const revalidation = await revalidateDriverSessionClassified();
      const dest = await authorizeEstablishedSession({
        eligibleDestination: '/welcome',
        revalidation,
      });
      setCode(dest);
      if (dest !== '/session-verify') {
        router.replace(dest);
        return;
      }
    } catch {
      setCode('retry_failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('sessionVerify.title')}</Text>
      <Text style={styles.message}>{t('sessionVerify.message')}</Text>
      {code ? <Text style={styles.code}>{code}</Text> : null}
      <Pressable style={styles.btn} onPress={retry} disabled={busy}>
        <Text style={styles.btnText}>{busy ? t('sessionVerify.working') : t('sessionVerify.retry')}</Text>
      </Pressable>
      <Pressable style={styles.btn} onPress={() => router.push('/settings')} disabled={busy}>
        <Text style={styles.btnText}>{t('common.settings', 'Settings')}</Text>
      </Pressable>
      <Pressable
        style={styles.btn}
        onPress={async () => {
          await clearDriverSession();
          router.replace('/driver-login');
        }}
        disabled={busy}
      >
        <Text style={styles.btnText}>{t('common.logOut', 'Log out')}</Text>
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
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  message: { color: '#9CA3AF', fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 16 },
  code: { color: '#6B7280', fontSize: 12, marginBottom: 24, fontFamily: 'monospace' },
  btn: {
    backgroundColor: '#1F2937',
    borderColor: '#3b82f6',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  btnText: { color: '#93c5fd', fontSize: 16, fontWeight: '600' },
});
