import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import ts from 'typescript';

const source = readFileSync(join(__dirname, '../../../app/(tabs)/index.tsx'), 'utf8');
const ast = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'captureTransitionStart') {
    callback = (node.initializer as ts.CallExpression).arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!callback) throw new Error('Swipe capture callback missing');

test('newly mounted buffer water starts at the captured fraction before layout effects run',()=>{
  let initial='';function find(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='waterFraction')initial=node.initializer!.getText(ast);ts.forEachChild(node,find);}find(ast);
  const fill=runInNewContext(ts.transpileModule('const fill='+initial,{
    compilerOptions:{target:ts.ScriptTarget.ES2020},
  }).outputText+'\nfill',{entryFraction:.63,useSharedValue:(value:number)=>({value})});
  expect(fill.value).toBe(.63);
});

test('swipe captures the drawn departing level, independent of destination preload or later frames', () => {
  const levels = { Previous: {value:0.63}, Destination: {value:0.15} };
  let captured = 0;
  const action = runInNewContext(ts.transpileModule('const capture = ' + callback, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText + '\ncapture', {
    wells: ['Previous', 'Destination'], currentIndex: 0,
    wellLevels: { current: levels }, setEntryFraction: (value: number) => { captured = value; },
  });
  action();
  expect(captured).toBe(0.63);
  levels.Previous.value = 0.4; levels.Destination.value = 0.2;
  expect(captured).toBe(0.63); // The seed cannot follow a later card's updates.
  expect(source).toContain('onScrollBeginDrag={handlePagerDrag}');
  expect(source).toContain('entryFraction={entryFraction}');
});

test('drag origin follows the native visible offset even if JavaScript selection is ahead',()=>{
  let drag:ts.CallExpression|undefined;
  function find(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='handlePagerDrag')drag=node.initializer as ts.CallExpression;ts.forEachChild(node,find);}find(ast);
  expect(drag).toBeDefined();
  const captureTransitionStart=jest.fn();
  const action=runInNewContext(ts.transpileModule('const drag='+drag!.arguments[0].getText(ast),{
    compilerOptions:{target:ts.ScriptTarget.ES2020},
  }).outputText+'\ndrag',{pagerInteraction:{current:false},pagerResizing:{current:false},
    captureTransitionStart,wells:['A','B','C'],cardWidth:360,currentIndex:2});
  action({nativeEvent:{contentOffset:{x:361}}});expect(captureTransitionStart).toHaveBeenLastCalledWith(1);
  action({nativeEvent:{contentOffset:{x:-50}}});expect(captureTransitionStart).toHaveBeenLastCalledWith(0);
  action({nativeEvent:{contentOffset:{x:9999}}});expect(captureTransitionStart).toHaveBeenLastCalledWith(2);
  action();expect(captureTransitionStart).toHaveBeenLastCalledWith(2);
});
