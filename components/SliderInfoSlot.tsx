import React,{useState} from 'react';
import {View,type StyleProp,type ViewStyle} from 'react-native';

/** Measure both states from the start. Switching the visible state cannot
 * introduce a taller label stack and move the slider below it. */
export function SliderInfoSlot({primary,secondary,showPrimary,style}:{
  primary:React.ReactNode;secondary:React.ReactNode;showPrimary:boolean;style?:StyleProp<ViewStyle>;
}) {
  const [height,setHeight]=useState(64);
  const measure=(event:{nativeEvent:{layout:{height:number}}})=>{
    const measured=Math.ceil(event.nativeEvent.layout.height);
    setHeight(previous=>Math.max(previous,measured));
  };
  return <View testID="slider-info-slot" style={[style,{width:'100%',height,flexShrink:0}]}>
    {[{content:primary,visible:showPrimary,id:'next-load'},{content:secondary,visible:!showPrimary,id:'selected-level'}].map(panel=>
      <View key={panel.id} pointerEvents="none" accessibilityElementsHidden={!panel.visible}
        importantForAccessibility={panel.visible?'auto':'no-hide-descendants'}
        style={{position:'absolute',top:0,bottom:0,left:0,right:0,justifyContent:'center',opacity:panel.visible?1:0}}>
        <View testID={'slider-info-'+panel.id} onLayout={measure} style={{alignItems:'center',width:'100%'}}>{panel.content}</View>
      </View>
    )}
  </View>;
}
