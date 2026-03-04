// app/login.tsx
// SSO deep link handler — receives hash + name from WB Suite hub app
// URL: wellbuiltmobile://login?hash={passcodeHash}&name={displayName}
//
// Flow:
// 1. WB Suite taps "WB Mobile" → launches deep link with SSO params
// 2. Expo Router catches /login route → this screen
// 3. Validate hash against Firebase drivers/approved/{hash}
// 4. Save session → redirect to /welcome
// 5. On failure → redirect to /driver-login (manual login)

import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  saveDriverSession,
} from '../src/services/driverAuth';
import { driverHasRealRoutes } from '../src/services/wellConfig';

const FIREBASE_DATABASE_URL = 'https://wellbuilt-sync-default-rtdb.firebaseio.com';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';

export default function SSOLoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ hash?: string; name?: string; companyId?: string }>();
  const [status, setStatus] = useState<'validating' | 'error'>('validating');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    handleSSO();
  }, []);

  const handleSSO = async () => {
    const { hash, name, companyId } = params;

    // Validate we got the required params
    if (!hash || !name) {
      console.log('[SSO] Missing params — hash:', !!hash, 'name:', !!name);
      // No SSO params — just go to normal login
      router.replace('/driver-login');
      return;
    }

    console.log('[SSO] Validating SSO for:', name, 'hash:', hash.slice(0, 8) + '...');

    try {
      // Validate hash against Firebase
      const url = `${FIREBASE_DATABASE_URL}/drivers/approved/${hash}.json?auth=${FIREBASE_API_KEY}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Firebase GET failed (${response.status})`);
      }

      const driverData = await response.json();

      if (!driverData) {
        console.log('[SSO] Hash not found in approved drivers');
        setStatus('error');
        setErrorMsg('Driver not found. Please sign in manually.');
        setTimeout(() => router.replace('/driver-login'), 2000);
        return;
      }

      // Verify the driver is active
      // New flat structure: check displayName at root
      if (driverData.displayName) {
        if (driverData.active === false) {
          console.log('[SSO] Driver is deactivated');
          setStatus('error');
          setErrorMsg('Account deactivated. Contact your administrator.');
          setTimeout(() => router.replace('/driver-login'), 2000);
          return;
        }

        // Name check (case-insensitive)
        if (driverData.displayName.toLowerCase() !== name.toLowerCase()) {
          console.log('[SSO] Name mismatch:', driverData.displayName, 'vs', name);
          setStatus('error');
          setErrorMsg('Name mismatch. Please sign in manually.');
          setTimeout(() => router.replace('/driver-login'), 2000);
          return;
        }

        // SSO validated — save session and go
        console.log('[SSO] Validated! Saving session for:', driverData.displayName);
        await saveDriverSession(
          hash,
          driverData.displayName,
          hash,
          driverData.isAdmin === true,
          driverData.isViewer === true,
          driverData.companyId,
          driverData.companyName,
          driverData.tier,
        );

        // Route-based gate: unrouted drivers can't use WB M
        if (driverData.companyId) {
          const routes = Array.isArray(driverData.assignedRoutes) ? driverData.assignedRoutes : undefined;
          if (!driverHasRealRoutes(routes)) {
            console.log('[SSO] Driver has no real routes — redirecting to no-access');
            router.replace('/no-access');
            return;
          }
        }

        router.replace('/welcome');
        return;
      }

      // Legacy nested structure: search for matching name under deviceId keys
      for (const key of Object.keys(driverData)) {
        const entry = driverData[key];
        if (
          entry.displayName?.toLowerCase() === name.toLowerCase() &&
          entry.active !== false
        ) {
          console.log('[SSO] Validated (legacy) for:', entry.displayName);
          await saveDriverSession(
            hash,
            entry.displayName,
            hash,
            entry.isAdmin === true,
            entry.isViewer === true,
            entry.companyId,
            entry.companyName,
            entry.tier,
          );

          // Route-based gate for legacy drivers too
          if (entry.companyId) {
            const routes = Array.isArray(entry.assignedRoutes) ? entry.assignedRoutes : undefined;
            if (!driverHasRealRoutes(routes)) {
              router.replace('/no-access');
              return;
            }
          }

          router.replace('/welcome');
          return;
        }
      }

      // Name not found in any format
      console.log('[SSO] Name not matched in driver data');
      setStatus('error');
      setErrorMsg('Could not verify identity. Please sign in manually.');
      setTimeout(() => router.replace('/driver-login'), 2000);

    } catch (error: any) {
      console.error('[SSO] Validation error:', error);

      if (error.name === 'AbortError') {
        setStatus('error');
        setErrorMsg('Connection timed out. Please sign in manually.');
      } else {
        setStatus('error');
        setErrorMsg('Connection error. Please sign in manually.');
      }

      setTimeout(() => router.replace('/driver-login'), 2000);
    }
  };

  return (
    <View style={styles.container}>
      {status === 'validating' && (
        <>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.text}>Signing in from WellBuilt Suite...</Text>
        </>
      )}
      {status === 'error' && (
        <>
          <Text style={styles.errorText}>{errorMsg}</Text>
          <Text style={styles.subText}>Redirecting to login...</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#05060B',
    paddingHorizontal: 32,
  },
  text: {
    color: '#9CA3AF',
    fontSize: 16,
    marginTop: 20,
    textAlign: 'center',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  },
  subText: {
    color: '#6B7280',
    fontSize: 14,
    textAlign: 'center',
  },
});
