import React from 'react';import TestRenderer,{act} from 'react-test-renderer';import {Accelerometer,DeviceMotion} from 'expo-sensors';import {useTankGravity} from '../useTankGravity';
jest.mock('react-native',()=>({Platform:{OS:'android'}}));
jest.mock('expo-sensors',()=>({Accelerometer:{isAvailableAsync:jest.fn(async()=>true),setUpdateInterval:jest.fn(),addListener:jest.fn(()=>({remove:jest.fn()}))},DeviceMotion:{isAvailableAsync:jest.fn(async()=>true),setUpdateInterval:jest.fn(),addListener:jest.fn(()=>({remove:jest.fn()}))}}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const gravity:any[]=[];function Tank({index}:{index:number}){gravity[index]=useTankGravity(true);return null;}
test('both mounted tank hooks independently listen, remap all display rotations and clean up',async()=>{
 let tree!:TestRenderer.ReactTestRenderer;await act(async()=>{tree=TestRenderer.create(React.createElement(React.Fragment,null,React.createElement(Tank,{index:0}),React.createElement(Tank,{index:1})));});
 expect(Accelerometer.addListener).toHaveBeenCalledTimes(2);expect(DeviceMotion.addListener).toHaveBeenCalledTimes(2);expect(gravity[0]).not.toBe(gravity[1]);
 const accel=(Accelerometer.addListener as jest.Mock).mock.calls.map(c=>c[0]),rotation=(DeviceMotion.addListener as jest.Mock).mock.calls.map(c=>c[0]);
 for(const [angle,x,y]of [[90,1,0],[-90,-1,0],[180,0,-1],[0,0,1]]){
  act(()=>{accel.forEach(f=>f({x,y,z:0}));rotation.forEach(f=>f({orientation:angle}));});
  for(const ref of gravity){expect(ref.current.gx).toBeCloseTo(0);expect(ref.current.gy).toBeCloseTo(1);}
 }
 act(()=>{accel.forEach(f=>f({x:-0.5,y:0.8,z:0}));});expect(gravity[0].current.gx).toBeGreaterThan(0);expect(gravity[1].current.gx).toBeGreaterThan(0);
 await act(async()=>tree.unmount());
 for(const sensor of [Accelerometer,DeviceMotion])for(const result of (sensor.addListener as jest.Mock).mock.results)expect(result.value.remove).toHaveBeenCalledTimes(1);
});
