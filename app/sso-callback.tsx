/**
 * wellbuiltmobile://sso-callback?code=&state=
 * Exchanges the single-use code with the verifier that never left WB-M.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { takeWbmPkce } from '../src/services/ssoPkce';
import { exchangeSsoCode } from '../src/services/secureDriverAuth';
import { completeAuthenticatedSession, setPersistedMustChangePasscode } from '../src/services/driverAuth';
import { readMustChangePasscodeClaim } from '../src/services/firebaseAuthSession';
import { authorizeEstablishedSession } from '../src/services/postAuthGate';
import { decideForcedChangeFromClaim } from '../src/services/authFlowState';

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
      const exchanged = await exchangeSsoCode({ code: params.code, codeVerifier: verifier });
      await completeAuthenticatedSession({
        customToken: exchanged.customToken,
        driverId: exchanged.driverId,
        displayName: exchanged.displayName || exchanged.driverId,
        companyId: exchanged.companyId,
        authMethod: 'sso',
        // Intentionally omitted: the SSO exchange payload is NOT authoritative
        // for forced-change. We read the minted token claim below instead of
        // inventing a value.
      });

      // Authoritative source: the driver's ID-token claim on the just-minted
      // SSO session. Never assume SSO cannot carry a forced change.
      const claim = await readMustChangePasscodeClaim(/* forceRefresh */ true);
      const decision = decideForcedChangeFromClaim(claim);
      if (decision.persist !== null) {
        await setPersistedMustChangePasscode(decision.persist);
      }
      if (decision.route === 'verify') {
        // Missing/malformed/stale claim → authenticated verification, never a
        // silent continue into the app.
        router.replace('/session-verify');
        return;
      }
      const dest = await authorizeEstablishedSession({
        eligibleDestination: '/(tabs)',
        revalidation: 'valid',
        mustChangePasscode: decision.route === 'passcode-change',
      });
      router.replace(dest);
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
