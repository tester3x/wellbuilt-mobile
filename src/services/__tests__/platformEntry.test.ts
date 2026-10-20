import {hasEstablishedWbmEntry,refreshEstablishedWbmEntry} from '../platformEntry';
import * as SecureStore from 'expo-secure-store';
import {getFirebaseAuth} from '../firebaseAuthSession';
import {readFencedDurableEnvelope} from '../wellConfig';
import {getSessionGeneration} from '../wbmSessionFence';
import {revalidateDriverSessionClassified,performPermittedLogout} from '../driverAuth';
jest.mock('expo-secure-store',()=>({getItemAsync:jest.fn(async()=> 'uid-a')}));
const user={uid:'uid-a',getIdToken:jest.fn(()=>{throw Error('No foreground network allowed');})};
jest.mock('../firebaseAuthSession',()=>({waitForAuthUser:jest.fn(async()=>{}),getFirebaseAuth:jest.fn(()=>({currentUser:user}))}));
jest.mock('../wellConfig',()=>({readFencedDurableEnvelope:jest.fn(async()=>({driverId:'driver-a',companyId:'company-a',eligibility:{status:'eligible'}}))}));
jest.mock('../wbmSessionFence',()=>({getSessionGeneration:jest.fn(()=>1)}));
jest.mock('../driverAuth',()=>({captureCurrentSessionPermit:jest.fn(async()=>({generation:1,driverId:'driver-a',companyId:'company-a',authUid:'uid-a'})),performPermittedLogout:jest.fn(async()=>true),revalidateDriverSessionClassified:jest.fn(async()=> 'unknown')}));
jest.mock('../postAuthGate',()=>({authorizeEstablishedSession:jest.fn(async()=> '/(tabs)')}));
beforeEach(()=>{jest.clearAllMocks();(getSessionGeneration as jest.Mock).mockReturnValue(1);(getFirebaseAuth as jest.Mock).mockReturnValue({currentUser:user});(SecureStore.getItemAsync as jest.Mock).mockResolvedValue('uid-a');(readFencedDurableEnvelope as jest.Mock).mockResolvedValue({driverId:'driver-a',companyId:'company-a',eligibility:{status:'eligible'}});});
test('matching cached access resumes without token acquisition or remote verification',async()=>{
 expect(await hasEstablishedWbmEntry()).toBe(true);expect(user.getIdToken).not.toHaveBeenCalled();expect(revalidateDriverSessionClassified).not.toHaveBeenCalled();
});
test('another account, missing SDK and denied cached eligibility cannot resume',async()=>{
 expect(await hasEstablishedWbmEntry({driverId:'other',companyId:'company-a'})).toBe(false);
 (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('different-uid');expect(await hasEstablishedWbmEntry()).toBe(false);
 (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('uid-a');(readFencedDurableEnvelope as jest.Mock).mockResolvedValue({driverId:'driver-a',companyId:'company-a',eligibility:{status:'ineligible'}});expect(await hasEstablishedWbmEntry()).toBe(false);
 (getFirebaseAuth as jest.Mock).mockReturnValue({currentUser:null});expect(await hasEstablishedWbmEntry()).toBe(false);
});
test('a session replacement during local reads cannot publish the old entry',async()=>{
 (readFencedDurableEnvelope as jest.Mock).mockImplementationOnce(async()=>{(getSessionGeneration as jest.Mock).mockReturnValue(2);return {driverId:'driver-a',companyId:'company-a',eligibility:{status:'eligible'}};});
 expect(await hasEstablishedWbmEntry()).toBe(false);
});
test('inconclusive background check preserves access; confirmed revocation uses bound logout',async()=>{
 expect(await refreshEstablishedWbmEntry()).toBe('keep');expect(performPermittedLogout).not.toHaveBeenCalled();
 (revalidateDriverSessionClassified as jest.Mock).mockResolvedValueOnce('revoked');expect(await refreshEstablishedWbmEntry()).toBe('/driver-login');expect(performPermittedLogout).toHaveBeenCalledWith(expect.objectContaining({authUid:'uid-a',generation:1}));
});
