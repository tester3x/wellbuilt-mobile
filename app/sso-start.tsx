/**
 * Credential-free Suite launch: wellbuiltmobile://sso-start
 * Mints PKCE in WB-M and opens Suite authorize. No hash in any URL.
 */
import { useCallback, useEffect, useState } from 'react';
import { Redirect, router, useFocusEffect, useLocalSearchParams, useRootNavigationState } from 'expo-router';
import {hasEstablishedWbmEntry,refreshEstablishedWbmEntry} from '../src/services/platformEntry';
import {parsePlatformOwnerHint} from '../src/services/platformRuntime.generated';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { beginWbmPkce } from '../src/services/ssoPkce';
import { startMobileEntry } from '../src/services/mobileEntry';

export default function WbmSsoStart() {
  const accountReady=require('../modules/wellbuilt-platform/AccountGate').useAccountReady() as boolean;
  const navigation = useRootNavigationState();
  const params = useLocalSearchParams();
  // Reused app-open screens must react to owner changes and extra/invalid params.
  const requestKey = JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; ready?: boolean; error?: boolean } | null>(null);
  useFocusEffect(useCallback(() => {
    if (!accountReady || !navigation?.key) return;
    setResult(null);
    const hint = parsePlatformOwnerHint(Object.fromEntries(JSON.parse(requestKey)));
    if (!hint.ok) { setResult({ key: requestKey, error: true }); return; }
    return startMobileEntry({
      established: () => hasEstablishedWbmEntry(hint.owner || undefined),
      authorize: beginWbmPkce,
      open: url => Linking.openURL(url),
      ready: () => setResult({ key: requestKey, ready: true }),
      failed: () => setResult({ key: requestKey, error: true }),
    });
  }, [accountReady, navigation?.key, requestKey, attempt]));

  if (result?.key === requestKey && result.ready) return <EstablishedEntry />;
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#05060B' }}>
    {result?.key === requestKey && result.error ? <>
      <Text style={{ color: 'white', textAlign: 'center', marginBottom: 20 }}>Could not finish opening Mobile. Your saved work is preserved.</Text>
      <Pressable onPress={() => setAttempt(value => value + 1)} style={{ padding: 16 }}><Text style={{ color: '#60A5FA' }}>Retry</Text></Pressable>
      <Pressable onPress={() => { void Linking.openURL('wellbuilt-suite://home'); }} style={{ padding: 16 }}><Text style={{ color: '#60A5FA' }}>Back to WB S</Text></Pressable>
    </> : <ActivityIndicator accessibilityLabel="Opening Mobile" color="#60A5FA" />}
  </View>;
}

function EstablishedEntry() {
  useEffect(() => {
    void refreshEstablishedWbmEntry().then(result => { if (result !== 'keep') router.replace(result); });
  }, []);
  // Declarative navigation survives a navigator that is still mounting after an update.
  return <Redirect href="/(tabs)" />;
}
