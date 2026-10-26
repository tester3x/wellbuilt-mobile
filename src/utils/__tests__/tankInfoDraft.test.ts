import { changeTankInfoField, dimensionFeet, editableTankConfig, formatTankInfoNumber, previewTankBankRate, tankInfoChanges, tankInfoDraft } from '../tankInfoDraft';
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

test.each(['2', '6'])('the single visible count corrects an all-active bank to %s tanks', count => {
  const config = { totalTanks: 4, activeTanks: 4, perTankBblPerFoot: 25.5 };
  const blank = changeTankInfoField(tankInfoDraft(config), 'totalTanks', '', false);
  const draft = changeTankInfoField(blank, 'totalTanks', count, false);
  expect(previewTankBankRate(draft)).toBe(Number(count) * 25.5);
  expect(tankInfoChanges(config, draft)).toEqual({ totalTanks: Number(count), activeTanks: Number(count) });
});

test('a physical count correction preserves a known partially active bank', () => {
  const config = { totalTanks: 4, activeTanks: 2, perTankBblPerFoot: 25.5 };
  const draft = changeTankInfoField(tankInfoDraft(config), 'totalTanks', '6', false);
  expect(draft.activeTanks).toBe('2');
  expect(tankInfoChanges(config, draft)).toEqual({ totalTanks: 6 });
});
test('bank rate remains derived and unknowns are not replaced with invented tank specifications', () => {
  expect(editableTankConfig({}).tankHeight).toBeUndefined();
  expect(editableTankConfig({ numTanks: 4, bblPerFoot: 134.4 }).perTankBblPerFoot).toBe(33.6);
  expect(tankInfoChanges({ activeTanks: 4, totalTanks: 4 }, { activeTanks: '2', totalTanks: '4' })).toEqual({ activeTanks: 2 });
  expect(() => tankInfoChanges({ activeTanks: 4, totalTanks: 4 }, { activeTanks: '5', totalTanks: '4' })).toThrow();
});

test('rounded modal and edit values preserve precise measurements on unrelated saves', () => {
  const config = { loadLine: 1 + 4 / 12, tankNotes: '', perTankBblPerFoot: 33.612345 };
  const draft = tankInfoDraft(config);
  expect(formatTankInfoNumber(config.loadLine)).toBe('1.33');
  expect(draft.loadLine).toBe('1.33');
  expect(formatTankInfoNumber(20)).toBe('20');
  expect(formatTankInfoNumber(0)).toBe('0');
  expect(formatTankInfoNumber(undefined)).toBe('');
  expect(tankInfoChanges(config, { ...draft, tankNotes: 'Updated notes' })).toEqual({ tankNotes: 'Updated notes' });
  expect(tankInfoChanges({ loadLine: 1 }, { loadLine: '1 4' })).toEqual({ loadLine: 1 + 4 / 12 });
});
