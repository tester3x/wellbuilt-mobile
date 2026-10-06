import { submergedPosition, floatingPosition, waterDepthAt } from '../fluidWildlife';
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
