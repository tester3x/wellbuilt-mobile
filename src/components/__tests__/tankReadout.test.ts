import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {TankReadout,tankReadoutText} from '../TankReadout';
let mockFrame:(info:{timestamp:number})=>void;
const mockFrameControl={setActive:jest.fn()};
jest.mock('react-native',()=>({Text:'NativeText'}));
jest.mock('react-native-reanimated',()=>({
 useSharedValue:(value:unknown)=>React.useRef({value}).current,
 useFrameCallback:(fn:any)=>{mockFrame=fn;return mockFrameControl;},
 runOnJS:(fn:any)=>fn,
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;

test.each([20,25])('only the small %s-foot counter renders when water changes',height=>{
 const fill={value:.5} as any;let tree!:TestRenderer.ReactTestRenderer;let sceneRenders=0;
 function Scene(){sceneRenders++;return React.createElement(TankReadout,{fill,height,kind:'level',entryFraction:.5,active:true,prepared:true,style:{fontSize:24}});}
 act(()=>{tree=TestRenderer.create(React.createElement(Scene));});
 const text=()=>tree.root.findByType('NativeText' as any).props.children;
 expect(text()).toBe(tankReadoutText(.5,height,'level',0,0,'',null));
 fill.value=.73;act(()=>mockFrame({timestamp:0}));
 expect(text()).toBe(tankReadoutText(.73,height,'level',0,0,'',null));
 fill.value=.4;act(()=>mockFrame({timestamp:40}));
 expect(text()).toBe(tankReadoutText(.4,height,'level',0,0,'',null));
 expect(sceneRenders).toBe(1);
 act(()=>tree.unmount());expect(mockFrameControl.setActive).toHaveBeenLastCalledWith(false);
});
test('readout preserves floor inches and exact whole feet',()=>{
 expect(tankReadoutText(.5,20,'level',0,0,'',null)).toBe("10'");
 expect(tankReadoutText(7.499999/20,20,'level',0,0,'',null)).toBe('7\'6"');
 expect(tankReadoutText(1,25,'level',0,0,'',null)).toBe("25'");
});
test('BBL readout uses effective tank capacity and load line with no negative barrels',()=>{
 expect(tankReadoutText(.5,20,'bbl',1.25,40,'bbl',null)).toBe('350 bbl');
 expect(tankReadoutText(0,20,'bbl',1.25,40,'bbl',null)).toBe('0 bbl');
 expect(tankReadoutText(.7,25,'bbl',0,17,'bbl',null)).toBe('298 bbl');
});
test('unavailable stays explicit instead of inventing a numeric level',()=>{
 expect(tankReadoutText(.7,20,'level',0,0,'','Unavailable')).toBe('Unavailable');
 expect(tankReadoutText(.7,20,'bbl',0,40,'bbl','-- bbl')).toBe('-- bbl');
});


test('fractional freshwater level floors inches while barrels round independently',()=>{
 const fraction=11.999/20;
 expect(tankReadoutText(fraction,20,'level',0,40,'bbl',null)).toBe('11\'11"');
 expect(tankReadoutText(fraction,20,'bbl',0,40,'bbl',null)).toBe('480 bbl');
});
