import React,{useState} from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {ProductionRateRow} from '../../../components/ProductionRateRow';
jest.mock('react-native',()=>({Pressable:'Pressable',View:'View',Text:'Text'}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const base={afrDaily:240,styles:{statsRow:{},statLeft:{},statRight:{},statDivider:{}},hourUnit:'bbl/hr',dayUnit:'bbl/day',accessibilityLabel:'All wells AFR / ON',lockedHint:'ON unavailable'};
function words(node:any):string{return node==null?'':typeof node==='string'?node:Array.isArray(node)?node.map(words).join(''):words(node.children);}

test('tapping either landscape card toggles both available wells and later portrait together',()=>{
 function Screen({portrait=false}:{portrait?:boolean}){
  const [on,setOn]=useState(false);
  return React.createElement(React.Fragment,null,...(portrait?[480]:[480,720]).map((daily,i)=>React.createElement(ProductionRateRow,{...base,key:i,overnightDaily:daily,showOvernight:on,onToggle:()=>setOn(v=>!v)})));
 }
 let tree!:TestRenderer.ReactTestRenderer;act(()=>{tree=TestRenderer.create(React.createElement(Screen));});
 const buttons=()=>tree.root.findAllByProps({testID:'production-rate-toggle'});
 act(()=>buttons()[1].props.onPress());
 expect(words(tree.toJSON())).toContain('20 bbl/hr');expect(words(tree.toJSON())).toContain('30 bbl/hr');
 expect(words(tree.toJSON()).match(/ ON/g)).toHaveLength(2);
 act(()=>buttons()[0].props.onPress());expect(words(tree.toJSON())).not.toContain(' ON');
 act(()=>buttons()[1].props.onPress());act(()=>tree.update(React.createElement(Screen,{portrait:true})));
 expect(words(tree.toJSON())).toContain('480 bbl/day ON');
 expect(buttons()[0].props.style).toMatchObject({width:'100%',alignSelf:'stretch'});
 act(()=>tree.unmount());
});

test.each([undefined,0,-1,NaN,Infinity])('unavailable ON %s shows AFR and a lock without disabling the shared toggle',overnightDaily=>{
 const onToggle=jest.fn();let tree!:TestRenderer.ReactTestRenderer;
 act(()=>{tree=TestRenderer.create(React.createElement(ProductionRateRow,{...base,overnightDaily,showOvernight:true,onToggle}));});
 expect(words(tree.toJSON())).toContain('10 bbl/hr');expect(words(tree.toJSON())).toContain('240 bbl/day 🔒');
 act(()=>tree.root.findByProps({testID:'production-rate-toggle'}).props.onPress());expect(onToggle).toHaveBeenCalledTimes(1);
 act(()=>tree.unmount());
});

test('live ON withdrawal and return follow shared preference; freshwater never uses a stale ON value',()=>{
 const props={...base,showOvernight:true,onToggle:()=>{},overnightDaily:480,estimated:true};let tree!:TestRenderer.ReactTestRenderer;
 act(()=>{tree=TestRenderer.create(React.createElement(ProductionRateRow,props));});expect(words(tree.toJSON())).toContain('480 bbl/day ON ≈');
 act(()=>tree.update(React.createElement(ProductionRateRow,{...props,overnightDaily:undefined})));expect(words(tree.toJSON())).toContain('240 bbl/day 🔒');
 act(()=>tree.update(React.createElement(ProductionRateRow,props)));expect(words(tree.toJSON())).toContain('480 bbl/day ON ≈');
 act(()=>tree.update(React.createElement(ProductionRateRow,{...props,freshwater:true,consumptionDaily:72})));expect(words(tree.toJSON())).toContain('3.0 bbl/hr');expect(words(tree.toJSON())).toContain('72 bbl/day 🔒');
 act(()=>tree.unmount());
});


test('freshwater fractional daily rates stay readable without rounding the hourly calculation first',()=>{
 let tree!:TestRenderer.ReactTestRenderer;
 act(()=>{tree=TestRenderer.create(React.createElement(ProductionRateRow,{...base,freshwater:true,consumptionDaily:37.51570449074099,showOvernight:false,onToggle:()=>{}}));});
 expect(words(tree.toJSON())).toContain('1.6 bbl/hr');
 expect(words(tree.toJSON())).toContain('37.5 bbl/day');
 expect(words(tree.toJSON())).not.toContain('37.515704');
 act(()=>tree.unmount());
});

test.each([null,NaN,Infinity,-1])('invalid freshwater rate %s stays unavailable',consumptionDaily=>{
 let tree!:TestRenderer.ReactTestRenderer;
 act(()=>{tree=TestRenderer.create(React.createElement(ProductionRateRow,{...base,freshwater:true,consumptionDaily,showOvernight:false,onToggle:()=>{}}));});
 expect(words(tree.toJSON())).toContain('-- bbl/hr');expect(words(tree.toJSON())).toContain('-- bbl/day');
 act(()=>tree.unmount());
});
