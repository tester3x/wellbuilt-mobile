import {waterColumnBounds} from '../waterColumns';

test.each([[0.2,2],[0.42,2.625],[0.7,3],[1,3]])('water strips overlap after rasterization at scene scale %s and density %s',(scale,density)=>{
  const columns=Array.from({length:64},(_,i)=>waterColumnBounds(i,64,173.41,scale,density));
  expect(columns[0].left).toBe(0);
  for(let i=0;i<columns.length-1;i++) {
    const right=(columns[i].left+columns[i].width)*scale*density;
    const nextLeft=columns[i+1].left*scale*density;
    expect(right-nextLeft).toBeGreaterThanOrEqual(1.9999);
  }
  expect(columns[63].left+columns[63].width).toBeGreaterThanOrEqual(173.41);
});
