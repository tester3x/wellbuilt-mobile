// Hash-bearing wellbuiltmobile://login?hash=… is rejected.
// Suite launches wellbuiltmobile://sso-start (PKCE). This route only
// forwards there so old bookmarks cannot re-enable hash login.
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

export default function SSOLoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ hash?: string }>();

  useEffect(() => {
    if (params.hash) {
      console.error('[SSO] refused hash-bearing login URL');
    }
    router.replace('/sso-start');
  }, [params.hash]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#2563EB" />
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
});
