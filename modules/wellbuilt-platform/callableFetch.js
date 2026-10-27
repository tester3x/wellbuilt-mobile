/** The RN WHATWG fallback completes XHR responses via setTimeout(0), which can
 * pause with the display off. Expo's native fetch completes without that hop.
 * Keep Firebase's SDK, auth headers, body and response validation unchanged. */
exports.createCallableFetch=(original,nativeFetch)=>function(input,init){
 let useNative=false;
 if(typeof input==='string'&&init?.method?.toUpperCase()==='POST'&&typeof init.body==='string'){
  try{
   const url=new URL(input);
   useNative=url.protocol==='https:'&&(url.hostname.endsWith('.cloudfunctions.net')||
    ['identitytoolkit.googleapis.com','securetoken.googleapis.com','firebaseappcheck.googleapis.com'].includes(url.hostname));
  }catch{}
 }
 return useNative?nativeFetch(input,init):original(input,init);
};
const marker=Symbol.for('wellbuilt.nativeCallableFetch.v1');
exports.installCallableFetch=()=>{
 try{
  if(require('react-native').Platform.OS!=='android'||globalThis.fetch?.[marker])return;
  const nativeFetch=require('expo/fetch').fetch;
  if(typeof nativeFetch!=='function'||typeof globalThis.fetch!=='function')return;
  const wrapped=exports.createCallableFetch(globalThis.fetch.bind(globalThis),nativeFetch);
  wrapped[marker]=true;globalThis.fetch=wrapped;
 }catch{/* Older native runtimes retain their existing transport. */}
};
