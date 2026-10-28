/** Current window coordinates, independent of launch-time cover-screen dimensions. */
export function tankViewport(width:number,height:number) {
 // Portrait always retains the original single-well layout, including unfolded Folds.
 // The independent two-card layout is reserved for landscape.
 const columns=width>=600 && width>height?2:1;
 return {columns,cardWidth:width/columns,viewportHeight:Math.max(1,height)};
}
/** Fit only the space Yoga leaves for the tank, after metadata and controls.
 * Window height includes system bars, navigation and text; it is not a tank budget.
 * No minimum scale: a minimum would overflow a short or resizing window.
 */
export function tankSceneScale(cardWidth:number,slotHeight:number,tankWidth:number,tankHeight:number,allowUpscale=false) {
 if (![cardWidth,slotHeight,tankWidth,tankHeight].every(Number.isFinite) || tankWidth<=0 || tankHeight<=0) return 0;
 return Math.max(0,Math.min(allowUpscale?Infinity:1,(cardWidth-24)/tankWidth,slotHeight/tankHeight));
}
