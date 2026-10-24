import { changeTankInfoField, dimensionFeet, editableTankConfig, previewTankBankRate, tankInfoChanges } from '../tankInfoDraft';
import en from '../../i18n/locales/en.json';
import es from '../../i18n/locales/es.json';
test('plaque dimensions support feet/inches and decimal feet consistently', () => {
  expect(dimensionFeet('15\'6"')).toBe(15.5); expect(dimensionFeet('30 3')).toBe(30.25);
  expect(dimensionFeet('30.25')).toBe(30.25); expect(() => dimensionFeet('15 12')).toThrow();
  expect(dimensionFeet("25'")).toBe(25);
});
test('connected-bank preview follows dimensions and count while preserving a deliberate per-tank override', () => {
  const draft = changeTankInfoField({ activeTanks: '4' }, 'tankDiameter', '15\'6"', false);
  expect(draft.perTankBblPerFoot).toBe('33.6'); expect(previewTankBankRate(draft)).toBe(134.4);
  expect(previewTankBankRate({ ...draft, activeTanks: '2' })).toBe(67.2);
  expect(changeTankInfoField({ ...draft, perTankBblPerFoot: '34' }, 'tankDiameter', '15.5', true).perTankBblPerFoot).toBe('34');
});
test('modal close labels resolve in both supported languages', () => {
  expect(en.common.close).toBe('Close'); expect(es.common.close).toBe('Cerrar');
});
test('bank rate remains derived and unknowns are not replaced with invented tank specifications', () => {
  expect(editableTankConfig({}).tankHeight).toBeUndefined();
  expect(editableTankConfig({ numTanks: 4, bblPerFoot: 134.4 }).perTankBblPerFoot).toBe(33.6);
  expect(tankInfoChanges({ activeTanks: 4, totalTanks: 4 }, { activeTanks: '2', totalTanks: '4' })).toEqual({ activeTanks: 2 });
  expect(() => tankInfoChanges({ activeTanks: 4, totalTanks: 4 }, { activeTanks: '5', totalTanks: '4' })).toThrow();
});
