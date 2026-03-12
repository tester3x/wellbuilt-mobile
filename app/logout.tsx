// app/logout.tsx
// Cascade logout handler — receives deep link from WB Suite hub app
// URL: wellbuiltmobile://logout
//
// Flow:
// 1. WB Suite ends shift or logs out → fires wellbuiltmobile://logout
// 2. Expo Router catches /logout route → this screen
// 3. Clear SecureStore session
// 4. Redirect to /driver-login

import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { clearDriverSession } from '../src/services/driverAuth';

export default function LogoutScreen() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      console.log('[SSO] Received logout deep link from WB S — clearing session');
      await clearDriverSession();
      router.replace('/driver-login');
    })();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Signing out...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#05060B',
  },
  text: {
    color: '#9CA3AF',
    fontSize: 16,
    textAlign: 'center',
  },
});
