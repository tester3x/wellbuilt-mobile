import AsyncStorage from '@react-native-async-storage/async-storage';
import {getFunctions,httpsCallable} from 'firebase/functions';
import {getFirebaseApp,getFirebaseAuth,waitForAuthUser} from './firebaseAuthSession';
import {createDeviceAccountClient,type DeviceAccountNative} from './deviceAccount.generated';
const native=require('../../modules/wellbuilt-platform') as DeviceAccountNative|null;
// A cold shared-login function exceeded 18s in the field. The old 15s
// deadline discarded a successful server grant before it reached the device.
export const mobileDeviceAccount=createDeviceAccountClient(native,async(name,data)=>(await httpsCallable(getFunctions(getFirebaseApp(),'us-central1'),name,{timeout:60000})(data)).data);
export async function restoreMobileDeviceAccount(){
 await waitForAuthUser();const capturedUser=getFirebaseAuth().currentUser;const {getDriverSession,completeAuthenticatedSession}=await import('./driverAuth');
 const saved=await getDriverSession(),uid=getFirebaseAuth().currentUser?.uid;
 if(getFirebaseAuth().currentUser!==capturedUser)throw Object.assign(Error('Account changed during local restore.'),{code:'platform/superseded'});
 return mobileDeviceAccount.restore('mobile',uid&&saved?.companyId?{uid,driverId:saved.driverId,companyId:saved.companyId}:null,async reply=>{
  if(saved && (saved.driverId!==reply.access.owner.driverId||saved.companyId!==reply.access.owner.companyId)){
    for(const key of ['@wellbuilt_packet_queue','@wellbuilt_edit_ops','@wellbuilt_submitted_payloads']){
      const pending=JSON.parse(await AsyncStorage.getItem(key)||'null');
      if(pending && (Array.isArray(pending)?pending.length:Object.keys(pending).length))throw Object.assign(Error('Mobile has saved work belonging to its previous account. Finish sending that work in the original account before changing this app.'),{code:'platform/account-switch-pending'});
    }
  }
  await completeAuthenticatedSession({customToken:reply.customToken,driverId:reply.access.owner.driverId,displayName:reply.access.profile.displayName||'Driver',companyId:reply.access.owner.companyId,authMethod:'sso'});
 });
}
export async function publishMobileDeviceAccount(explicit=false){
 const user=getFirebaseAuth().currentUser;if(!user)return;
 const {claims}=await user.getIdTokenResult(false);if(claims.kind!=='driver'||typeof claims.driverId!=='string'||typeof claims.companyId!=='string')return;
 const local=await import('./driverAuth').then(m=>m.getDriverSession());if(local?.driverId!==claims.driverId||local?.companyId!==claims.companyId)return;
 const isCurrent=()=>getFirebaseAuth().currentUser===user;
 const {publishWithRecovery}=require('../../modules/wellbuilt-platform/accountPublication');
 await publishWithRecovery({explicit,isCurrent,
  publish:()=>mobileDeviceAccount.publish({uid:user.uid,driverId:claims.driverId as string,companyId:claims.companyId as string},isCurrent,explicit),
  report:(detail:unknown)=>console.info('WB_ACCOUNT_PUBLICATION '+JSON.stringify(detail))});
}

export async function revokeMobileDeviceAccount(){const saved=await mobileDeviceAccount.read();if(saved&&getFirebaseAuth().currentUser?.uid===saved.access.owner.uid)await mobileDeviceAccount.revoke(saved.access.owner);}
