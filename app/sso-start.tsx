/**
 * Credential-free Suite launch: wellbuiltmobile://sso-start
 * Mints PKCE in WB-M and opens Suite authorize. No hash in any URL.
 */
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as Linking from 'expo-linking';
import { beginWbmPkce } from '../src/services/ssoPkce';

export default function WbmSsoStart() {
  useEffect(() => {
    (async () => {
      const { authorizeUrl } = await beginWbmPkce();
      await Linking.openURL(authorizeUrl);
    })().catch((err) => {
      console.error('[WBM-SSO] start failed', err);
    });
  }, []);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}
