import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { type SharedValue } from 'react-native-reanimated';
import { useWellLevelDisplay } from '../hooks/useWellLevelDisplay';

export function tankReadoutText(fraction: number, height: number, kind: 'level'|'bbl', loadLine: number, bblPerFoot: number, unit: string, unavailable: string | null): string {
  'worklet';
  if (unavailable !== null) return unavailable;
  const feet = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * height;
  if (kind === 'bbl') return Math.max(0, Math.round((feet-loadLine)*bblPerFoot)) + ' ' + unit;
  const total = Math.floor(feet*12+0.0001), inches = total%12;
  return Math.floor(total/12) + "'" + (inches ? inches + '"' : '');
}

/** Only this small counter re-renders on samples; the tank scene and its physics stay untouched. */
export const TankReadout = React.memo(function TankReadout({fill,height,kind,loadLine=0,bblPerFoot=0,unit='',unavailable=null,entryFraction,active,prepared,style}: {
  fill: SharedValue<number>; height: number; kind: 'level'|'bbl'; loadLine?: number; bblPerFoot?: number;
  unit?: string; unavailable?: string|null; entryFraction: number; active: boolean; prepared: boolean; style: StyleProp<TextStyle>;
}) {
  const feet=useWellLevelDisplay(fill,height,active,entryFraction,prepared);
  return <Text pointerEvents="none" style={style}>{tankReadoutText(feet/height,height,kind,loadLine,bblPerFoot,unit,unavailable)}</Text>;
});
