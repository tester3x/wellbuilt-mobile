import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as NavigationBar from 'expo-navigation-bar';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useState } from 'react';
import { AppState, Platform, StatusBar, View, StyleSheet } from 'react-native';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n';
import { DispatchProvider } from '../src/contexts/DispatchContext';
import { DispatchButton } from '../src/components/DispatchButton';
// REMOVED: FirebaseStatusProvider + SystemOfflineBanner
// The offline banner was more annoying than useful — triggered 20+ times/day in dead zones.
// No other app does this. The underlying firebaseStatus service is kept for packetQueue
// (it still needs to know if Firebase is reachable to decide upload vs queue).
import { WhatsNewModal } from '../components/WhatsNewModal';
import { useWhatsNew } from '../hooks/use-whats-new';
import { SyncConfirmation } from '../src/components/OfflineStatusBar';
import { cleanupStalePendingPulls, clearDeprecatedFlowRateCache } from '../src/services/wellHistory';
import { startNetworkMonitor, flushQueue } from '../src/services/packetQueue';
import { clearDriverSession } from '../src/services/driverAuth';

const FIREBASE_DB = 'https://wellbuilt-sync-default-rtdb.firebaseio.com';

/**
 * Check if WB S wrote a logoutAt signal to RTDB that's newer than our session.
 * Returns true if the driver should be auto-logged out.
 * Only applies to SSO sessions — manual logins are owned by the driver, not WB S.
 */
async function checkRtdbLogoutSignal(): Promise<boolean> {
  try {
    // Only SSO sessions respond to WB S cascade logout
    const authMethod = await SecureStore.getItemAsync('authMethod');
    if (authMethod !== 'sso') return false;

    const hash = await SecureStore.getItemAsync('passcodeHash');
    const verifiedAt = await SecureStore.getItemAsync('driverVerifiedAt');
    if (!hash || !verifiedAt) return false;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(`${FIREBASE_DB}/drivers/approved/${hash}/logoutAt.json`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return false;

    const logoutAt = await resp.json();
    if (!logoutAt) return false;

    const logoutTime = new Date(logoutAt).getTime();
    const sessionTime = parseInt(verifiedAt, 10);
    return logoutTime > sessionTime;
  } catch {
    return false;
  }
}

// Lazy import to avoid expo-notifications warning in Expo Go
// Notifications only work in development builds anyway
const initializeWellAlertsLazy = async () => {
  try {
    const { initializeWellAlerts } = await import('../src/services/wellAlerts');
    await initializeWellAlerts();
  } catch (e) {
    console.log('[RootLayout] Well alerts not available in Expo Go');
  }
};

// Keep splash visible while app loads
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  const { showWhatsNew, changelog, dismissWhatsNew } = useWhatsNew();

  useEffect(() => {
    // Full-screen immersive mode — hide Android navigation bar
    const hideNavBar = () => {
      if (Platform.OS === 'android') {
        NavigationBar.setVisibilityAsync('hidden');
        NavigationBar.setBehaviorAsync('overlay-swipe');
        NavigationBar.setBackgroundColorAsync('#00000000');
        StatusBar.setHidden(true);
        StatusBar.setTranslucent(true);
      }
    };
    hideNavBar();
    // Re-hide nav bar when app returns to foreground (deep links from WB S can re-show it)
    // Also check for RTDB logoutAt signal from WB S (silent cascade logout)
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        hideNavBar();
        checkRtdbLogoutSignal().then((shouldLogout) => {
          if (shouldLogout) {
            console.log('[WBM] RTDB logoutAt signal detected — auto-logging out');
            clearDriverSession().then(() => {
              router.replace('/driver-login');
            });
          }
        }).catch(() => {});
      }
    });

    async function prepare() {
      try {
        // Run cleanup operations BEFORE showing UI to prevent AsyncStorage race conditions
        // These MUST complete before initSync starts writing to the same AsyncStorage keys
        await cleanupStalePendingPulls();
        await clearDeprecatedFlowRateCache();

        // REMOVED: clearAllLevelSnapshots() — was a one-time fix for build 46 (Jan 28)
        // that ran on EVERY startup. Racing with saveLevelSnapshot() in backgroundSync
        // caused AsyncStorage corruption → empty well list ("1 of 0" bug).
        // All users are past build 46 now, so this is no longer needed.

        // Brief pause for smooth transition
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (e) {
        console.warn('[RootLayout] Error during initialization:', e);
      } finally {
        setAppIsReady(true);
        SplashScreen.hideAsync();
      }
    }

    prepare();

    // These are safe to fire-and-forget — they don't write to keys that conflict with sync
    // Initialize well alerts in background (don't block app load)
    initializeWellAlertsLazy();

    // Start network monitor for offline packet queue
    // Will auto-flush queued packets when network is restored
    startNetworkMonitor();

    // Flush any packets that were queued while app was closed
    flushQueue();
    return () => appStateSub.remove();
  }, []);

  // IMPORTANT: Always render the Stack — even during loading.
  // Returning null here kills Expo Router deep link matching
  // because the navigation tree isn't mounted when the deep link arrives.
  // The splash screen stays visible via SplashScreen.preventAutoHideAsync()
  // until prepare() finishes and calls hideAsync().

  return (
    <I18nextProvider i18n={i18n}>
      <DispatchProvider>
        <View style={styles.container}>
          <SyncConfirmation />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#05060B' },
              animation: 'none',
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="logout" />
            <Stack.Screen name="driver-login" />
            <Stack.Screen name="welcome" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="record" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="summary" />
            <Stack.Screen name="about" />
            <Stack.Screen name="manager" />
            <Stack.Screen name="no-access" />
          </Stack>
          {/* Global dispatch button - appears when there are pending sends */}
          {appIsReady && <DispatchButton />}
          {/* What's New modal - shows after app update */}
          {appIsReady && (
            <WhatsNewModal
              visible={showWhatsNew}
              changelog={changelog}
              onDismiss={dismissWhatsNew}
            />
          )}
        </View>
      </DispatchProvider>
    </I18nextProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05060B',
  },
});
