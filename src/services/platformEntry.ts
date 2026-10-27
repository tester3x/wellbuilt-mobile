import * as SecureStore from 'expo-secure-store';
import {decidePlatformAppEntry,type PlatformOwnerHint} from './platformRuntime.generated';
import {waitForAuthUser,getFirebaseAuth} from './firebaseAuthSession';
import {readFencedDurableEnvelope} from './wellConfig';
import {captureCurrentSessionPermit,performPermittedLogout,revalidateDriverSessionClassified} from './driverAuth';
import {getSessionGeneration} from './wbmSessionFence';
import {authorizeEstablishedSession} from './postAuthGate';
/** Only local SDK/session/bootstrap reads. No token refresh or remote bootstrap. */
export async function hasEstablishedWbmEntry(expected?:PlatformOwnerHint):Promise<boolean>{
 await waitForAuthUser();const user=getFirebaseAuth().currentUser;if(!user)return false;
 const generation=getSessionGeneration();const savedUid=await SecureStore.getItemAsync('wb_auth_uid');
 if(savedUid!==user.uid)return false;
 const env=await readFencedDurableEnvelope();
 if(!env||generation!==getSessionGeneration()||getFirebaseAuth().currentUser!==user)return false;
 return decidePlatformAppEntry({restored:true,sdkUid:user.uid,requestedOwner:expected,
  session:{owner:{uid:savedUid,driverId:env.driverId,companyId:env.companyId},establishedAccess:env.eligibility.status==='eligible'}})==='resume';
}
let refreshing:Promise<'keep'|'/driver-login'|'/no-access'>|null=null;
export function refreshEstablishedWbmEntry():Promise<'keep'|'/driver-login'|'/no-access'>{
 if(refreshing)return refreshing;
 refreshing=(async()=>{
  const permit=await captureCurrentSessionPermit();if(!permit)return 'keep' as const;
  const validation=await revalidateDriverSessionClassified();
  if(permit.generation!==getSessionGeneration())return 'keep' as const;
  if(validation==='revoked')return await performPermittedLogout(permit)?'/driver-login' as const:'keep' as const;
  if(validation!=='valid')return 'keep' as const;
  const route=await authorizeEstablishedSession({eligibleDestination:'/(tabs)',revalidation:validation});
  return permit.generation===getSessionGeneration()&&route==='/no-access'?'/no-access' as const:'keep' as const;
 })().catch(()=>'keep' as const).finally(()=>{refreshing=null;});
 return refreshing;
}
