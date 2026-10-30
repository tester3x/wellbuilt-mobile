import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import {runInNewContext} from 'vm';
const record=fs.readFileSync(path.resolve(__dirname,'../../../app/record.tsx'),'utf8');
function declaration(text:string,name:string){
 const ast=ts.createSourceFile('screen.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found:ts.Expression|undefined;
 function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)found=n.initializer;ts.forEachChild(n,visit);}visit(ast);
 return found!.getText(ast);
}
function execute(text:string,scope:object){return runInNewContext(ts.transpileModule('const action='+text,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText+';action',scope);}
test('clear waits behind an in-flight draft write, invalidates scheduled saves and empties storage last',async()=>{
 let release!:()=>void;let stored='old';const pending=new Promise<void>(resolve=>release=()=>{stored='late write';resolve();});
 const scope={wellName:'Well',draftGenerationRef:{current:0},draftSaveTimerRef:{current:123},draftStorageQueueRef:{current:pending},clearTimeout:jest.fn(),getDraftKey:(n:string)=>n,AsyncStorage:{removeItem:jest.fn(async()=>{stored='';})},console:{log:jest.fn(),warn:jest.fn()},useCallback:(fn:any)=>fn};
 const clear=execute(declaration(record,'clearDraft'),scope);const task=clear();
 expect(scope.draftGenerationRef.current).toBe(1);expect(scope.clearTimeout).toHaveBeenCalledWith(123);expect(scope.AsyncStorage.removeItem).not.toHaveBeenCalled();
 release();await task;expect(stored).toBe('');
});
test('Clear surrenders keypad before emptying committed refs and fields',async()=>{
 const scope={useCallback:(fn:any)=>fn,isAlreadyDown:false,clearDraft:jest.fn(async()=>{}),alert:{show:jest.fn()},t:(x:string)=>x,keypad:{closeKeypad:jest.fn()},committedLevelRef:{current:'12'},committedBarrelsRef:{current:'0'},setLevel:jest.fn(),setBarrels:jest.fn(),setDateTime:jest.fn(),wellDownTouchedRef:{current:true},wellDownRef:{current:true},setWellDown:jest.fn()};
 execute(declaration(record,'handleClear'),scope)();await scope.alert.show.mock.calls[0][2][1].onPress();
 expect(scope.keypad.closeKeypad).toHaveBeenCalledTimes(1);expect(scope.committedLevelRef.current).toBe('');expect(scope.committedBarrelsRef.current).toBe('');expect(scope.clearDraft).toHaveBeenCalledTimes(1);
});
test('Home rechecks unchanged well on focus and ignores a previous well delayed draft read',async()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../../../app/(tabs)/index.tsx'),'utf8');
 const start=source.indexOf('// Recheck on return from Record');const end=source.indexOf('// Note: Well loading',start);
 let callback!:()=>()=>void;let resolve!:(s:string|null)=>void;
 const scope={useFocusEffect:(fn:any)=>{callback=fn;},useCallback:(fn:any)=>fn,wells:['Same well'],actionIndex:0,getDraftKey:(x:string)=>x,setCurrentWellHasDraft:jest.fn(),AsyncStorage:{getItem:jest.fn(()=>new Promise<string|null>(r=>resolve=r))}};
 runInNewContext(ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,scope);
 const cleanup=callback();cleanup();resolve(JSON.stringify({savedAt:Date.now(),level:'12'}));await Promise.resolve();
 expect(scope.setCurrentWellHasDraft).toHaveBeenCalledTimes(1); // reset only; canceled result ignored
 callback();resolve(null);await Promise.resolve();expect(scope.setCurrentWellHasDraft).toHaveBeenLastCalledWith(false);
 callback();resolve(JSON.stringify({savedAt:Date.now(),level:'12'}));await Promise.resolve();expect(scope.setCurrentWellHasDraft).toHaveBeenLastCalledWith(true);
 callback();resolve(null);await Promise.resolve();expect(scope.setCurrentWellHasDraft).toHaveBeenLastCalledWith(false);
});
