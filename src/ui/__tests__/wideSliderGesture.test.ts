import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import {runInNewContext} from 'vm';

// Exercise the installed slider's responder and coordinate math, not a replica.
function load(file:string,requireModule:(id:string)=>unknown) {
  const exports:any={};
  runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText,{exports,require:requireModule});
  return exports;
}
class Value {
  constructor(private value:number){}
  setValue(value:number){this.value=value;}
  __getValue(){return this.value;}
}
class Component {
  state:any;constructor(public props:any){}
  setState(update:any,done?:()=>void){Object.assign(this.state,typeof update==='function'?update(this.state):update);done?.();}
}
const native={Animated:{Value},Easing:{inOut:()=>{},ease:()=>{}},I18nManager:{isRTL:false},PanResponder:{create:(handlers:any)=>handlers}};
const root=path.resolve(__dirname,'../../..');
const base=load(path.join(root,'node_modules/@miblanchard/react-native-slider/lib/index.js'),id=>{
 if(id==='react')return {PureComponent:Component};if(id==='react-native')return native;if(id==='./styles')return {defaultStyles:{}};throw Error(id);
});
const {LevelTimeSlider}=load(path.join(root,'components/LevelTimeSlider.tsx'),id=>{
 if(id==='@miblanchard/react-native-slider')return base;throw Error(id);
});

test.each([20,25])('wide %s-foot slider follows continuous drag without a grab jump',height=>{
 const change=jest.fn(),complete=jest.fn();
 const slider=new LevelTimeSlider({...base.Slider.defaultProps,minimumValue:0,maximumValue:height,step:0.01,value:height/2,dragGain:1,trackClickable:false,thumbTouchSize:{width:44,height:54},onValueChange:change,onSlidingComplete:complete});
 slider.state.containerSize={width:244,height:54};slider.state.thumbSize={width:44,height:44};
 slider._handlePanResponderGrant({nativeEvent:{locationX:122,locationY:27}});
 slider._handlePanResponderMove(null,{dx:0,dy:0});
 expect(change.mock.lastCall[0][0]).toBeCloseTo(height/2);
 for(const dx of [5,10,20,40]) {
  slider._handlePanResponderMove(null,{dx,dy:0});
  expect(Math.abs(change.mock.lastCall[0][0]-(height/2+dx/200*height))).toBeLessThanOrEqual(0.0051);
 }
 slider._handlePanResponderEnd(null,{dx:40,dy:0});
 expect(complete.mock.lastCall[0][0]).toBeCloseTo(height*.7);
 expect(slider._handlePanResponderRequestEnd()).toBe(false);
});

test('phone slider retains its existing precision gain',()=>{
 const slider=new LevelTimeSlider({...base.Slider.defaultProps,minimumValue:0,maximumValue:20,value:10,trackClickable:false});
 slider.state.containerSize={width:244,height:54};slider.state.thumbSize={width:44,height:44};
 slider._handlePanResponderGrant({nativeEvent:{locationX:122,locationY:27}});
 expect(slider._getValue({dx:40,dy:0})).toBeCloseTo(11.4);
});
