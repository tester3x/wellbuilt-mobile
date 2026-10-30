/** Extra cells bridge old/new native offsets ONLY while geometry is changing.
 * Stable browsing must not retain an index-sized catalogue of heavy tank scenes. */
export function wellPagerBuffer(index:number,count:number,width:number,height:number,previousWidths:{min:number;max:number},resizing=false) {
  const columns=width>=600 && width>height?2:1;
  const currentWidth=Math.max(1,width/columns);
  if(!resizing)return {widths:{min:currentWidth,max:currentWidth},windowSize:3,maxToRenderPerBatch:Math.max(2,columns*2)};
  const min=Math.max(1,Math.min(currentWidth,previousWidths.min));
  const max=Math.max(currentWidth,previousWidths.max);
  const bridge=Math.min(count,Math.ceil(Math.max(0,index)*(max/min-1))+4);
  const batch=index*max/min>=count?count:Math.min(count,2*bridge+4);
  return {widths:{min,max},windowSize:2*bridge+1,maxToRenderPerBatch:Math.max(2,batch)};
}
