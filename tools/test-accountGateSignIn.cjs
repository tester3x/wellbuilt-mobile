const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function gate(){
 const slots=[],effects=[],events={};let index=0,tree,restore=async()=>{throw Object.assign(Error('Signed out'),{code:'platform/signed-out'});};
 const react={createContext:()=>({Provider:'Provider'}),Fragment:'Fragment',
  createElement:(type,props,...children)=>({type,props:{...props,children}}),
  useState:value=>{const at=index++;if(!(at in slots))slots[at]=value;return [slots[at],next=>{slots[at]=typeof next==='function'?next(slots[at]):next;}];},
  useRef:value=>{const at=index++;if(!(at in slots))slots[at]={current:value};return slots[at];},
  useCallback:(fn,deps)=>{const at=index++;const old=slots[at];if(!old||deps.some((x,i)=>x!==old.deps[i]))slots[at]={fn,deps};return slots[at].fn;},
  useEffect:(fn,deps)=>{const at=index++;const old=slots[at];if(!old||deps.some((x,i)=>x!==old[i])){slots[at]=deps;effects.push(fn);}}};
 const native={addListener:(name,fn)=>{events[name]=fn;return {remove(){}};}};
 const mocks={react,'react-native':{View:'View',Text:'Text',Pressable:'Button',ActivityIndicator:'Spinner',AppState:{addEventListener:(name,fn)=>{events.app=fn;return {remove(){}};}}},
  './index':native,'./accountRecovery':{restoreWithRecovery:({restore})=>restore()},
  './delivery':{subscribePending:()=>()=>{}},'expo-splash-screen':{hideAsync:async()=>{}}};
 const module={exports:{}};vm.runInNewContext(fs.readFileSync('modules/wellbuilt-platform/AccountGate.js','utf8'),{module,require:name=>{assert(name in mocks,name);return mocks[name];},console,setTimeout,clearTimeout});
 const props={restore:()=>restore(),clearLocal:async()=>{},children:{type:'Login'}};
 function render(){index=0;tree=module.exports(props);while(effects.length)effects.shift()();return tree;}
 function nodes(node){return !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];}
 function button(label){return nodes(tree).find(n=>n.type==='Button'&&nodes(n).some(c=>c.type==='Text'&&c.props.children[0]===label));}
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 return {render,button,events,flush,setRestore:fn=>{restore=fn;},props,
  loginVisible:()=>nodes(tree).some(n=>n.type==='View'&&n.props.pointerEvents==='auto'),
  ready:()=>tree.props.value};
}
test('Sign in survives foreground, connection and signed-out account events until real sign-in',async()=>{
 const g=gate();g.render();await g.flush();g.render();
 assert.equal(g.button('Retry'),undefined,'signed-out state should not offer a futile retry');
 await g.button('Sign in').props.onPress();g.render();assert(g.loginVisible());assert.equal(g.ready(),true);
 for(const send of [()=>g.events.app('active'),()=>g.events.accountChanged({}),()=>g.events.connectionChanged({reachable:true})]){
  send();await g.flush();g.render();assert(g.loginVisible(),'background signed-out check must not hide login');assert.equal(g.ready(),true);
 }
 g.setRestore(async()=> 'restored');g.events.accountChanged({});await g.flush();g.render();assert(g.loginVisible());assert.equal(g.ready(),true);
});

test('interactive sign-in releases the actual Mobile entry bootstrap without an authenticated session',async()=>{
 const ts=require('typescript');
 const source=ts.createSourceFile('index.tsx',fs.readFileSync('app/index.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let startup;
 function visit(node){
  if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'&&node.arguments[0]?.getText(source).includes('if(!platformAccountReady)return;'))startup=node.arguments[0];
  ts.forEachChild(node,visit);
 }
 visit(source);assert(startup,'execute the actual Mobile entry effect');
 const js=ts.transpileModule('const startup = '+startup.getText(source)+'; startup();',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const g=gate();g.render();await g.flush();g.render();let reads=0,checking=true,destination=null;
 const context=()=>({platformAccountReady:g.ready(),hasEstablishedWbmEntry:async()=>false,
  isDriverVerified:async()=>{reads++;return false;},setDest:value=>{destination=value;},setChecking:value=>{checking=value;},
  require:name=>{assert(name.endsWith('/deviceAccount'));return {publishMobileDeviceAccount:async()=>{}};},console});
 vm.runInNewContext(js,context());await g.flush();assert.equal(reads,0);
 await g.button('Sign in').props.onPress();g.render();vm.runInNewContext(js,context());await g.flush();
 assert.equal(reads,1);assert.equal(checking,false);assert.equal(destination,'/driver-login');
});
test('late signed-out failure cannot cover a newly requested login; access denial still blocks',async()=>{
 const g=gate();g.render();await g.flush();g.render();
 let reject;g.setRestore(()=>new Promise((_,fail)=>{reject=fail;}));g.events.accountChanged({});
 // Existing signed-out screen still has a sign-in callback while its recheck is pending.
 g.render();g.setRestore(async()=>{throw Object.assign(Error('Signed out'),{code:'platform/signed-out'});});
 // Start with another explicit error state, then race foreground against Sign in.
 reject(Object.assign(Error('Signed out'),{code:'platform/signed-out'}));await g.flush();g.render();
 const sign=g.button('Sign in').props.onPress;
 g.setRestore(()=>new Promise((_,fail)=>{reject=fail;}));g.events.app('active');await sign();g.render();
 reject(Object.assign(Error('Signed out'),{code:'platform/signed-out'}));await g.flush();g.render();assert(g.loginVisible());
 g.setRestore(async()=>{throw Object.assign(Error('Access denied'),{code:'platform/access-denied'});});g.events.accountChanged({});await g.flush();g.render();assert.equal(g.loginVisible(),false);
});


