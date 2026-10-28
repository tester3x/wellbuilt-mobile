import React,{createContext,useState} from 'react';
import {View} from 'react-native';
import {foldablePhoneLayout,foldPanelFit,usesFoldPanel,wellContentWidth} from '../src/ui/wellContentFrame';

export const WellPanelScaleContext=createContext(1);

/** Same mounted card in every posture; the Fold scales its entire phone panel. */
export function WellPagerCard({width,wideLayout,header,children,onFocus}:{
  width:number;wideLayout:boolean;header?:React.ReactNode;children:React.ReactNode;onFocus?:()=>void;
}) {
  const [viewport,setViewport]=useState({width:0,height:0});
  const fit=foldPanelFit(viewport.width,viewport.height,wideLayout);
  const fitted=usesFoldPanel(width,wideLayout,foldablePhoneLayout);
  const scale=fitted?fit.scale:1;
  return <View style={{width,flex:1,minHeight:0,overflow:fitted?'hidden':undefined}} onLayout={event=>{
    const {width,height}=event.nativeEvent.layout;
    setViewport(previous=>Math.abs(previous.width-width)>0.5 || Math.abs(previous.height-height)>0.5 ? {width,height} : previous);
  }} onTouchStart={wideLayout?onFocus:undefined}>
    <WellPanelScaleContext.Provider value={scale}>
      <View testID="well-phone-panel" style={fitted?{
        position:'absolute',width:fit.width,height:fit.height,left:'50%',top:'50%',
        marginLeft:-fit.width/2,marginTop:-fit.height/2,
        opacity:viewport.height>0?1:0,transform:[{scale}],
      }:{flex:1,minHeight:0}}>
        <View style={{display:wideLayout?'flex':'none',width:fitted?fit.width:wellContentWidth(width),alignSelf:'center'}}>{header}</View>
        <View style={{flex:1,minHeight:0}}>{children}</View>
      </View>
    </WellPanelScaleContext.Provider>
  </View>;
}
