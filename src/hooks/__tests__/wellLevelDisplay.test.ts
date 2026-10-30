import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {useWellLevelDisplay} from '../useWellLevelDisplay';
let mockFrameCallback:(info:{timestamp:number})=>void;
const mockFrame={setActive:jest.fn()};
let mockDefer=false;
let mockQueue:Array<()=>void>=[];
jest.mock('react-native-reanimated',()=>({
  useSharedValue:(value:unknown)=>React.useRef({value}).current,
  useFrameCallback:(callback:any)=>{mockFrameCallback=callback;return mockFrame;},
  runOnJS:(fn:any)=>(...args:any[])=>mockDefer?mockQueue.push(()=>fn(...args)):fn(...args),
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>{mockDefer=false;mockQueue=[];});

test('the staged label uses the captured seed even before the queued UI write runs',()=>{
  const fill={value:0} as any;let shown=0;
  function Tank({seed,active=false}:{seed:number;active?:boolean}){
    shown=useWellLevelDisplay(fill,20,active,seed);return null;
  }
  let tree!:TestRenderer.ReactTestRenderer;
  // Reanimated applies the transition owner's JS assignment on a later UI task.
  // Reading fill here still returns0 even though the queued assignment is.73.
  act(()=>{tree=TestRenderer.create(React.createElement(Tank,{seed:.73}));});
  expect(shown).toBeCloseTo(14.6);
  act(()=>tree.update(React.createElement(Tank,{seed:.73,active:true})));
  expect(shown).toBeCloseTo(14.6);
  fill.value=.73;
  act(()=>mockFrameCallback({timestamp:0}));
  expect(shown).toBeCloseTo(14.6);
  // Next gesture queues.27 while a synchronous getter still sees the old.73.
  act(()=>tree.update(React.createElement(Tank,{seed:.27})));
  expect(shown).toBeCloseTo(5.4);
  act(()=>tree.unmount());
});
test('samples visible labels at 30Hz, delivers the final level, stops offscreen work',()=>{
  const fill={value:0.2} as any;
  const shown:number[]=[];
  function Tank({active}:{active:boolean}){shown.push(useWellLevelDisplay(fill,20,active,.2));return null;}
  let tree!:TestRenderer.ReactTestRenderer;
  act(()=>{tree=TestRenderer.create(React.createElement(Tank,{active:true}));});
  expect(shown.at(-1)).toBe(4); // First paint cannot wait for the frame sampler.
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

test('a queued sample from the previous visit cannot overwrite the new staged label',()=>{
  const fill={value:.2} as any;let shown=0;
  function Tank({active,seed}:{active:boolean;seed:number}){
    shown=useWellLevelDisplay(fill,20,active,seed);return null;
  }
  let tree!:TestRenderer.ReactTestRenderer;
  act(()=>{tree=TestRenderer.create(React.createElement(Tank,{active:true,seed:.2}));});
  mockDefer=true;
  act(()=>mockFrameCallback({timestamp:0}));
  fill.value=.73;
  act(()=>tree.update(React.createElement(Tank,{active:false,seed:.73})));
  expect(shown).toBeCloseTo(14.6);
  act(()=>{mockQueue.splice(0).forEach(deliver=>deliver());});
  expect(shown).toBeCloseTo(14.6);
  act(()=>tree.update(React.createElement(Tank,{active:true,seed:.73})));
  fill.value=.8;
  act(()=>mockFrameCallback({timestamp:34}));
  act(()=>{mockQueue.splice(0).forEach(deliver=>deliver());});
  expect(shown).toBe(16);
  act(()=>tree.unmount());
});

test('an offscreen card publishes its staged fill on activation before any frame callback',()=>{
  const fill={value:0} as any;
  const shown:number[]=[];
  function Tank({active,height=20,entryFraction=0}:{active:boolean;height?:number;entryFraction?:number}){
    shown.push(useWellLevelDisplay(fill,height,active,entryFraction));return null;
  }
  let tree!:TestRenderer.ReactTestRenderer;
  act(()=>{tree=TestRenderer.create(React.createElement(Tank,{active:false}));});
  fill.value=.73; // Transition owner stages departing water while offscreen.
  act(()=>tree.update(React.createElement(Tank,{active:false,entryFraction:.73})));
  expect(shown.at(-1)).toBeCloseTo(14.6); // Visible edge of an incoming card.
  act(()=>tree.update(React.createElement(Tank,{active:true,entryFraction:.73})));
  expect(shown.at(-1)).toBeCloseTo(14.6);
  act(()=>tree.update(React.createElement(Tank,{active:false})));
  fill.value=.27;
  act(()=>tree.update(React.createElement(Tank,{active:true,height:25,entryFraction:.27})));
  expect(shown.at(-1)).toBeCloseTo(6.75);
  act(()=>tree.unmount());
});


test('a busy JS thread receives one latest-value delivery instead of a backlog of old frames',()=>{
  const fill={value:.2} as any;let shown=0;
  function Tank(){shown=useWellLevelDisplay(fill,20,true,.2);return null;}
  let tree!:TestRenderer.ReactTestRenderer;
  act(()=>{tree=TestRenderer.create(React.createElement(Tank));});
  mockDefer=true;
  act(()=>mockFrameCallback({timestamp:0}));
  fill.value=.4;act(()=>mockFrameCallback({timestamp:40}));
  fill.value=.7;act(()=>mockFrameCallback({timestamp:80}));
  expect(mockQueue).toHaveLength(1);
  act(()=>{mockQueue.splice(0).forEach(deliver=>deliver());});
  expect(shown).toBe(14);
  fill.value=.75;act(()=>mockFrameCallback({timestamp:120}));
  expect(mockQueue).toHaveLength(1);
  act(()=>{mockQueue.splice(0).forEach(deliver=>deliver());});
  expect(shown).toBe(15);
  act(()=>tree.unmount());
});
