import { rules } from '@tester3x/water-hauling';
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
  const display = jest.fn((fill, fullHeight) => fill.value*fullHeight), saved = jest.fn(), slider = jest.fn();
  const shown=execute(variable('displayFeet').initializer!.getText(ast), { tankHeightFeet: height, waterFraction:{value:10/height},sceneActive:true,useWellLevelDisplay:display });
  expect(shown).toBe(10);
  expect(display).toHaveBeenCalledWith({value:10/height},height,true);
  const callback = variable('handleSliderChange').initializer as ts.CallExpression;
  execute(callback.arguments[0].getText(ast), { tankHeightFeet: height, wellConfig: { loadLine: 1.33, allowedBottom: 3 }, displayFeet: 10,
    setSliderFeet: slider, saveSliderPosition: saved, wellName: 'Test' })(30);
  expect(slider).toHaveBeenCalledWith(height);
  expect(saved).toHaveBeenCalledWith('Test', height);
  const maximum = find(n => ts.isJsxAttribute(n) && n.name.getText(ast) === 'maximumValue') as ts.JsxAttribute;
  expect(execute((maximum.initializer as ts.JsxExpression).expression!.getText(ast), { tankHeightFeet: height,wellConfig:{routeType:'produced-water'} })).toBe(height);
});
test.each([20, 25])('actual Record Load time-picker estimate respects %s-foot height', height => {
  const { ast, find } = screen('record.tsx');
  const effect = find(n => ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect' && n.arguments[0].getText(ast).includes('const baseTs = baseTimestampRef.current;')) as ts.CallExpression;
  const shown = jest.fn();
  execute(effect.arguments[0].getText(ast), { isEditMode: false, baseTimestampRef: { current: now - 3 * 3600000 }, baseLevelFeetRef: { current: 19 },
    rules, routeType: 'produced-water', flowRateMinutes: 60, wellIsDownRef: { current: false }, dateTime: new Date(now), tankHeightFeet: height, clampTankLevel, formatFeetInches,
    setEstLevel: jest.fn(), setEstLevelFeet: shown, setEstBbls: jest.fn(), loadLineRef: { current: 1.33 }, bblPerFoot: 20 })();
  expect(shown).toHaveBeenCalledWith(Math.min(22, height));
});

test('actual shared freshwater slider increases positive delivery and retains capacity bounds',()=>{
 const {ast,find}=screen('(tabs)/index.tsx');
 const variable=find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='handleSliderChange') as ts.VariableDeclaration;
 const callback=variable.initializer as ts.CallExpression;
 const setSliderFeet=jest.fn();
 const change=execute(callback.arguments[0].getText(ast),{wellConfig:{routeType:'freshwater'},planningFeet:13.5,tankHeightFeet:20,setSliderFeet});
 change(2);expect(setSliderFeet).toHaveBeenLastCalledWith(2);
 change(200/60);expect(setSliderFeet).toHaveBeenLastCalledWith(200/60);
 change(100);expect(setSliderFeet).toHaveBeenLastCalledWith(6.5);
 change(-1);expect(setSliderFeet).toHaveBeenLastCalledWith(0);
});
test.each([false, true])('height edits rescale a stationary/down=%s tank without another pull or timer', down => {
  const { ast, find } = screen('(tabs)/index.tsx');
  const effect = find(n => ts.isCallExpression(n) && n.expression.getText(ast) === 'useEffect' && n.arguments[0].getText(ast).includes('setInterval(updateEstimate, LIVE_UPDATE_MS)')) as ts.CallExpression;
  const setTargetFraction = jest.fn(), timer = jest.fn();
  const scope = { levelSnapshot: { levelFeet: 10, timestamp: now, flowRateMinutes: 0 }, wellDown: down,
    drainAnimationActive: { current: false }, tankHeightFeet: 20, estimatedSnapshotLevel, tankFillFraction,
    setTargetFraction, liveUpdateRef: { current: null },
    setInterval: timer, clearInterval: jest.fn(), LIVE_UPDATE_MS: 30000 };
  execute(effect.arguments[0].getText(ast), scope)(); expect(setTargetFraction).toHaveBeenLastCalledWith(0.5);
  execute(effect.arguments[0].getText(ast), { ...scope, tankHeightFeet: 25 })(); expect(setTargetFraction).toHaveBeenLastCalledWith(0.4);
  expect(timer).not.toHaveBeenCalled();
});

test('actual mixed-height summary offers the tallest tank while refusing impossible targets on shorter tanks', () => {
  const { ast, find } = screen('summary.tsx');
  const maximum = find(n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'maxSliderFeet') as ts.VariableDeclaration;
  const limit = (heights: number[]) => execute(maximum.initializer!.getText(ast), { resolveTankHeight, routeGroups: [{ wells: heights.map(tankHeight => ({ tankHeight })) }] });
  expect(limit([20])).toBe(20); expect(limit([20, 25])).toBe(25);
  const eta = find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'getTimeAtLevel');
  const action = execute(eta.getText(ast), { resolveTankHeight, getCurrentLevel: () => 10 });
  expect(action({ tankHeight: 20, flowRateMinutes: 60 }, 23)).toBeNull();
  expect(action({ tankHeight: 25, flowRateMinutes: 60 }, 23)).not.toBeNull();
});
