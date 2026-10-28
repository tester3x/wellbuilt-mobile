/** Current window coordinates, independent of launch-time cover-screen dimensions. */
export function tankViewport(width:number,height:number) {
 const columns=width>=600?2:1;
 return {columns,cardWidth:width/columns,viewportHeight:Math.max(1,height)};
}
/** Fit only the space Yoga leaves for the tank, after metadata and controls.
 * Window height includes system bars, navigation and text; it is not a tank budget.
 * No minimum scale: a minimum would overflow a short or resizing window.
 */
export function tankSceneScale(cardWidth:number,slotHeight:number,tankWidth:number,tankHeight:number) {
 if (![cardWidth,slotHeight,tankWidth,tankHeight].every(Number.isFinite) || tankWidth<=0 || tankHeight<=0) return 0;
 return Math.max(0,Math.min(1,(cardWidth-24)/tankWidth,slotHeight/tankHeight));
}
