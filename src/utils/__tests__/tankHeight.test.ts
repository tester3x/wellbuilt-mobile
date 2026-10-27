import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import ts from 'typescript';
import { clampTankLevel, resolveTankHeight, tankFillFraction } from '../tankHeight';
import { estimatedSnapshotLevel } from '../../services/downSnapshot';
import { summaryCurrentLevel, summaryLevelAtTime, summaryTimeAtLevel, formatFeetInches } from '../../services/summaryWellLevel';

const now = Date.parse('2026-10-27T12:00:00Z');
test.each([20, 25])('%s-foot tanks use their own full height for graphics and all projections', height => {
  expect(tankFillFraction(10, height)).toBe(10 / height);
  expect(tankFillFraction(height, height)).toBe(1);
  expect(tankFillFraction(height + 5, height)).toBe(1);
  const snapshot = { levelFeet: 19, timestamp: now - 3 * 3600000, flowRateMinutes: 60 };
  const well = { levelFeet: 19, snapshotTimestamp: snapshot.timestamp, flowRateMinutes: 60, isDown: false, tankHeight: height };
  expect(estimatedSnapshotLevel(snapshot, 0, now, height)).toBe(Math.min(22, height));
  expect(summaryCurrentLevel(well, now)).toBe(Math.min(22, height));
  expect(summaryLevelAtTime(well, 24, now)).toBe(height);
  expect(summaryTimeAtLevel(well, height + 1, now)).toBeNull();
  expect(estimatedSnapshotLevel({ ...snapshot, levelFeet: 23, isDown: true }, 0, now, height)).toBe(Math.min(23, height));
});
test('legacy missing or invalid heights retain a safe 20-foot fallback', () => {
  for (const value of [undefined, null, '', 0, -25, NaN, Infinity, 'bad']) expect(resolveTankHeight(value)).toBe(20);
  expect(resolveTankHeight('25')).toBe(25);
  expect(clampTankLevel(-1, 25)).toBe(0);
});

function screen(file: string) {
  const text = readFileSync(join(__dirname, '../../../app', file), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const find = (predicate: (node: ts.Node) => boolean) => {
    let found: ts.Node | undefined;
    const visit = (node: ts.Node) => { if (predicate(node)) found = node; ts.forEachChild(node, visit); };
    visit(ast); if (!found) throw Error('Screen expression missing: ' + file); return found;
  };
  return { ast, find };
}
function execute(text: string, scope: Record<string, unknown>) {
  return runInNewContext(ts.transpileModule('const action = ' + text, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText + '\naction', scope);
}
test.each([20, 25])('actual tank screen converts water fraction and clamps slider at %s feet', height => {
  const { ast, find } = screen('(tabs)/index.tsx');
  const variable = (name: string) => find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name) as ts.VariableDeclaration;
  const display = jest.fn(), saved = jest.fn(), slider = jest.fn();
  execute(variable('updateDisplayFeet').initializer!.getText(ast), { tankHeightFeet: height, setDisplayFeet: display, onLevelChange: null })(10 / height);
  expect(display).toHaveBeenCalledWith(10);
  const callback = variable('handleSliderChange').initializer as ts.CallExpression;
  execute(callback.arguments[0].getText(ast), { tankHeightFeet: height, wellConfig: { loadLine: 1.33, allowedBottom: 3 }, displayFeet: 10,
    setSliderFeet: slider, saveSliderPosition: saved, wellName: 'Test' })(30);
  expect(slider).toHaveBeenCalledWith(height);
  expect(saved).toHaveBeenCalledWith('Test', height);
  const maximum = find(n => ts.isJsxAttribute(n) && n.name.getText(ast) === 'maximumValue') as ts.JsxAttribute;
  expect(execute((maximum.initializer as ts.JsxExpression).expression!.getText(ast), { tankHeightFeet: height })).toBe(height);
});
test.each([20, 25])('actual Record Load time-picker estimate respects %s-foot height', height => {
  const { ast, find } = screen('record.tsx');
  const effect = find(n => ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect' && n.arguments[0].getText(ast).includes('const baseTs = baseTimestampRef.current;')) as ts.CallExpression;
  const shown = jest.fn();
  execute(effect.arguments[0].getText(ast), { isEditMode: false, baseTimestampRef: { current: now - 3 * 3600000 }, baseLevelFeetRef: { current: 19 },
    flowRateMinutes: 60, wellIsDownRef: { current: false }, dateTime: new Date(now), tankHeightFeet: height, clampTankLevel, formatFeetInches,
    setEstLevel: jest.fn(), setEstLevelFeet: shown, setEstBbls: jest.fn(), loadLineRef: { current: 1.33 }, bblPerFoot: 20 })();
  expect(shown).toHaveBeenCalledWith(Math.min(22, height));
});
