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

/** Original portrait hierarchy: intrinsic tank/statistics above the planner. */
export function PortraitWellLayout({tank,statistics,delivery,planning,rootStyle,topStyle}:Panels) {
  return <View testID="portrait-well-layout" style={[rootStyle,{width:'100%',minHeight:0}]}>
    <View style={topStyle}>{tank}{statistics}</View>{delivery}{planning}
  </View>;
}

/** Landscape owns its layout. Short phones place details beside the tank;
 * taller tablets have enough height for the tank above their details. */
export function LandscapeWellLayout({tank,statistics,delivery,planning,rootStyle,topStyle,compact}:Panels & {compact:boolean}) {
  if(compact) return <View testID="compact-landscape-well-layout" style={[rootStyle,{width:'100%',minHeight:0,flexDirection:'row'}]}>
    <View style={{flex:0.42,minWidth:0,minHeight:0}}>{tank}</View>
    <View style={{flex:0.58,minWidth:0,minHeight:0,justifyContent:'center'}}>{statistics}{delivery}{planning}</View>
  </View>;
  return <View testID="landscape-well-layout" style={[rootStyle,{width:'100%',minHeight:0}]}>
    <View style={topStyle}>{tank}{statistics}</View>{delivery}{planning}
  </View>;
}
