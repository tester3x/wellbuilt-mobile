import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import fs from 'fs';import path from 'path';import ts from 'typescript';import {runInNewContext} from 'vm';
import {freshwaterSummaryPlanning,summarySliderValue} from '../freshwaterSummaryPlanning';
import {formatFeetInches} from '../summaryWellLevel';
import {tankViewport,tankSceneScale} from '../../ui/tankViewport';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
function variable(file:string,name:string){const text=fs.readFileSync(path.join(__dirname,'../../../app',file),'utf8');const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found:ts.VariableDeclaration|undefined;function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)found=n;ts.forEachChild(n,visit);}visit(ast);if(!found)throw Error(name);return {node:found,ast,text};}
function execute(text:string,scope:Record<string,unknown>){return runInNewContext(ts.transpileModule('const action='+text,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2020}}).outputText+'\naction',{...scope});}
function words(node:any):string{return node==null?'':typeof node==='string'?node:Array.isArray(node)?node.map(words).join(' '):words(node.children);}
const now=Date.parse('2026-10-27T19:45:00Z');
const well={wellName:'Shared inventory',routeType:'freshwater',levelFeet:13.5,snapshotTimestamp:now,dailyBbl:72,bblPerFoot:60,tankHeight:20,allowedBottom:8,isDown:false};
test('selected feet and hours use canonical consumption, zero/unknown and paused semantics',()=>{
 expect(freshwaterSummaryPlanning(well,12,24,now)).toMatchObject({current:13.5,targetAt:'2026-10-29T01:45:00.000Z',future:12.3,minimumAt:'2026-11-01T09:45:00.000Z'});
 expect(freshwaterSummaryPlanning(well,11,48,now).future).toBeCloseTo(11.1);
 expect(freshwaterSummaryPlanning({...well,isDown:true},12,24,now)).toMatchObject({current:13.5,targetAt:null,future:13.5,minimumAt:null});
 expect(freshwaterSummaryPlanning({...well,dailyBbl:0},12,24,now)).toMatchObject({targetAt:null,future:13.5});
 expect(freshwaterSummaryPlanning({...well,dailyBbl:null},12,24,now)).toMatchObject({targetAt:null,future:null});
 expect(freshwaterSummaryPlanning({...well,unavailable:true},12,24,now).current).toBeNull();
});
test('actual Summary row reads both selected values and keeps consumption outside target columns',()=>{
 const {node,ast}=variable('summary.tsx','renderWellRow');
 const render=(mode:string,feet:number,hours:number)=>execute(node.initializer!.getText(ast),{React,TouchableOpacity:'TouchableOpacity',View:'View',Text:'Text',styles:{},freshwaterSummaryPlanning,sliderFeet:feet,sliderHours:hours,projectionNow:now,sliderMode:mode,formatFeetInches,formatDateTimeSplit:(d:Date)=>({time:d.toISOString(),date:''}),expandedWell:null,handleWellPress:()=>{}})(well);
 let tree!:TestRenderer.ReactTestRenderer;act(()=>{tree=TestRenderer.create(render('feet',12,24));});
 expect(words(tree.toJSON())).toContain('2026-10-29T01:45:00.000Z');expect(words(tree.toJSON())).toContain('Minimum 8');expect(words(tree.toJSON())).not.toContain('BBL/day');
 act(()=>{tree.update(render('feet',11,24));});expect(words(tree.toJSON())).toContain('2026-10-29T21:45:00.000Z');
 act(()=>{tree.update(render('time',11,24));});expect(words(tree.toJSON())).toContain(formatFeetInches(12.3));
 act(()=>{tree.update(render('time',11,48));});expect(words(tree.toJSON())).toContain(formatFeetInches(11.1));act(()=>tree.unmount());
});
test('actual movement and release handlers commit the same normalized selected value',()=>{
 const {node,ast}=variable('summary.tsx','handleSlidingComplete');let selected=0;
 const scope={sliderMode:'feet',MIN_SLIDER_FEET:0,maxSliderFeet:20,MIN_SLIDER_HOURS:0,MAX_SLIDER_HOURS:72,summarySliderValue,handleSliderFeetChange:(v:number)=>{selected=v;},handleSliderHoursChange:(v:number)=>{selected=v;},resetSliderLockTimer:()=>{}};
 const callback=(node.initializer as ts.ArrowFunction).getText(ast);
 execute(callback,scope)([12.13]);expect(selected).toBe(12.25);
 execute(callback,{...scope,sliderMode:'time'})(24.13);expect(selected).toBe(24.25);
 const {text}=variable('summary.tsx','handleSlidingComplete');const source=ts.createSourceFile('summary.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let change:ts.JsxAttribute|undefined;function visit(n:ts.Node){if(ts.isJsxAttribute(n)&&n.name.getText(source)==='onValueChange')change=n;ts.forEachChild(n,visit);}visit(source);
 const expression=(change!.initializer as ts.JsxExpression).expression!;
 execute(expression.getText(source),scope)([12.13]);expect(selected).toBe(12.25);
});
test.each([[800,1000],[1000,600],[360,800]])('actual card renderer keeps each well and its controls in a fixed viewport at %sx%s', (width,height)=>{
 const {columns,cardWidth,viewportHeight}=tankViewport(width,height);const {node,ast}=variable('(tabs)/index.tsx','renderWell');const call=node.initializer as ts.CallExpression;
 const scope={React,View:'View',Text:'Text',TouchableOpacity:'TouchableOpacity',ScrollView:'ScrollView',WellView:'WellView',cardWidth,viewportHeight,visibleWellIndices:[0,1],actionIndex:0,wellConfigMap:{Left:{route:'Route',operator:'Operator'},Right:{route:'Route',operator:'Operator'}},getRouteColor:()=>'',setFocusedIndex:()=>{},openPicker:()=>{},entryFraction:0,handleLevelChange:()=>{},refreshTrigger:0,setSliderActive:()=>{},loadBbls:140,handleTankDoubleTap:()=>{},handleTankLongPress:()=>{},showOvernightBbls:false,handleToggleOvernightBbls:()=>{}};
 const render=execute(call.arguments[0].getText(ast),scope);let tree!:TestRenderer.ReactTestRenderer;
 act(()=>{tree=TestRenderer.create(React.createElement(React.Fragment,null,render({item:'Left',index:0}),render({item:'Right',index:1})));});
 const cards=tree.root.findAllByType('WellView' as any);expect(cards.map(c=>c.props.wellName)).toEqual(['Left','Right']);expect(cards.every(c=>c.props.isActive)).toBe(true);expect(cards.every(c=>c.props.cardWidth===width/columns)).toBe(true);expect(tree.root.findAllByType('ScrollView' as any)).toHaveLength(0);expect(words(tree.toJSON())).toContain('Left');expect(words(tree.toJSON())).toContain('Right');
 for (const card of tree.root.findAllByType('View' as any).filter(v=>v.props.onTouchStart)) {
  expect(card.props.style).toMatchObject({flex:1,minHeight:0});
  expect(card.props.style.borderColor).toBeUndefined();
 }
 expect(tankSceneScale(cardWidth,viewportHeight,300,360)*300).toBeLessThanOrEqual(cardWidth-24);act(()=>tree.unmount());
});

test('actual main card host has one shared Settings action and live widths',()=>{
 const {text}=variable('(tabs)/index.tsx','renderWell');const ast=ts.createSourceFile('home.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const main=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='MainScreen') as ts.FunctionDeclaration;
 const root=(main.body!.statements.filter(ts.isReturnStatement).at(-1)!).expression!;
 let settings=0;function visit(n:ts.Node){if(ts.isJsxAttribute(n)&&n.name.getText(ast)==='accessibilityLabel'&&n.initializer?.getText(ast)==='"Settings"')settings++;ts.forEachChild(n,visit);}visit(root);expect(settings).toBe(1);
 expect(JSON.parse(fs.readFileSync(require('path').join(__dirname,'../../../app.json'),'utf8')).expo.orientation).toBe('default');
});
