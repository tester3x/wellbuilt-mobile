/** Current window coordinates, independent of launch-time cover-screen dimensions. */
export function tankViewport(width:number,height:number) {
 const columns=width>=600?2:1;
 return {columns,cardWidth:width/columns,viewportHeight:Math.max(1,height)};
}
export function tankSceneScale(cardWidth:number,viewportHeight:number,tankWidth:number,tankHeight:number) {
 return Math.max(0.1,Math.min(1,(cardWidth-24)/tankWidth,Math.max(160,viewportHeight*0.46)/tankHeight));
}
