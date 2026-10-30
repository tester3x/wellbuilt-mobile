import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import {runInNewContext} from 'vm';
const source=fs.readFileSync(path.join(__dirname,'../../../app/(tabs)/index.tsx'),'utf8');
const ast=ts.createSourceFile('index.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function updater(name:string){let found!:ts.VariableDeclaration;function walk(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)found=n;ts.forEachChild(n,walk);}walk(ast);return (found.initializer as ts.CallExpression).arguments[0].getText(ast);}
test.each(['fishMoveA','fishMoveB','fishMoveC'])('%s skips geometry work when offscreen or this tank has no fish',name=>{
 for(const [sceneActive,kind] of [[false,'fish'],[true,'duck'],[true,'none']] as const){
  const callback=runInNewContext(ts.transpileModule('const updater='+updater(name)+';updater',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,{sceneActive,aliveEgg:{kind}});
  expect(callback()).toEqual({opacity:0});
 }
});
