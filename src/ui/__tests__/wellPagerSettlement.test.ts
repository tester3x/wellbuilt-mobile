import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import {runInNewContext} from 'vm';
const source=fs.readFileSync(path.resolve(__dirname,'../../../app/(tabs)/index.tsx'),'utf8');
const ast=ts.createSourceFile('index.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function callback(name:string,scope:object){
  let text='';
  function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)text=(n.initializer as ts.CallExpression).arguments[0].getText(ast);ts.forEachChild(n,visit);}
  visit(ast);if(!text)throw Error(name);
  return runInNewContext(ts.transpileModule('('+text+')',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,scope);
}
test('native settled offset repairs a missed visibility callback, including last card and overscroll',()=>{
  const index=jest.fn(),visible=jest.fn(),focused=jest.fn();
  const interaction={current:true},resizing={current:false};
  const position=callback('handlePagerPosition',{pagerInteraction:interaction,pagerResizing:resizing,wells:Array(24),cardWidth:400,columns:1,setCurrentIndex:index,setVisibleWellIndices:visible,setFocusedIndex:focused});
  const settled=callback('handlePagerSettled',{handlePagerPosition:position,pagerInteraction:interaction});
  settled({nativeEvent:{contentOffset:{x:23*400}}});
  expect(index).toHaveBeenLastCalledWith(23);expect(visible).toHaveBeenLastCalledWith([23]);expect(interaction.current).toBe(false);
  interaction.current=true;settled({nativeEvent:{contentOffset:{x:26*400}}});expect(index).toHaveBeenLastCalledWith(23);
  interaction.current=true;settled({nativeEvent:{contentOffset:{x:-150}}});expect(index).toHaveBeenLastCalledWith(0);
  index.mockClear();interaction.current=true;resizing.current=true;settled({nativeEvent:{contentOffset:{x:1200}}});expect(index).not.toHaveBeenCalled();
});
test('catalogue reorder aligns in layout commit without a delayed index jump',()=>{
  let effect='';
  function visit(n:ts.Node){if(ts.isCallExpression(n)&&n.expression.getText(ast)==='useLayoutEffect'&&n.arguments[0]?.getText(ast).includes('offset:pagerContentOffset.x'))effect=n.arguments[0].getText(ast);ts.forEachChild(n,visit);}
  visit(ast);if(!effect)throw Error('alignment missing');
  const scroll=jest.fn(),visible=jest.fn();
  runInNewContext(ts.transpileModule('('+effect+')',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,{
    pagerResizing:{current:false},pagerInteraction:{current:true},pagerExpectedOffset:{current:null},setPagerBridgeActive:jest.fn(),previousPagerViewport:{current:{width:400,columns:1}},pagerViewport:{width:400,columns:1},
    pagerSelectionRef:{current:{index:7,columns:1}},wells:Array(21),pagerContentOffset:{x:2800,y:0},flatListRef:{current:{scrollToOffset:scroll}},setFocusedIndex:jest.fn(),setVisibleWellIndices:visible,
  })();
  expect(scroll).toHaveBeenCalledWith({offset:2800,animated:false});expect(visible).toHaveBeenCalledWith([7]);
  expect(source).not.toMatch(/setTimeout\([\s\S]{0,160}flatListRef\.current\?\.scrollToIndex/);
});

test('periodic focus refresh cannot replace a populated live catalogue through its stale empty-list closure',()=>{
  let guard='';
  function visit(n:ts.Node){if(ts.isIfStatement(n)&&n.thenStatement.getText(ast).includes('setWells(parsed)'))guard=n.expression.getText(ast);ts.forEachChild(n,visit);}
  visit(ast);if(!guard)throw Error('instant-cache guard missing');
  const evaluate=(live:string[])=>runInNewContext(guard,{parsed:['A','B'],wells:[],wellCatalogueRef:{current:live}});
  expect(evaluate([])).toBe(true);
  expect(evaluate(['B','A'])).toBe(false);
});


test('resize bridge ends only after native offset acknowledgement; ordinary scroll never sets selection',()=>{
 const pagerExpectedOffset={current:2800 as number|null},pagerResizing={current:true},setPagerBridgeActive=jest.fn();
 const scroll=callback('handlePagerScroll',{pagerExpectedOffset,pagerResizing,setPagerBridgeActive});
 scroll({nativeEvent:{contentOffset:{x:7000}}});expect(setPagerBridgeActive).not.toHaveBeenCalled();
 scroll({nativeEvent:{contentOffset:{x:2800}}});expect(pagerResizing.current).toBe(false);expect(pagerExpectedOffset.current).toBeNull();expect(setPagerBridgeActive).toHaveBeenCalledWith(false);
 setPagerBridgeActive.mockClear();for(const x of [3000,4500,0])scroll({nativeEvent:{contentOffset:{x}}});expect(setPagerBridgeActive).not.toHaveBeenCalled();
});
test('fast swipes use the native one-interval momentum limit',()=>{
 const ast=ts.createSourceFile('screen.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let pager:ts.JsxOpeningElement|ts.JsxSelfClosingElement|undefined;
 function visit(n:ts.Node){if((ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))&&n.tagName.getText(ast)==='FlatList'&&n.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='testID'&&a.initializer?.getText(ast)==='"well-pager"'))pager=n;ts.forEachChild(n,visit);}visit(ast);
 expect(pager!.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='disableIntervalMomentum'&&!a.initializer)).toBe(true);
});
