/** Extra screen width belongs outside the phone layout, not inside its text,
 * tank or slider. The same frame is centered in one column or each of two.
 */
const native=require('../../modules/wellbuilt-platform');
// A hinge capability is stable across launch posture and rotation; a wide
// current window alone cannot distinguish a Fold from a real tablet.
export const foldablePhoneLayout=native?.isFoldable===true;

export function wellContentWidth(columnWidth:number,foldable=foldablePhoneLayout) {
  return foldable ? Math.min(columnWidth,412) : columnWidth;
}

// One logical phone panel. Fit the complete subtree, never just the tank slot.
export const FOLD_PANEL_WIDTH=412;
export const FOLD_BODY_HEIGHT=700;
export const FOLD_HEADER_HEIGHT=80;
export function foldPanelFit(width:number,height:number,wideLayout:boolean) {
  const logicalHeight=FOLD_BODY_HEIGHT+(wideLayout?FOLD_HEADER_HEIGHT:0);
  const scale=Number.isFinite(width)&&Number.isFinite(height)
    ? Math.max(0,Math.min(1,width/FOLD_PANEL_WIDTH,height/logicalHeight)) : 0;
  return {width:FOLD_PANEL_WIDTH,height:logicalHeight,scale};
}

/** Preserve the working cover screen; only the unfolded Fold needs fitting. */
export function usesFoldPanel(columnWidth:number,wideLayout:boolean,foldable=foldablePhoneLayout) {
  return foldable && (wideLayout || columnWidth>=600);
}
