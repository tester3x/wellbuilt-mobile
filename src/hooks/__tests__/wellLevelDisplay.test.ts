import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {useWellLevelDisplay} from '../useWellLevelDisplay';
let mockFrameCallback:(info:{timestamp:number})=>void;
const mockFrame={setActive:jest.fn()};
jest.mock('react-native-reanimated',()=>({
  useSharedValue:(value:unknown)=>React.useRef({value}).current,
  useFrameCallback:(callback:any)=>{mockFrameCallback=callback;return mockFrame;},
  runOnJS:(fn:any)=>fn,
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
test('samples visible labels at 30Hz, delivers the final level, stops offscreen work',()=>{
  const fill={value:0.2} as any;
  const shown:number[]=[];
  function Tank({active}:{active:boolean}){shown.push(useWellLevelDisplay(fill,20,active));return null;}
  let tree!:TestRenderer.ReactTestRenderer;
  act(()=>{tree=TestRenderer.create(React.createElement(Tank,{active:true}));});
  act(()=>mockFrameCallback({timestamp:0}));
  const subscribed=mockFrameCallback!;
  expect(shown.at(-1)).toBe(4);
  fill.value=0.4;act(()=>mockFrameCallback({timestamp:16}));
  expect(shown.at(-1)).toBe(4);
  act(()=>mockFrameCallback({timestamp:34}));expect(shown.at(-1)).toBe(8);
  expect(mockFrameCallback!).toBe(subscribed); // No native re-registration per React label render.
  fill.value=0.4137;act(()=>mockFrameCallback({timestamp:50}));
  act(()=>mockFrameCallback({timestamp:68}));expect(shown.at(-1)).toBeCloseTo(8.274);
  const renders=shown.length;act(()=>mockFrameCallback({timestamp:102}));expect(shown).toHaveLength(renders);
  act(()=>tree.update(React.createElement(Tank,{active:false})));
  expect(mockFrame.setActive).toHaveBeenLastCalledWith(false);
  act(()=>tree.unmount());expect(mockFrame.setActive).toHaveBeenLastCalledWith(false);
});
