const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
function violations(policy,branch,read) {
 const errors=[];
 if(policy.retiredBranches.some(item=>item.branch===branch))errors.push('NEVER USE THIS BRANCH AGAIN: '+branch);
 for(const item of policy.retiredRuntimePaths) {
  const source=read(item.file);
  if(item.patterns.some(pattern=>new RegExp(pattern,'m').test(source)))errors.push('NEVER RESTORE THIS CODE: '+item.id+' in '+item.file+'. Use '+item.replacement+'. '+item.reason);
 }
 return errors;
}
function assertRetiredCodePolicy(root) {
 const policy=JSON.parse(fs.readFileSync(path.join(root,'retirement-policy.json'),'utf8'));
 const branch=cp.execFileSync('git',['-C',root,'branch','--show-current'],{encoding:'utf8',windowsHide:true}).trim();
 const errors=violations(policy,branch,file=>fs.readFileSync(path.join(root,file),'utf8'));
 if(errors.length)throw Error(errors.join('\n'));
 return true;
}
module.exports={violations,assertRetiredCodePolicy};
if(require.main===module)try{assertRetiredCodePolicy(path.resolve(__dirname,'..'));console.log('Retired-code guard passed.');}catch(error){console.error('RELEASE BLOCKED: '+error.message);process.exitCode=1;}
