import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { isDriverVerified, revalidateDriverSession, clearDriverSession } from '../src/services/driverAuth';

export default function Index() {
  const [checking, setChecking] = useState(true);
  const [isVerified, setIsVerified] = useState(false);

  useEffect(() => {
    const check = async () => {
      // First check if we have a local session
      const hasLocalSession = await isDriverVerified();

      if (hasLocalSession) {
        // IMPORTANT: Revalidate against Firebase to catch revoked access
        // This prevents the issue where SecureStore persists across reinstalls
        // but the driver has been revoked in Firebase
        console.log("[Index] Local session found, revalidating with Firebase...");
        const stillValid = await revalidateDriverSession();

        if (!stillValid) {
          // Session was revoked or no longer valid in Firebase
          console.log("[Index] Session no longer valid in Firebase, clearing local session");
          await clearDriverSession();
          setIsVerified(false);
        } else {
          console.log("[Index] Session revalidated successfully");
          setIsVerified(true);
        }
      } else {
        setIsVerified(false);
      }

      setChecking(false);
    };
    check();
  }, []);

  if (checking) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#05060B' }}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  // If driver is verified, go to welcome screen
  // Otherwise, go to driver login/registration
  return <Redirect href={isVerified ? '/welcome' : '/driver-login'} />;
}
