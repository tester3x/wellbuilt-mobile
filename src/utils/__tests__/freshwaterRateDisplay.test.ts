import {formatRateDuration,displayConsumptionDaily} from '../rateDisplay';
import {freshwaterSummaryPlanning} from '../../services/freshwaterSummaryPlanning';
import {estimatedSnapshotLevel} from '../../services/downSnapshot';
import fs from 'fs';
import path from 'path';

const daily=37.51570449074099, capacity=40;
test('Gabriel two-tank consumption gives matching per-inch and per-foot durations',()=>{
 const minutes=1440*capacity/daily;
 expect(formatRateDuration(minutes/12)).toBe('2h 7m 57s');
 expect(formatRateDuration(minutes)).toBe('25h 35m 21s');
 expect(displayConsumptionDaily(daily)).toBe(37.5);
 const source=fs.readFileSync(path.join(__dirname,'../../../app/(tabs)/index.tsx'),'utf8');
 expect(source).toContain("wellConfig?.routeType === 'freshwater' ? formatRateDuration(flowMins)");
});
test('Gabriel projection and minimum time retain unrounded consumption',()=>{
 const now=Date.parse('2026-10-30T15:29:00Z');
 const well={levelFeet:12,snapshotTimestamp:now,dailyBbl:daily,bblPerFoot:capacity,tankHeight:20,allowedBottom:8,isDown:false};
 const plan=freshwaterSummaryPlanning(well,8,24,now);
 expect(plan.future).toBeCloseTo(12-daily/capacity,12);
 expect(Date.parse(plan.minimumAt!)-now).toBeCloseTo(160/daily*86400000,-1);
 expect(estimatedSnapshotLevel({...well,routeType:'freshwater',timestamp:now},0,now+86400000,20)).toBeCloseTo(plan.future!,12);
 expect((20-12)*capacity).toBe(320);
});
test.each([0,-1,NaN,Infinity])('invalid duration %s is unavailable',minutes=>expect(formatRateDuration(minutes)).toBe('N/A'));
