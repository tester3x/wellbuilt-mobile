/** Overlap by two rendered pixels, including when the whole scene is scaled.
 * A fractional unscaled overlap leaves dark rasterization seams on foldables.
 */
export function waterColumnBounds(index:number,count:number,width:number,renderScale:number,pixelRatio:number) {
  const pixelsPerUnit=Math.max(0.01,renderScale*pixelRatio);
  const left=Math.floor(index*width/count*pixelsPerUnit)/pixelsPerUnit;
  const right=(Math.ceil((index+1)*width/count*pixelsPerUnit)+2)/pixelsPerUnit;
  return {left,width:right-left};
}
