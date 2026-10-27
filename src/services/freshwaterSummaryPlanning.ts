import { projectedLevel, thresholdTime } from '@tester3x/water-hauling';
export type ConsumptionSnapshot={levelFeet:number;snapshotTimestamp:number;dailyBbl?:number|null;bblPerFoot?:number;tankHeight:number;allowedBottom:number;isDown:boolean;unavailable?:boolean};
/** Both slider modes project the same timestamped inventory through the shared contract. */
export function freshwaterSummaryPlanning(well:ConsumptionSnapshot,targetFeet:number,hours:number,now:number) {
 if(!Number.isFinite(now)||!Number.isFinite(well.snapshotTimestamp))return {current:null,targetAt:null,future:null,minimumAt:null};
 const at=new Date(now).toISOString(),base=new Date(well.snapshotTimestamp).toISOString();
 const current=well.unavailable ? null : projectedLevel('freshwater',well.levelFeet,base,at,well.isDown?0:well.dailyBbl,well.bblPerFoot||0,well.tankHeight);
 const targetAt=current==null || !Number.isFinite(targetFeet) || targetFeet<0 || targetFeet>well.tankHeight ? null : thresholdTime('freshwater',current,at,well.dailyBbl,well.bblPerFoot||0,targetFeet,well.isDown);
 const future=current==null || !Number.isFinite(hours) || hours<0 ? null : projectedLevel('freshwater',current,at,new Date(now+hours*3600000).toISOString(),well.isDown?0:well.dailyBbl,well.bblPerFoot||0,well.tankHeight);
 const minimumAt=current==null || !Number.isFinite(well.allowedBottom) ? null : thresholdTime('freshwater',current,at,well.dailyBbl,well.bblPerFoot||0,well.allowedBottom,well.isDown);
 return {current,targetAt,future,minimumAt};
}
export function summarySliderValue(value:number|number[],min:number,max:number) {
 const raw=Array.isArray(value)?value[0]:value;
 return Number.isFinite(raw)?Math.min(max,Math.max(min,Math.round(raw*4)/4)):min;
}
