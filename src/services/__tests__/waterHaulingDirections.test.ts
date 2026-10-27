import { estimatedSnapshotLevel } from '../downSnapshot';
import { resultingLevel } from '@tester3x/water-hauling';
describe('shared tank operation directions',()=>{
 const timestamp=Date.parse('2026-10-25T12:00:00Z'),now=timestamp+86400000;
 it('uses the existing tank projection with consumption for freshwater',()=>{
  expect(estimatedSnapshotLevel({routeType:'freshwater',levelFeet:10,timestamp,dailyBbl:120,bblPerFoot:60},0,now,20)).toBe(8);
  expect(estimatedSnapshotLevel({levelFeet:10,timestamp,flowRateMinutes:720},0,now,20)).toBe(12);
 });
 it('keeps both load directions and capacity validation in the shared package',()=>{
  expect(resultingLevel('freshwater',10,120,60,20)).toBe(12);
  expect(resultingLevel('produced-water',10,120,60,20)).toBe(8);
  expect(resultingLevel('freshwater',19,120,60,20)).toBeNull();
 });
});
