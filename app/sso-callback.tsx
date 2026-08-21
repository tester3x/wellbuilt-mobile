/**
 * wellbuiltmobile://sso-callback?code=&state=
 * Exchanges the single-use code with the verifier that never left WB-M.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { takeWbmPkce } from '../src/services/ssoPkce';
import { bootstrapDriverSession, exchangeSsoCode } from '../src/services/secureDriverAuth';
import { saveDriverSession } from '../src/services/driverAuth';

export default function WbmSsoCallback() {
  const params = useLocalSearchParams<{ code?: string; state?: string; error?: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const used = useRef(false);

  useEffect(() => {
    if (used.current) return;
    used.current = true;
    (async () => {
      if (params.error || !params.code || !params.state) {
        setError('sso_denied');
        router.replace('/driver-login');
        return;
      }
      const verifier = await takeWbmPkce(params.state);
      await exchangeSsoCode({ code: params.code, codeVerifier: verifier });
      const profile = await bootstrapDriverSession();
      await saveDriverSession(
        profile.driverId,
        profile.displayName || profile.driverId,
        undefined,
        profile.isAdmin === true,
        profile.isViewer === true,
        profile.companyId,
        profile.companyName || undefined,
        (profile.tier as 'free' | 'field' | 'god' | undefined) || undefined,
        'sso',
        {
          roles: profile.roles,
          assignedRoutes: profile.assignedRoutes,
          assignedCustomers: profile.assignedCustomers,
        },
      );
      router.replace('/(tabs)');
    })().catch((err) => {
      console.error('[WBM-SSO] callback failed', err);
      setError('sso_failed');
      router.replace('/driver-login');
    });
  }, [params.code, params.state, params.error]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
      {error ? <Text>{error}</Text> : null}
    </View>
  );
}
