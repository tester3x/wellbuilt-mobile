import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {TankReadout,tankReadoutText} from '../TankReadout';
let mockUpdates:Array<()=>{text:string;defaultValue:string}>=[];
jest.mock('react-native',()=>({TextInput:'TextInput',StyleSheet:{create:(s:any)=>s}}));
jest.mock('react-native-reanimated',()=>({
  __esModule:true,default:{createAnimatedComponent:()=> 'NativeReadout'},
  useAnimatedProps:(updater:any)=>{mockUpdates.push(updater);return {};},
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{mockUpdates=[];});

test.each([20,25])('native readout follows %s-foot canonical water without React renders',height=>{
 const fill={value:.5} as any;let tree!:TestRenderer.ReactTestRenderer;
 act(()=>{tree=TestRenderer.create(React.createElement(TankReadout,{fill,height,kind:'level',entryFraction:.5,style:{fontSize:24}}));});
 const update=mockUpdates[0];expect(update().text).toBe(tankReadoutText(.5,height,'level',0,0,'',null));
 fill.value=.73;expect(update().text).toBe(tankReadoutText(.73,height,'level',0,0,'',null));
 expect(mockUpdates).toHaveLength(1); // No React frame publication is needed.
 const input=tree.root.findByType('NativeReadout' as any);
 expect(input.props.editable).toBe(false);expect(input.props.pointerEvents).toBe('none');
 act(()=>tree.unmount());
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
