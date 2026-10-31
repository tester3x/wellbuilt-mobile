import {pipelineDisplay} from '../pipelineOperation';
import {estimatedSnapshotLevel,startingLevelFromSnapshot} from '../downSnapshot';
import {summaryCurrentLevel,summaryLevelAtTime,summaryTimeAtLevel} from '../summaryWellLevel';
const config={tankHeight:20,bblPerFoot:51,pipelineOperation:{mode:'running',holdingLevelFeet:10,productionMinutesPerFoot:101.13,levelBasis:'assumed'}};
test('known gross production remains positive while the operating level holds across time',()=>{
 expect(pipelineDisplay(config)).toEqual({holdingLevelFeet:10,productionMinutesPerFoot:101.13,productionBblsDay:726,assumed:true});
 const snapshot={pipelineHoldingLevelFeet:10,lastPullBottomLevelFeet:9+2/12,levelFeet:9+2/12,timestamp:Date.UTC(2026,0,1),flowRateMinutes:101.13,isDown:false};
 expect(startingLevelFromSnapshot(snapshot)).toBe(10);
 expect(estimatedSnapshotLevel(snapshot,101.13,Date.UTC(2026,0,10),20)).toBe(10);
 const summary={...snapshot,snapshotTimestamp:snapshot.timestamp};
 expect(summaryCurrentLevel(summary,Date.UTC(2026,0,10))).toBe(10);expect(summaryLevelAtTime(summary,24)).toBe(10);
 expect(summaryTimeAtLevel(summary,15)).toBeNull();expect(snapshot.lastPullBottomLevelFeet).toBe(9+2/12);
});
test('normal/offline/freshwater/malformed configurations do not inherit a pipeline hold',()=>{
 for(const c of [{...config,isDown:true},{...config,routeType:'freshwater'},{...config,pipelineOperation:{...config.pipelineOperation,mode:'off'}},{...config,pipelineOperation:{...config.pipelineOperation,holdingLevelFeet:21}},{...config,pipelineOperation:{...config.pipelineOperation,holdingLevelFeet:NaN}}])expect(pipelineDisplay(c)).toBeNull();
});
