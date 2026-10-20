/**
 * Credential-free Suite launch: wellbuiltmobile://sso-start
 * Mints PKCE in WB-M and opens Suite authorize. No hash in any URL.
 */
import { useEffect,useRef,useState } from 'react';
import {router,useLocalSearchParams} from 'expo-router';
import {hasEstablishedWbmEntry,refreshEstablishedWbmEntry} from '../src/services/platformEntry';
import {parsePlatformOwnerHint} from '../src/services/platformRuntime.generated';
import { ActivityIndicator, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { beginWbmPkce } from '../src/services/ssoPkce';

export default function WbmSsoStart() {
  const params=useLocalSearchParams();const ran=useRef(false);const [error,setError]=useState(false);
  useEffect(() => {
    if(ran.current)return;ran.current=true;
    (async () => {
      await import('../src/services/deviceAccount').then(m=>m.restoreMobileDeviceAccount());
      const hint=parsePlatformOwnerHint(params);
      if(!hint.ok){setError(true);return;}
      if(await hasEstablishedWbmEntry(hint.owner||undefined)){
        router.replace('/(tabs)');
        void refreshEstablishedWbmEntry().then(result=>{if(result!=='keep')router.replace(result);});
        return;
      }
      const { authorizeUrl } = await beginWbmPkce();
      await Linking.openURL(authorizeUrl);
    })().catch((err) => {
      console.info('[WBM-SSO] entry unavailable');setError(true);
    });
  }, []);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      {error?<Text>Could not establish Mobile access. Your saved work is preserved. Return to Suite and retry.</Text>:<ActivityIndicator />}
    </View>
  );
}
