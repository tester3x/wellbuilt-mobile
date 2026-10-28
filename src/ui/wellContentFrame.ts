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
