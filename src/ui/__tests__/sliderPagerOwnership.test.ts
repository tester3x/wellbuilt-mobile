import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import {runInNewContext} from 'vm';

const file=path.resolve(__dirname,'../../../app/(tabs)/index.tsx');
const source=fs.readFileSync(file,'utf8');
const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function execute(text:string,scope:object) {
  return runInNewContext(ts.transpileModule('('+text+')',{
    compilerOptions:{target:ts.ScriptTarget.ES2020},
  }).outputText,scope);
}
function handler(name:string,scope:object) {
  let callback='';
  function visit(node:ts.Node) {
    if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)callback=(node.initializer as ts.CallExpression).arguments[0].getText(ast);
    ts.forEachChild(node,visit);
  }
  visit(ast);if(!callback)throw Error(name);return execute(callback,scope);
}
let releaseEffect='';
function findEffect(node:ts.Node) {
  if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('if (!isActive || sliderLocked || wellDown)'))releaseEffect=node.arguments[0].getText(ast);
  ts.forEachChild(node,findEffect);
}
findEffect(ast);

const dragState = () => ({
  sliderEditRevision: {current: 0}, sliderDragBasis: {current: null},
  displayFeet: 8, getBblPerFootSync: () => 20,
});

test('a level refresh does not change snap points in an active drag', () => {
  const scope = {
    ...dragState(), isActive: true, sliderLocked: false, wellDown: false,
    sliderDraggingRef: {current: false}, sliderLockTimerRef: {current: null},
    activateSliderUI: jest.fn(), resetSliderLockTimer: jest.fn(),
    onSliderActiveChange: jest.fn(), wellName: 'Test well',
    wellConfig: {}, tankHeightFeet: 20, setSliderFeet: jest.fn(),
    saveSliderPosition: jest.fn(),
  };
  handler('handleSliderStart', scope)();
  scope.displayFeet = 3.9;
  handler('handleSliderChange', scope)(7.6);
  expect(scope.setSliderFeet).toHaveBeenLastCalledWith(7.5);
  handler('handleSliderEnd', scope)();
  handler('handleSliderChange', scope)(7.6);
  expect(scope.setSliderFeet).toHaveBeenLastCalledWith(7.5);
  handler('handleSliderChange', scope)(7.625);
  expect(scope.setSliderFeet).toHaveBeenLastCalledWith(7.75);
});


test('unlocking both landscape cards leaves paging enabled; dragging claims only its own well',()=>{
  const claims=new Set<string>();
  const onSliderActiveChange=(active:boolean,well:string)=>active?claims.add(well):claims.delete(well);
  const scope=(wellName:string)=>({...dragState(),wideLayout:true,isActive:true,sliderLocked:false,wellDown:false,wellName,onSliderActiveChange,activateSliderUI:jest.fn(),sliderDraggingRef:{current:false},sliderLockTimerRef:{current:null},resetSliderLockTimer:jest.fn(),clearTimeout:jest.fn()});
  const left=scope('Left'),right=scope('Right');
  const cleanupLeft=execute(releaseEffect,left)(),cleanupRight=execute(releaseEffect,right)();
  expect(claims.size).toBe(0); // unlocked on both sides, no gesture
  handler('handleSliderStart',left)();expect([...claims]).toEqual(['Left']);
  handler('handleSliderEnd',left)();expect(claims.size).toBe(0);
  handler('handleSliderStart',left)();handler('handleSliderStart',right)();
  handler('handleSliderEnd',left)();expect([...claims]).toEqual(['Right']);
  cleanupRight();expect(claims.size).toBe(0);cleanupLeft();
});

test.each([{isActive:false},{sliderLocked:true},{wellDown:true}])('unavailable card releases a drag claim: %j',state=>{
  const change=jest.fn();
  execute(releaseEffect,{isActive:true,sliderLocked:false,wellDown:false,wellName:'Left',onSliderActiveChange:change,...state})();
  expect(change).toHaveBeenCalledWith(false,'Left');
});


test('holds the slider unlocked throughout a drag and relocks five seconds after release', () => {
  jest.useFakeTimers();
  try {
    const setSliderLocked = jest.fn();
    const scope = {
      ...dragState(),
      sliderDraggingRef: {current: false}, sliderLockTimerRef: {current: null},
      clearTimeout, setTimeout, SLIDER_LOCK_DELAY: 5000, setSliderLocked,
      setSliderPeeking: jest.fn(), setSliderUIActive: jest.fn(),
      sliderOpacity: {value: 1}, withTiming: (value: number) => value,
      activateSliderUI: jest.fn(), wellName: 'Test well', onSliderActiveChange: jest.fn(),
      resetSliderLockTimer: () => reset(),
    };
    const reset = handler('resetSliderLockTimer', scope);
    reset();
    jest.advanceTimersByTime(4000);
    handler('handleSliderStart', scope)();
    jest.advanceTimersByTime(9000);
    expect(setSliderLocked).not.toHaveBeenCalled();
    handler('handleSliderEnd', scope)();
    jest.advanceTimersByTime(4999);
    expect(setSliderLocked).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(setSliderLocked).toHaveBeenCalledWith(true);
  } finally {
    jest.useRealTimers();
  }
});
