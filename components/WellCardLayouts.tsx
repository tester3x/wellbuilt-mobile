import React from 'react';
import {View, type StyleProp, type ViewStyle} from 'react-native';

type Panels = {
  tank:React.ReactNode;
  statistics:React.ReactNode;
  delivery:React.ReactNode;
  planning:React.ReactNode;
  rootStyle:StyleProp<ViewStyle>;
  topStyle:StyleProp<ViewStyle>;
};

/** Independent portrait/landscape geometry, stable panel identity during resize. */
export function WellCardLayout({tank,statistics,delivery,planning,rootStyle,topStyle,wideLayout,contentWidth}:Panels & {wideLayout:boolean;contentWidth?:number}) {
  return <View testID={wideLayout?'landscape-well-layout':'portrait-well-layout'} style={[rootStyle,{width:contentWidth ?? '100%',alignSelf:'center',minHeight:0,overflow:'hidden'}]}>
    <View style={[topStyle,(contentWidth!==undefined || !wideLayout) && {flexShrink:1,minHeight:0}]}>{tank}{statistics}</View>{delivery}{planning}
  </View>;
}
