import React from 'react';
import {View} from 'react-native';
import {wellContentWidth} from '../src/ui/wellContentFrame';

/** Keep the data-bearing well at the same React/native depth across rotation. */
export function WellPagerCard({width,wideLayout,header,children,onFocus}:{
  width:number;wideLayout:boolean;header?:React.ReactNode;children:React.ReactNode;onFocus?:()=>void;
}) {
  return <View style={{width,flex:1,minHeight:0}} onTouchStart={wideLayout?onFocus:undefined}>
    <View style={{display:wideLayout?'flex':'none',width:wellContentWidth(width),alignSelf:'center'}}>{header}</View>
    <View style={{flex:1,minHeight:0}}>{children}</View>
  </View>;
}
