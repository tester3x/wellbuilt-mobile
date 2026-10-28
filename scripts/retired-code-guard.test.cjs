const test=require('node:test');const assert=require('node:assert/strict');
const {violations}=require('./retired-code-guard.cjs');
const policy={retiredBranches:[{branch:'archive/old'}],retiredRuntimePaths:[{id:'old-split-row',file:'shell.tsx',patterns:['function\\s+JobInfoBar\\b','showLegacySplitContext'],replacement:'HaulSplitBar',reason:'Retired text row must not remain reachable.'}]};
test('retired branch is a hard stop',()=>assert.match(violations(policy,'archive/old',()=>'<HaulSplitBar />').join(' '),/NEVER USE THIS BRANCH AGAIN/));
test('a renamed fallback condition cannot hide the retired renderer',()=>assert.match(violations(policy,'active',()=> 'function JobInfoBar() {}').join(' '),/NEVER RESTORE THIS CODE/));
test('retired fallback cannot survive beside approved tabs',()=>assert.equal(violations(policy,'active',()=>'<HaulSplitBar />; const showLegacySplitContext = true;').length,1));
test('approved tabs and existing split data remain permitted',()=>assert.deepEqual(violations(policy,'active',()=>'<HaulSplitBar splitChainSeq={record.splitChainSeq} />'),[]));
