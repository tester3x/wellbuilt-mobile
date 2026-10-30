import {readFileSync} from 'fs';
import {join} from 'path';
import {runInNewContext} from 'vm';
import ts from 'typescript';
const text=readFileSync(join(__dirname,'../../../app/(tabs)/index.tsx'),'utf8');
const ast=ts.createSourceFile('index.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function nodes(predicate:(node:ts.Node)=>boolean){const found:ts.Node[]=[];function visit(node:ts.Node){if(predicate(node))found.push(node);ts.forEachChild(node,visit);}visit(ast);return found;}
function execute(node:ts.Node,scope:Record<string,unknown>){return runInNewContext(ts.transpileModule('const value='+node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText+'\nvalue',scope);}
test('single-well sync updates only that well; initial/empty completions do not reload the list',()=>{
  const call=nodes(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='onSyncStatusChange')[0] as ts.CallExpression;
  let tokens={A:2,B:7};const setWellRefreshes=jest.fn(fn=>{tokens=fn(tokens);});
  const handler=execute(call.arguments[0],{setIsBackgroundSyncing:jest.fn(),setWellRefreshes});
  handler(false,[]);expect(setWellRefreshes).not.toHaveBeenCalled();
  handler(true,['A']);expect(setWellRefreshes).not.toHaveBeenCalled();
  handler(false,['A','A']);expect(tokens).toEqual({A:3,B:7});
  handler(false,['B']);expect(tokens).toEqual({A:3,B:8});
});
test.each([1,2])('actual pager admits only current/adjacent panels for %s columns',columns=>{
  const attrs=nodes(n=>ts.isJsxAttribute(n)&&n.name.getText(ast)==='entryPrepared') as ts.JsxAttribute[];
  expect(attrs).toHaveLength(2);
  for(const attr of attrs){const expr=(attr.initializer as ts.JsxExpression).expression!;
    const admitted=Array.from({length:20},(_,index)=>index).filter(index=>execute(expr,{index,currentIndex:8,columns}));
    expect(admitted).toEqual(columns===1?[7,8,9]:[6,7,8,9,10,11]);
  }
});
test('distant cells exit the actual data effect before performing any reads',()=>{
  const effect=nodes(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0]?.getText(ast).includes('readWellDisplayData'))[0] as ts.CallExpression;
  // Any access to config/storage/network would fail because nothing else exists.
  expect(execute(effect.arguments[0],{entryPrepared:false})()).toBeUndefined();
});
