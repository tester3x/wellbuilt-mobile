'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('./release-preflight.cjs');
function fixture(){
 const head='a'.repeat(40),other='b'.repeat(40),base='c'.repeat(40),cert='d'.repeat(64);
 const audit=Object.fromEntries(['published','cloud','localManifests','localArtifacts','installed'].map(k=>[k,{maxVersionCode:k==='installed'?274:272,checkedAt:new Date().toISOString(),evidence:k+' inspected report'}]));
 return {plan:{schemaVersion:1,owner:{session:'test-owner',machine:'test-machine'},sourceCommit:head,releaseBranch:'release/current',packageId:'com.example.test',versionCode:275,signingCertificateSha256:cert,unpushedWorkLimitation:'Other-machine unpushed work cannot be discovered',reviewedBranches:{'release/current':{commit:head,disposition:'included'},'laptop/current':{commit:other,disposition:'included'}},expectedCommits:[head,other],deltaReview:{base,sourceCommit:head,evidence:'full diff inspected'},checks:[{sourceCommit:head,command:'relevant tests',result:'passed',evidence:'combined-source log'}],versionAudit:audit},state:{head,clean:true,heads:{'release/current':head,'laptop/current':other},remote:'https://github.com/test/repo.git',expectedRemote:'https://github.com/test/repo.git',packageId:'com.example.test',versionCode:275,nativeMatches:true,signingCertificateSha256:cert,knownVersionFloor:274},ancestor:()=>true};
}
function run(change,pattern){const f=fixture();change(f);assert.throws(()=>validate(f.plan,f.state,f.ancestor),pattern);}
test('combined source with both histories and local274 over cloud272 permits275',()=>{const f=fixture();assert.equal(validate(f.plan,f.state,f.ancestor),true);});
test('fresh laptop movement invalidates previously reviewed manifest',()=>run(f=>f.state.heads['laptop/current']='e'.repeat(40),/movement/));
test('new remote branch requires explicit review',()=>run(f=>f.state.heads['laptop/new']='e'.repeat(40),/every freshly/));
test('missing other-machine expected commit blocks even if branch excluded',()=>run(f=>{f.plan.reviewedBranches['laptop/current']={commit:'b'.repeat(40),disposition:'excluded',reason:'Reviewed historical lane unrelated to release'};f.ancestor=x=>x!=='b'.repeat(40);},/Missing expected/));
test('included branch missing ancestry blocks',()=>run(f=>f.ancestor=x=>x!=='b'.repeat(40),/Include relevant/));
test('blind exclusion without meaningful rationale blocks',()=>run(f=>f.plan.reviewedBranches['laptop/current'].disposition='excluded',/justify exclusion/));
test('unpushed source blocks',()=>run(f=>f.state.heads['release/current']='e'.repeat(40),/Push final/));
test('dirty including pre-existing untracked source blocks',()=>run(f=>f.state.clean=false,/clean source/));
test('wrong package, native version or signing certificate blocks',()=>{run(f=>f.plan.packageId='wrong',/package\/version/);run(f=>f.state.nativeMatches=false,/package\/version/);run(f=>f.plan.signingCertificateSha256='e'.repeat(64),/signing/);});
test('installed274 cannot be hidden by cloud272 or same-version local build',()=>run(f=>{f.plan.versionCode=274;f.state.versionCode=274;},/greater than ALL/));
test('higher remote reservation blocks competing release',()=>run(f=>f.state.knownVersionFloor=275,/greater than ALL/));
test('missing or stale version audit blocks',()=>{run(f=>delete f.plan.versionAudit.localArtifacts,/missing localArtifacts/);run(f=>f.plan.versionAudit.cloud.checkedAt='2026-01-01T00:00:00Z',/Refresh version/);});
test('checks from pre-reconciliation source block',()=>run(f=>f.plan.checks[0].sourceCommit='e'.repeat(40),/combined source/));
test('missing full delta review blocks',()=>run(f=>delete f.plan.deltaReview.evidence,/full base/));
test('wrong origin and silent synchronization claim block',()=>{run(f=>f.state.remote='https://github.com/wrong/repo',/Unexpected origin/);run(f=>delete f.plan.unpushedWorkLimitation,/unpushed-work/);});
