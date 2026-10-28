import React from 'react';
import {Pressable, Text, View, type TextStyle, type ViewStyle} from 'react-native';

type Props = {
  afrDaily:number;
  overnightDaily?:number;
  estimated?:boolean;
  freshwater?:boolean;
  consumptionDaily?:number|null;
  showOvernight:boolean;
  onToggle:()=>void;
  styles:{statsRow:ViewStyle;statLeft:TextStyle;statRight:TextStyle;statDivider:TextStyle};
  hourUnit:string;
  dayUnit:string;
  accessibilityLabel:string;
  lockedHint:string;
};

/** Every card uses the same parent-owned ON preference, with explicit fallback. */
export function ProductionRateRow(props:Props) {
  const {afrDaily,overnightDaily,estimated,freshwater,consumptionDaily,showOvernight,onToggle,styles}=props;
  const available=!freshwater && Number.isFinite(overnightDaily) && (overnightDaily ?? 0)>0;
  const daily=freshwater ? consumptionDaily ?? null : showOvernight && available ? overnightDaily! : afrDaily;
  const hourly=daily==null ? '--' : freshwater ? (daily/24).toFixed(1) : Math.round(daily/24*10)/10;
  const suffix=!available ? ' 🔒' : showOvernight ? (estimated ? ' ON ≈' : ' ON') : '';
  return <Pressable testID="production-rate-toggle" accessibilityRole="button"
    accessibilityLabel={props.accessibilityLabel}
    accessibilityHint={!available ? props.lockedHint : undefined}
    onPress={onToggle} style={{alignSelf:'stretch',width:'100%'}}>
    <View style={styles.statsRow}>
      <Text style={styles.statLeft}>{hourly} {props.hourUnit}</Text>
      <Text style={styles.statDivider}>•</Text>
      <Text style={styles.statRight}>{daily ?? '--'} {props.dayUnit}{suffix}</Text>
    </View>
  </Pressable>;
}
