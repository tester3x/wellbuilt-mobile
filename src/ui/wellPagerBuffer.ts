/** RN can observe the old pixel offset after getItemLayout has the new widths.
 * Keep the bridge between those two positions mounted. A fixed three-viewport
 * window can evict the selected cards, even when JS selection never changes.
 * Include both orientations before rotating, rather than adding a buffer after
 * the cells have already disappeared. Fold/cover changes also retain prior widths.
 */
export function wellPagerBuffer(index:number,count:number,width:number,height:number,previousWidths:{min:number;max:number}) {
  const short=Math.min(width,height);
  const long=Math.max(width,height);
  const cardWidths=[short,long>=600?long/2:short,previousWidths.min,previousWidths.max];
  const min=Math.max(1,Math.min(...cardWidths));
  const max=Math.max(...cardWidths);
  // In card units this bounds the displacement in either direction, including
  // a stale two-card viewport and the next card that landscape must reveal.
  const bridge=Math.min(count,Math.ceil(Math.max(0,index)*(max/min-1))+4);
  // RN expands both ends of the render window in one batch. Reserve both sides
  // of the bridge so it cannot exhaust the batch before reaching retained cells.
  const batch=index*max/min>=count?count:Math.min(count,2*bridge+4);
  return {widths:{min,max},windowSize:2*bridge+1,maxToRenderPerBatch:Math.max(2,batch)};
}
