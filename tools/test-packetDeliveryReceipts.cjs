const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
let reply;
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/secureOperationalApi.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject,require:name=>{
 if(name==='./firebaseAuthSession')return{authorizedCallable:async()=>reply};
 if(name==='./clientBuildMeta')return{governedClientBuildMeta:async()=>undefined};
 throw Error(name);
}});
(async()=>{
 const pull={requestType:'pull',packetId:'fixture-pull'};
 for(const bad of [undefined,{}, {ok:false},{ok:true},{ok:true,key:'other',packetId:'fixture-pull'},{ok:true,key:'fixture-pull',packetId:'other'}]){
  reply=bad;await assert.rejects(()=>exportsObject.secureIngestPacket(pull),/unconfirmed/);
 }
 reply={ok:true,key:'fixture-pull',packetId:'fixture-pull',duplicate:true};assert.equal((await exportsObject.secureIngestPacket(pull)).ok,true);
 const edit={requestType:'edit',originalPacketId:'fixture-pull',idempotencyKey:'fixture-edit'};
 for(const bad of [{},{ok:false},{ok:true},{ok:true,key:'fixture-edit',packetId:'fixture-pull'},{ok:true,key:'wrong',packetId:'fixture-pull',queued:true}]){
  reply=bad;await assert.rejects(()=>exportsObject.secureIngestEdit(edit),/unconfirmed/);
 }
 reply={ok:true,key:'fixture-edit',packetId:'fixture-pull',queued:true};assert.equal((await exportsObject.secureIngestEdit(edit)).ok,true);
 console.log('Mobile receipt boundary: unconfirmed, wrong-identity and incomplete responses rejected; exact new/duplicate receipts accepted.');
})().catch(e=>{console.error(e);process.exitCode=1;});
