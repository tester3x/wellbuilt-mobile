import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import {
  isDriverVerified,
  revalidateDriverSessionClassified,
  clearDriverSession,
  getDriverSession,
} from '../src/services/driverAuth';
import { resolveCurrentEligibility } from '../src/services/wellConfig';
import { decideBootstrapRoute, type BootstrapRoute } from '../src/services/eligibility';
import { notifyAuthenticated } from '../src/services/deliveryStatus';

export default function Index() {
  const [checking, setChecking] = useState(true);
  const [dest, setDest] = useState<BootstrapRoute>('/driver-login');

  useEffect(() => {
    const check = async () => {
      const hasLocalSession = await isDriverVerified();
      if (!hasLocalSession) {
        setDest('/driver-login');
        setChecking(false);
        return;
      }

      const revalidation = await revalidateDriverSessionClassified();
      if (revalidation === 'revoked') {
        await clearDriverSession();
        setDest('/driver-login');
        setChecking(false);
        return;
      }

      const session = await getDriverSession();
      const eligibility = await resolveCurrentEligibility();
      const route = decideBootstrapRoute({
        hasLocalSession: true,
        revalidation,
        eligibility: eligibility.status,
      });
      if (route === '/welcome' || route === '/session-verify') {
        notifyAuthenticated();
      }
      void session;
      setDest(route);
      setChecking(false);
    };
    check().catch((err) => {
      console.log('[Index] bootstrap failed (keeping session if any):', err);
      setDest('/session-verify');
      setChecking(false);
    });
  }, []);

  if (checking) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#05060B' }}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return <Redirect href={dest} />;
}
