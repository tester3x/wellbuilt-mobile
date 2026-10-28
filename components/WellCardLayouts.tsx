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

/** Landscape is reserved for tablets and unfolded Folds. */
export function LandscapeWellLayout({tank,statistics,delivery,planning,rootStyle,topStyle}:Panels) {
  return <View testID="landscape-well-layout" style={[rootStyle,{width:'100%',minHeight:0}]}>
    <View style={topStyle}>{tank}{statistics}</View>{delivery}{planning}
  </View>;
}
