import AsyncStorage from '@react-native-async-storage/async-storage';
import {getFunctions,httpsCallable} from 'firebase/functions';
import {getFirebaseApp,getFirebaseAuth,waitForAuthUser} from './firebaseAuthSession';
import {createDeviceAccountClient,type DeviceAccountNative} from './deviceAccount.generated';
const native=require('../../modules/wellbuilt-platform') as DeviceAccountNative|null;
export const mobileDeviceAccount=createDeviceAccountClient(native,async(name,data)=>(await httpsCallable(getFunctions(getFirebaseApp(),'us-central1'),name,{timeout:15000})(data)).data);
export async function restoreMobileDeviceAccount(){
 await waitForAuthUser();const {getDriverSession,completeAuthenticatedSession}=await import('./driverAuth');
 const saved=await getDriverSession(),uid=getFirebaseAuth().currentUser?.uid;
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
 await mobileDeviceAccount.publish({uid:user.uid,driverId:claims.driverId,companyId:claims.companyId},()=>getFirebaseAuth().currentUser===user,explicit);
}

export async function revokeMobileDeviceAccount(){const saved=await mobileDeviceAccount.read();if(saved&&getFirebaseAuth().currentUser?.uid===saved.access.owner.uid)await mobileDeviceAccount.revoke(saved.access.owner);}
