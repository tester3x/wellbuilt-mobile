import { dimensionFeet, editableTankConfig, tankInfoChanges } from '../tankInfoDraft';
test('plaque dimensions support feet/inches and decimal feet consistently', () => {
  expect(dimensionFeet('15\'6"')).toBe(15.5); expect(dimensionFeet('30 3')).toBe(30.25);
  expect(dimensionFeet('30.25')).toBe(30.25); expect(() => dimensionFeet('15 12')).toThrow();
});
test('bank rate remains derived and unknowns are not replaced with invented tank specifications', () => {
  expect(editableTankConfig({}).tankHeight).toBeUndefined();
  expect(editableTankConfig({ numTanks: 4, bblPerFoot: 134.4 }).perTankBblPerFoot).toBe(33.6);
  expect(tankInfoChanges({ activeTanks: 4, totalTanks: 4 }, { activeTanks: '2', totalTanks: '4' })).toEqual({ activeTanks: 2 });
  expect(() => tankInfoChanges({ activeTanks: 4, totalTanks: 4 }, { activeTanks: '5', totalTanks: '4' })).toThrow();
});
