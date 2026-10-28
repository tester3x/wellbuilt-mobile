import React,{useEffect} from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {WellCardLayout} from '../../../components/WellCardLayouts';
import {WellPagerCard} from '../../../components/WellPagerCard';
jest.mock('react-native',()=>({View:'View'}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;

test('portrait/landscape resize keeps each mounted well and all panels alive',()=>{
 const mounted=jest.fn(),unmounted=jest.fn();
 function StatefulPanel({name}:{name:string}) {useEffect(()=>{mounted(name);return ()=>unmounted(name);},[]);return React.createElement(name);}
 const panels={tank:React.createElement(StatefulPanel,{name:'tank'}),statistics:React.createElement(StatefulPanel,{name:'statistics'}),delivery:React.createElement(StatefulPanel,{name:'delivery'}),planning:React.createElement(StatefulPanel,{name:'planning'}),rootStyle:{flex:1},topStyle:{alignItems:'center' as const}};
 const render=(wideLayout:boolean)=>React.createElement(WellPagerCard,{width:wideLayout?700:876,wideLayout,header:React.createElement('card-header'),children:React.createElement(WellCardLayout,{...panels,wideLayout})});
 let tree!:TestRenderer.ReactTestRenderer;
 act(()=>{tree=TestRenderer.create(render(false));});
 for(const wide of [true,false,true,false]) {
  act(()=>tree.update(render(wide)));
  expect(tree.root.findAllByProps({testID:wide?'landscape-well-layout':'portrait-well-layout'})).not.toHaveLength(0);
  for(const panel of ['tank','statistics','delivery','planning'])expect(tree.root.findAllByType(panel as any)).toHaveLength(1);
  expect(tree.root.findAllByType('ScrollView' as any)).toHaveLength(0);
  expect(mounted).toHaveBeenCalledTimes(4);expect(unmounted).not.toHaveBeenCalled();
 }
 act(()=>tree.unmount());expect(unmounted).toHaveBeenCalledTimes(4);
});
