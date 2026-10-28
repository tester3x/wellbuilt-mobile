import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {PortraitWellLayout,LandscapeWellLayout} from '../../../components/WellCardLayouts';
jest.mock('react-native',()=>({View:'View'}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;

test('rotation switches independent layouts without losing or duplicating any well panel',()=>{
 const panels={tank:React.createElement('tank'),statistics:React.createElement('statistics'),delivery:React.createElement('delivery'),planning:React.createElement('planning'),rootStyle:{flex:1},topStyle:{alignItems:'center' as const}};
 let tree!:TestRenderer.ReactTestRenderer;
 act(()=>{tree=TestRenderer.create(React.createElement(PortraitWellLayout,panels));});
 for(const [Component,id] of [[LandscapeWellLayout,'landscape-well-layout'],[PortraitWellLayout,'portrait-well-layout']] as const) {
  act(()=>tree.update(React.createElement(Component,panels)));
  expect(tree.root.findAllByProps({testID:id})).not.toHaveLength(0);
  for(const panel of ['tank','statistics','delivery','planning'])expect(tree.root.findAllByType(panel as any)).toHaveLength(1);
  expect(tree.root.findAllByType('ScrollView' as any)).toHaveLength(0);
 }
 act(()=>tree.unmount());
});
