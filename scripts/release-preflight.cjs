'use strict';
// Portable release gate for the registered home on either computer. Never merges or builds implicitly.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const git = args => {
  const r = cp.spawnSync('git', ['-C', root, ...args], {encoding:'utf8', windowsHide:true, timeout:60000});
  if (r.status !== 0) throw Error((r.stderr || r.error?.message || 'git failed').trim());
  return r.stdout.trim();
};
function need(ok, message) { if (!ok) throw Error(message); }
function remoteHeads() {
  git(['fetch','origin','+refs/heads/*:refs/remotes/origin/*','--tags']);
  return Object.fromEntries(git(['ls-remote','--heads','origin']).split('\n').filter(Boolean).map(l => {
    const [sha, ref] = l.split(/\s+/); return [ref.slice('refs/heads/'.length), sha];
  }));
}
function ancestor(commit, head) {
  return cp.spawnSync('git',['-C',root,'merge-base','--is-ancestor',commit,head],{windowsHide:true}).status === 0;
}
function validate(plan, state, isAncestor = ancestor) {
  need(plan.schemaVersion === 1, 'Unsupported release manifest schema');
  need(plan.owner?.session && plan.owner?.machine, 'One named release owner/session and machine required');
  need(plan.sourceCommit === state.head && /^[a-f0-9]{40}$/.test(plan.sourceCommit), 'Build exact declared HEAD');
  need(state.clean, 'Build requires clean source, including untracked files; preserve unrelated work, never clean it away');
  need(state.remote === state.expectedRemote, 'Unexpected origin; use the registered repository');
  need(state.heads[plan.releaseBranch] === state.head, 'Push final reconciled HEAD; remote release branch moved or differs');
  need(plan.unpushedWorkLimitation === 'Other-machine unpushed work cannot be discovered', 'Record the unpushed-work limitation');
  const reviewed = plan.reviewedBranches || {};
  need(Object.keys(reviewed).length === Object.keys(state.heads).length, 'Review every freshly discovered branch; new/deleted branches require review');
  for (const [branch, sha] of Object.entries(state.heads)) {
    const r = reviewed[branch];
    need(r?.commit === sha, 'Remote movement/unreviewed branch: '+branch);
    need(r.disposition === 'included' ? isAncestor(sha,state.head) : r.disposition === 'excluded' && r.reason?.trim().length >= 12,
      'Include relevant branch ancestry or explicitly justify exclusion: '+branch);
  }
  need(Array.isArray(plan.expectedCommits) && plan.expectedCommits.length > 0, 'List expected commits from BOTH machine histories');
  for (const sha of plan.expectedCommits) need(/^[a-f0-9]{40}$/.test(sha) && isAncestor(sha,state.head), 'Missing expected commit '+sha);
  need(plan.deltaReview?.base && isAncestor(plan.deltaReview.base,state.head) && plan.deltaReview.sourceCommit === state.head && plan.deltaReview.evidence,
    'Inspect full base..source release delta and record evidence');
  need(plan.checks?.length > 0 && plan.checks.every(c=>c.sourceCommit===state.head && c.result==='passed' && c.command && c.evidence),
    'Relevant checks must pass on exact combined source, with evidence');
  need(plan.packageId === state.packageId && plan.versionCode === state.versionCode && state.nativeMatches, 'App/native package/version mismatch');
  need(/^[a-f0-9]{64}$/.test(plan.signingCertificateSha256) && plan.signingCertificateSha256 === state.signingCertificateSha256, 'Retain approved release signing certificate');
  for (const kind of ['published','cloud','localManifests','localArtifacts','installed']) {
    const v = plan.versionAudit?.[kind];
    need(v && Number.isInteger(v.maxVersionCode) && v.maxVersionCode >= 0 && v.evidence && v.checkedAt && Number.isFinite(Date.parse(v.checkedAt)), 'Version audit missing '+kind);
    const age = Date.now()-Date.parse(v.checkedAt);
    need(age >= -60000 && age <= 24*60*60*1000, 'Refresh version evidence within24h: '+kind);
  }
  const ceiling = Math.max(state.knownVersionFloor,...Object.values(plan.versionAudit).map(v=>v.maxVersionCode));
  need(Number.isSafeInteger(plan.versionCode) && plan.versionCode <= 2100000000 && plan.versionCode > ceiling, 'Allocate versionCode greater than ALL published/cloud/local/installed/reserved evidence: '+ceiling);
  return true;
}
function state(heads) {
  const known = JSON.parse(fs.readFileSync(path.join(root,'docs/android-release-history.json'),'utf8'));
  const app = JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8')).expo;
  need(app.android.package === known.packageId, 'Configured package differs from approved historical identity');
  const native = fs.readFileSync(path.join(root,'android/app/build.gradle'),'utf8');
  const code = Number(native.match(/versionCode\s+(\d+)/)?.[1]);
  const id = native.match(/applicationId\s+["']([^"']+)/)?.[1];
  const name = native.match(/versionName\s+["']([^"']+)/)?.[1];
  let reserved = 0;
  for (const line of git(['ls-remote','--tags','origin','refs/tags/android-release-v*']).split('\n')) {
    const n = line.match(/refs\/tags\/android-release-v(\d+)(?:\^\{\})?$/); if(n) reserved=Math.max(reserved,Number(n[1]));
  }
  return {head:git(['rev-parse','HEAD']), clean:git(['status','--porcelain','--untracked-files=all'])==='', heads,
    remote:git(['remote','get-url','origin']), expectedRemote:known.remote,
    packageId:app.android.package,versionCode:app.android.versionCode,
    nativeMatches:code===app.android.versionCode && id===app.android.package && name===app.version,
    signingCertificateSha256:known.signingCertificateSha256, knownVersionFloor:Math.max(known.versionCodeFloor,reserved)};
}
function verify(plan, allowOwnReservation=false) {
  require('./retired-code-guard.cjs').assertRetiredCodePolicy(root);
  const heads=remoteHeads(); const s=state(heads);
  if(allowOwnReservation) {
    // Own version is already allocated; every OTHER reservation must still be below it.
    const tags=git(['ls-remote','--tags','origin','refs/tags/android-release-v*']);
    const others=tags.split('\n').map(l=>Number(l.match(/android-release-v(\d+)(?:\^\{\})?$/)?.[1]||0)).filter(n=>n!==plan.versionCode);
    const history=JSON.parse(fs.readFileSync(path.join(root,'docs/android-release-history.json'),'utf8'));
    s.knownVersionFloor=Math.max(history.versionCodeFloor,...others);
  }
  validate(plan,s);
  return s;
}
function main(args) {
  const [mode, file, ...rest]=args;
  if(mode==='survey') {
    const heads=remoteHeads(),head=git(['rev-parse','HEAD']);
    console.log(JSON.stringify({head,branch:git(['branch','--show-current']),branches:Object.entries(heads).map(([branch,commit])=>({branch,commit,included:ancestor(commit,head)})),limitation:'Other-machine unpushed work cannot be discovered'},null,2)); return;
  }
  need(['check','reserve','verify-reservation','build'].includes(mode) && file, 'Usage: survey | check/reserve/verify-reservation/build MANIFEST.json [-- gradle arguments]');
  const plan=JSON.parse(fs.readFileSync(file,'utf8'));
  const tag='android-release-v'+plan.versionCode;
  if(mode==='check'||mode==='reserve') {
    verify(plan);
    if(mode==='reserve') {
      need(!git(['ls-remote','--tags','origin','refs/tags/'+tag]),'Version already reserved remotely');
      // Immutable annotated tag is the GitHub manifest and atomic cross-computer reservation.
      const r=cp.spawnSync('git',['-C',root,'tag','-a',tag,plan.sourceCommit,'-F','-'],{input:JSON.stringify(plan,null,2),encoding:'utf8',windowsHide:true});
      need(r.status===0,r.stderr||'Tag creation failed');
      git(['push','origin','refs/tags/'+tag+':refs/tags/'+tag]); // No force; another owner wins a race.
    }
  } else {
    const remote=git(['ls-remote','--tags','origin','refs/tags/'+tag]).split(/\s+/)[0];
    need(remote && remote===git(['rev-parse','refs/tags/'+tag]),'Remote reservation absent or different');
    const saved=JSON.parse(git(['for-each-ref','--format=%(contents)','refs/tags/'+tag]));
    need(JSON.stringify(saved)===JSON.stringify(plan),'Reservation manifest/owner differs');
    need(git(['rev-parse',tag+'^{commit}'])===plan.sourceCommit,'Reservation source differs');
    verify(plan,true); // Fresh fetch and full remote movement/ancestry check immediately before build.
    if(mode==='build') {
      need(rest[0]==='--' && rest.length>1,'Supply Gradle task arguments after --');
      need(rest.slice(1).every(x=>/^[a-zA-Z0-9_:./=,+-]+$/.test(x) && !/^(-p|--project-dir|--include-build|--init-script|-I)(=|$)/.test(x)), 'Only safe Gradle task/flag arguments in this registered home');
      const exe=process.platform==='win32'?'gradlew.bat':'./gradlew';
      const bundle=cp.spawnSync(exe,[':app:createBundleReleaseJsAndAssets','--rerun-tasks','--no-daemon'],{cwd:path.join(root,'android'),stdio:'inherit',shell:process.platform==='win32',windowsHide:true});
      need(bundle.status===0,'Bundle regeneration failed; do not publish');
      verify(plan,true);
      const r=cp.spawnSync(exe,rest.slice(1),{cwd:path.join(root,'android'),stdio:'inherit',shell:process.platform==='win32',windowsHide:true});
      need(r.status===0,'Gradle failed; reservation remains consumed, preserve evidence');
      need(git(['rev-parse','HEAD'])===plan.sourceCommit && git(['status','--porcelain','--untracked-files=all'])==='', 'Source changed during build; do not publish');
      verify(plan,true); // Refuse a current-source claim if another machine moved during packaging.
    }
  }
  console.log('Release gate passed for '+plan.sourceCommit+'; unpushed other-machine work remains undiscoverable.');
}
module.exports={validate};
if(require.main===module)try{main(process.argv.slice(2));}catch(e){console.error('RELEASE PREFLIGHT: '+e.message);process.exitCode=1;}
