import {wellDisplayOrder,pickerWellIndex} from '../wellDisplayOrder';

const names=['A south','Z north','B south','Y north'];
const config={'A south':{route:'South'},'B south':{route:'South'},'Z north':{route:'North'},'Y north':{route:'North'}};
test('normal and recovery inputs keep route groups and saved route precedence without mutation',()=>{
  expect(wellDisplayOrder(names,config,[])).toEqual(['Y north','Z north','A south','B south']);
  expect(wellDisplayOrder(names,config,['South','North'])).toEqual(['A south','B south','Y north','Z north']);
  expect(names).toEqual(['A south','Z north','B south','Y north']);
});
test('partial/missing config cannot globally reorder prior groups or restore ineligible wells',()=>{
  const previous=['Y north','Z north','A south','B south'];
  expect(wellDisplayOrder(['A south','Z north','Y north'],{},[],previous)).toEqual(['Y north','Z north','A south']);
  expect(wellDisplayOrder(names,{...config,'Z north':{route:45}},null,previous)).toEqual(previous);
});
test('malformed route preferences safely use grouped defaults',()=>{
  expect(wellDisplayOrder(names,config,{bad:true})).toEqual(wellDisplayOrder(names,config,[]));
});
test('background refresh cannot make picker choose another well at the same numeric index',()=>{
  const snapshot=['Y north','Z north','A south'];
  expect(pickerWellIndex(snapshot,1,['A south','Y north','Z north'])).toBe(2);
  expect(pickerWellIndex(snapshot,1,['A south','Y north'])).toBe(-1);
});
