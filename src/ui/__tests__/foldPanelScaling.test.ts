import React,{useContext,useEffect} from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {WellPagerCard,WellPanelScaleContext} from '../../../components/WellPagerCard';
import {foldPanelFit} from '../wellContentFrame';
jest.mock('react-native',()=>({View:'View'}));
jest.mock('../wellContentFrame',()=>({...jest.requireActual('../wellContentFrame'),foldablePhoneLayout:true}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;

test('Fold header, tank, information and controls share one fitted panel without remounting',()=>{
 const mounts=jest.fn(),unmounts=jest.fn();
 function Body(){const scale=useContext(WellPanelScaleContext);useEffect(()=>{mounts();return unmounts;},[]);return React.createElement('body',{scale},['tank','information','slider'].map(name=>React.createElement(name,{key:name})));}
 const render=(width:number,wide:boolean)=>React.createElement(WellPagerCard,{width,wideLayout:wide,header:React.createElement('header'),children:React.createElement(Body)});
 let tree!:TestRenderer.ReactTestRenderer;
 act(()=>{tree=TestRenderer.create(render(750,false));});
 for(const [width,height,wide] of [[750,800,false],[750,650,false],[416,570,true],[416,630,true],[750,650,false]] as const){
  act(()=>tree.update(render(width,wide)));
  const host=tree.root.findAllByType('View' as any).find(node=>node.props.onLayout)!;
  act(()=>host.props.onLayout({nativeEvent:{layout:{width,height}}}));
  const panel=tree.root.findByProps({testID:'well-phone-panel'}),fit=foldPanelFit(width,height,wide);
  expect(panel.props.style).toMatchObject({width:412,height:fit.height,transform:[{scale:fit.scale}],opacity:1});
  expect(tree.root.findByType('body' as any).props.scale).toBe(fit.scale);
  for(const name of ['header','tank','information','slider'])expect(panel.findAllByType(name as any)).toHaveLength(1);
  expect(tree.root.findAllByType('ScrollView' as any)).toHaveLength(0);
  expect(mounts).toHaveBeenCalledTimes(1);expect(unmounts).not.toHaveBeenCalled();
 }
 act(()=>tree.unmount());expect(unmounts).toHaveBeenCalledTimes(1);
});

test('Fold cover keeps the ordinary unscaled layout',()=>{
 let tree!:TestRenderer.ReactTestRenderer;
 act(()=>{tree=TestRenderer.create(React.createElement(WellPagerCard,{width:412,wideLayout:false,children:React.createElement('cover')}));});
 expect(tree.root.findByProps({testID:'well-phone-panel'}).props.style).toEqual({flex:1,minHeight:0});
 act(()=>tree.unmount());
});
