import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {PortraitWellLayout,LandscapeWellLayout} from '../../../components/WellCardLayouts';
jest.mock('react-native',()=>({View:'View'}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;

test('orientation changes keep every well panel once, with an independent portrait hierarchy and short-landscape columns',()=>{
 const panels={tank:React.createElement('tank'),statistics:React.createElement('statistics'),delivery:React.createElement('delivery'),planning:React.createElement('planning'),rootStyle:{flex:1},topStyle:{alignItems:'center' as const}};
 let tree!:TestRenderer.ReactTestRenderer;
 act(()=>{tree=TestRenderer.create(React.createElement(PortraitWellLayout,panels));});
 expect(tree.root.findByProps({testID:'portrait-well-layout'}).findAllByType('planning' as any)).toHaveLength(1);
 for(const compact of [false,true]) {
  act(()=>tree.update(React.createElement(LandscapeWellLayout,{...panels,compact})));
  for(const panel of ['tank','statistics','delivery','planning'])expect(tree.root.findAllByType(panel as any)).toHaveLength(1);
  const root=tree.root.findByProps({testID:compact?'compact-landscape-well-layout':'landscape-well-layout'});
  if(compact){
   const columns=root.findAllByType('View' as any).filter(n=>n.props.style?.flex===0.58);
   expect(columns).toHaveLength(1);
   expect(columns[0].findAllByType('planning' as any)).toHaveLength(1);
   expect(columns[0].findAllByType('tank' as any)).toHaveLength(0);
  }
  expect(tree.root.findAllByType('ScrollView' as any)).toHaveLength(0);
 }
 act(()=>tree.update(React.createElement(PortraitWellLayout,panels)));
 expect(tree.root.findAllByProps({testID:'compact-landscape-well-layout'})).toHaveLength(0);
 expect(tree.root.findAllByType('tank' as any)).toHaveLength(1);
 act(()=>tree.unmount());
});
