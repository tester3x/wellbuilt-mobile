import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { isDriverVerified, revalidateDriverSession, clearDriverSession, getDriverSession } from '../src/services/driverAuth';
import { fetchDriverRouteAssignment, driverHasRealRoutes } from '../src/services/wellConfig';
import { checkShiftOnResume } from '../src/services/shiftTracking';

export default function Index() {
  const [checking, setChecking] = useState(true);
  const [isVerified, setIsVerified] = useState(false);
  const [blockedNoRoutes, setBlockedNoRoutes] = useState(false);

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

          // Ensure today's shift is tracked + close stale shifts (fire-and-forget)
          const session0 = await getDriverSession();
          if (session0) {
            checkShiftOnResume(session0.driverId, session0.displayName, session0.companyId).catch(() => {});
          }

          // Route-based access gate: unrouted drivers can't use WB M
          const session = await getDriverSession();
          if (session?.companyId) {
            try {
              const { routes } = await fetchDriverRouteAssignment();
              if (!driverHasRealRoutes(routes)) {
                console.log("[Index] Driver has no real routes — blocking WB M access");
                setBlockedNoRoutes(true);
                setChecking(false);
                return;
              }
            } catch (err) {
              // Network error — allow access (offline-friendly)
              console.log("[Index] Route check failed, allowing access:", err);
            }
          }
          // WB admin (no companyId) always gets through
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

  if (blockedNoRoutes) {
    return <Redirect href="/no-access" />;
  }

  // If driver is verified, go to welcome screen
  // Otherwise, go to driver login/registration
  return <Redirect href={isVerified ? '/welcome' : '/driver-login'} />;
}
