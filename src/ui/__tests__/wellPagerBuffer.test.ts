import {readFileSync} from 'fs';
import {join} from 'path';
import {runInNewContext} from 'vm';
import {wellPagerBuffer} from '../wellPagerBuffer';

// Exercise the installed RN window algorithm, not an imitation of the buffer.
const filename=require.resolve('react-native/node_modules/@react-native/virtualized-lists/Lists/VirtualizeUtils');
const transformed=require('@babel/core').transformSync(readFileSync(filename,'utf8'),{
  filename,babelrc:false,configFile:false,presets:['module:@react-native/babel-preset'],
}).code;
const nativeExports:any={};
runInNewContext(transformed,{exports:nativeExports,require:(id:string)=>id.includes('ReactNativeFeatureFlags')?{fixVirtualizeListCollapseWindowSize:()=>false}:require(id)});
const compute=nativeExports.computeWindowedRenderLimits;

function resizedRange(index:number,count:number,oldWidth:number,newWidth:number,visibleLength:number,windowSize:number,batch:number) {
  return compute({data:Array(count),getItemCount:(data:any[])=>data.length},batch,windowSize,
    {first:Math.max(0,index-2),last:Math.min(count-1,index+3)},
    {getCellMetricsApprox:(i:number)=>({offset:i*newWidth,length:newWidth,index:i})},
    {offset:index*oldWidth,visibleLength,velocity:0,dt:16,zoomScale:1});
}

test('reproduces the selected-card eviction with the old three-viewport buffer',()=>{
  const range=resizedRange(12,24,876,700,1400,3,2);
  expect(range.first).toBeGreaterThan(12);
});

test.each([
  ['tablet',876,1400],['Fold',748,830],['tablet with taskbar',800,1280],
] as const)('%s retains both selected cards through every stale-offset resize',(_,short,long)=>{
  for(const count of [1,24,100]) {
    for(let index=0;index<count;index++) {
      let widths:{min:number;max:number}={min:short,max:short};
      for(const [width,height,oldCard,newCard] of [
        [short,long,long/2,short],[long,short,short,long/2],
        [short,long,long/2,short],[long,short,short,long/2],
      ]) {
        const buffer=wellPagerBuffer(index,count,width,height,widths);
        widths=buffer.widths;
        for(const visibleLength of [short,long]) {
          const range=resizedRange(index,count,oldCard,newCard,visibleLength,buffer.windowSize,buffer.maxToRenderPerBatch);
          expect(range.first).toBeLessThanOrEqual(index);
          expect(range.last).toBeGreaterThanOrEqual(Math.min(count-1,index+1));
        }
      }
    }
  }
});

test('cover-to-open changes retain the previous width range, with bounded batches',()=>{
  const cover=wellPagerBuffer(12,24,384,900,{min:384,max:384});
  const open=wellPagerBuffer(12,24,830,748,cover.widths);
  expect(open.widths.min).toBe(384);
  expect(open.maxToRenderPerBatch).toBeLessThanOrEqual(24);
  const range=resizedRange(12,24,384,415,830,open.windowSize,open.maxToRenderPerBatch);
  expect(range.first).toBeLessThanOrEqual(12);
  expect(range.last).toBeGreaterThanOrEqual(13);
});

test('home pager consumes the bounded buffer without changing card identity or enabling vertical scroll',()=>{
  const source=readFileSync(join(__dirname,'../../../app/(tabs)/index.tsx'),'utf8');
  expect(source).toContain('windowSize={pagerBuffer.windowSize}');
  expect(source).toContain('maxToRenderPerBatch={pagerBuffer.maxToRenderPerBatch}');
  expect(source).toContain('keyExtractor={(item) => item}');
  expect(source).toContain('removeClippedSubviews={false}');
});
