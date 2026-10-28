import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import {runInNewContext} from 'vm';
import {SliderInfoSlot} from '../../../components/SliderInfoSlot';
jest.mock('react-native',()=>({View:'View'}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;

test('hidden selected-level/date panel reserves its height before the first peek and cannot collapse on relock',()=>{
 const props={primary:React.createElement('next-load'),secondary:React.createElement('level-date'),showPrimary:true};
 let tree!:TestRenderer.ReactTestRenderer;
 act(()=>{tree=TestRenderer.create(React.createElement(SliderInfoSlot,props));});
 expect(tree.root.findAllByType('level-date' as any)).toHaveLength(1);
 act(()=>{
  tree.root.findByProps({testID:'slider-info-next-load'}).props.onLayout({nativeEvent:{layout:{height:48}}});
  tree.root.findByProps({testID:'slider-info-selected-level'}).props.onLayout({nativeEvent:{layout:{height:76.2}}});
 });
 const height=()=>tree.root.findByProps({testID:'slider-info-slot'}).props.style.at(-1).height;
 expect(height()).toBe(77);
 for(const showPrimary of [false,true,false,true]){
  act(()=>tree.update(React.createElement(SliderInfoSlot,{...props,showPrimary})));
  expect(height()).toBe(77);
 }
 act(()=>tree.root.findByProps({testID:'slider-info-selected-level'}).props.onLayout({nativeEvent:{layout:{height:64}}}));
 expect(height()).toBe(77);
 act(()=>tree.unmount());
});

test.each([false,true])('actual phone/tablet styles give the complete thumb a real row before the hint (tablet=%s)',isTablet=>{
 const file=path.resolve(__dirname,'../../../app/(tabs)/index.tsx');
 const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const declaration=ast.statements.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations).find(d=>d.name.getText(ast)==='styles')!;
 const object=(declaration.initializer as ts.CallExpression).arguments[0] as ts.ObjectLiteralExpression;
 const read=(key:string)=>{
  const field=object.properties.find(p=>p.name?.getText(ast)===key) as ts.PropertyAssignment;
  return runInNewContext(ts.transpileModule('result='+field.initializer.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,{isTablet});
 };
 const row=read('sliderRow'),wrapper=read('sliderWrapper'),slider=read('slider'),thumb=read('sliderThumb');
 expect(slider.flex).toBeUndefined();
 expect(row.height).toBeGreaterThanOrEqual(thumb.height);
 expect(wrapper.height).toBe(slider.height);
 expect(row.height+8-(row.height/2+thumb.height/2)).toBeGreaterThanOrEqual(8);
});
