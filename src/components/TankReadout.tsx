import React from 'react';
import { TextInput, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import Animated, { useAnimatedProps, type SharedValue } from 'react-native-reanimated';

const AnimatedReadout = Animated.createAnimatedComponent(TextInput);

export function tankReadoutText(fraction: number, height: number, kind: 'level'|'bbl', loadLine: number, bblPerFoot: number, unit: string, unavailable: string | null): string {
  'worklet';
  if (unavailable !== null) return unavailable;
  const feet = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * height;
  if (kind === 'bbl') return Math.max(0, Math.round((feet-loadLine)*bblPerFoot)) + ' ' + unit;
  const total = Math.floor(feet*12+0.0001), inches = total%12;
  return Math.floor(total/12) + "'" + (inches ? inches + '"' : '');
}

/** Read-only native text follows the same UI value as the water, with no JS frame queue. */
export const TankReadout = React.memo(function TankReadout({fill,height,kind,loadLine=0,bblPerFoot=0,unit='',unavailable=null,entryFraction,style}: {
  fill: SharedValue<number>; height: number; kind: 'level'|'bbl'; loadLine?: number; bblPerFoot?: number;
  unit?: string; unavailable?: string|null; entryFraction: number; style: StyleProp<TextStyle>;
}) {
  const animatedProps = useAnimatedProps(() => {
    const text = tankReadoutText(fill.value,height,kind,loadLine,bblPerFoot,unit,unavailable);
    return {text,defaultValue:text};
  });
  return <AnimatedReadout animatedProps={animatedProps}
    defaultValue={tankReadoutText(entryFraction,height,kind,loadLine,bblPerFoot,unit,unavailable)}
    editable={false} caretHidden showSoftInputOnFocus={false} pointerEvents="none"
    underlineColorAndroid="transparent" style={[style,styles.text]} />;
});
const styles=StyleSheet.create({text:{width:'100%',padding:0,margin:0,textAlign:'center',includeFontPadding:false}});
