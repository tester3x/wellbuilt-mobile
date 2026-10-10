import { submergedPosition, floatingPosition, waterDepthAt, fishScatterDirections, roamingFishPosition } from '../fluidWildlife';
import { restingFluidOffsets } from '../fluidSurface';
const width = 180, height = 280;
it.each([0.2, 0.45, 0.85])('keeps the whole fish glyph wet through tilt, sideways and inversion at fill %s', fill => {
  for (const g of [{gx:0,gy:1},{gx:0.7,gy:0.7},{gx:1,gy:0.01},{gx:-1,gy:0.01},{gx:0,gy:-1},{gx:0.7,gy:-0.7}]) {
    const inverted = g.gy < 0;
    const offsets = restingFluidOffsets({gx:g.gx,gy:Math.abs(g.gy)},width,height,fill,16);
    const angle = Math.atan2(-g.gx,g.gy);
    for (const lane of [0.1,0.5,0.9]) for (const travel of [-50,0,50]) {
      const p = submergedPosition(width,height,fill,offsets,inverted,angle,lane,0.65,travel);
      expect(p.opacity).toBe(1);
      const cx = p.left + 9, cy = p.top + 9;
      for (const dx of [-8,-4,0,4,8]) {
        const depth = waterDepthAt(cx+dx,width,height,fill,offsets);
        expect(cy-8).toBeGreaterThanOrEqual((inverted ? 0 : height-depth)-1e-5);
        expect(cy+8).toBeLessThanOrEqual((inverted ? depth : height)+1e-5);
      }
      expect(p.transform[0].rotate).toBe(angle+'rad');
    }
  }
});
it('hides fish when no wet pocket can hold their body', () => {
  expect(submergedPosition(width,height,0,Array(16).fill(0),false,0,0.5,0.5,0).opacity).toBe(0);
});
it('floats the duck on the correct upright/inverted interface and turns it sideways', () => {
  const fill=0.45;
  for (const g of [{gx:0,gy:1},{gx:1,gy:0.01},{gx:0,gy:-1}]) {
    const inverted=g.gy<0, angle=Math.atan2(-g.gx,g.gy);
    const offsets=restingFluidOffsets({gx:g.gx,gy:Math.abs(g.gy)},width,height,fill,16);
    const p=floatingPosition(width,height,fill,offsets,inverted,angle,90,22,7);
    expect(p.opacity).toBe(1);
    expect(p.transform[0].rotate).toBe(angle+'rad');
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.left+22).toBeLessThanOrEqual(width);
    expect(p.top+22).toBeLessThanOrEqual(height);
    if(g.gx===0) expect(p.top+11).toBeCloseTo((inverted?fill*height:height-fill*height)-Math.cos(angle)*7,5);
  }
});

it('nearby touches scatter visible fish away along the tilted swim direction',()=>{
 const fish=[{left:41,top:61,opacity:1},{left:91,top:61,opacity:1}];
 expect(fishScatterDirections(fish,0,0,0)).toBeNull();
 expect(fishScatterDirections(fish.map(p=>({...p,opacity:0})),50,70,0)).toBeNull();
 expect(fishScatterDirections(fish,60,70,0)!.map(d=>d.travel)).toEqual([-1,1]);
 expect(fishScatterDirections([{left:41,top:31,opacity:1},{left:41,top:91,opacity:1}],50,50,Math.PI/2)!.map(d=>d.travel)).toEqual([-1,1]);
});
it('scatter excursions remain submerged at upright, sideways and inverted orientations',()=>{
 for(const g of [{gx:0,gy:1},{gx:1,gy:0.01},{gx:0,gy:-1}]){
  const fill=0.45,inverted=g.gy<0,angle=Math.atan2(-g.gx,g.gy);
  const offsets=restingFluidOffsets({gx:g.gx,gy:Math.abs(g.gy)},width,height,fill,16);
  for(const escape of [-1,1]){
   const p=submergedPosition(width,height,fill,offsets,inverted,angle,0.5,0.65+escape*0.18,escape*width*0.3);
   const cx=p.left+9,cy=p.top+9;
   for(const dx of [-8,0,8]){const water=waterDepthAt(cx+dx,width,height,fill,offsets);
    expect(cy-8).toBeGreaterThanOrEqual((inverted?0:height-water)-1e-5);
    expect(cy+8).toBeLessThanOrEqual((inverted?water:height)+1e-5);}
  }
 }
});

it.each([0.25,0.5,0.85])('fish cover the full upright wet pocket at fill %s',fill=>{
 const fish={freq:1,phase:0.7,leftPct:20,topPct:60};const points=[];
 for(let i=0;i<=120;i++){
  const p=roamingFishPosition(width,height,fill,Array(16).fill(0),false,0,i/120,fish,{travel:0,depth:0},0);
  points.push({x:p.left+9,y:p.top+9});
  expect(p.opacity).toBe(1);expect(p.top).toBeGreaterThanOrEqual(height-fill*height-1e-5);expect(p.top+18).toBeLessThanOrEqual(height+1e-5);
 }
 const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
 expect(Math.max(...xs)-Math.min(...xs)).toBeGreaterThan((width-18)*0.9);
 expect(Math.max(...ys)-Math.min(...ys)).toBeGreaterThan((fill*height-18)*0.8);
 const a=roamingFishPosition(width,height,fill,Array(16).fill(0),false,0,0,fish,{travel:0,depth:0},0);
 const b=roamingFishPosition(width,height,fill,Array(16).fill(0),false,0,1,fish,{travel:0,depth:0},0);
 expect(a.left).toBeCloseTo(b.left);expect(a.top).toBeCloseTo(b.top);
});

it('exact fish touches send fish away from a wall rather than pinning them against it',()=>{
 expect(fishScatterDirections([{left:0,top:240,opacity:1}],9,249,0)![0]).toEqual({travel:1,depth:-0.18});
 expect(fishScatterDirections([{left:162,top:240,opacity:1}],171,249,0)![0]).toEqual({travel:-1,depth:-0.18});
});

test('inverted fish face their horizontal travel and scatter keeps its local direction', () => {
  const { roamingFishFacing } = require('../fluidWildlife');
  const fish = { freq: 1, phase: 0 };
  const escape = { travel: 1 };
  expect(roamingFishFacing(180,280,0.6,false,0,0,fish,escape,0)).toBe(-1);
  expect(roamingFishFacing(180,280,0.6,true,Math.PI,0,fish,escape,0)).toBe(1);
  expect(roamingFishFacing(180,280,0.6,false,0,0.5,fish,escape,0)).toBe(1);
  expect(roamingFishFacing(180,280,0.6,true,Math.PI,0.5,fish,escape,0)).toBe(-1);
  expect(roamingFishFacing(180,280,0.6,true,Math.PI,0,fish,escape,1)).toBe(-1);
});
