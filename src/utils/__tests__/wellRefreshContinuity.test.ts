import { resolveTankHeight } from '../tankHeight';
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import ts from 'typescript';

// Execute the actual screen refresh effect with controlled storage reads.
const source = readFileSync(join(__dirname, '../../../app/(tabs)/index.tsx'), 'utf8');
const ast = ts.createSourceFile('index.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect = '';
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
      && node.arguments[0]?.getText(ast).includes('readWellDisplayData(wellName, config)')) {
    effect = node.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (!effect) throw Error('WellView refresh effect not found');
const js = ts.transpileModule('const refreshEffect = ' + effect, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText + '\nrefreshEffect';
const old = { dateTime: 'previous accepted pull', bbls: 140 };
const tick = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function harness(snapshot: unknown = null, previousWell = 'Olson') {
  let finish!: (value: unknown) => void;
  const config = new Promise(resolve => { finish = resolve; });
  let shown: unknown = old;
  const setLastPullInfo = jest.fn(value => { shown = value; });
  const scope = {
    resolveTankHeight,
    wellName: 'Olson', entryPrepared:true, lastPullWellRef: { current: previousWell },
    getWellConfig: jest.fn(() => config), setWellConfig: jest.fn(),
    readWellDisplayData: jest.fn(async () => ({snapshot,pending:null,pull:null,slider:10})), setLevelSnapshot: jest.fn(),
    setPullRecord: jest.fn(), getBblPerFootSync: () => 51,
    setLastPullInfo, getSliderPosition: jest.fn(async () => 10), setSliderFeet: jest.fn(),
    drainAnimationActive: { current: false }, startingLevelFromSnapshot: () => 0,
    setIsLoadingInitial: jest.fn(), setTimeout: jest.fn(() => 1), clearTimeout: jest.fn(),
    console: { error: jest.fn() },
  };
  const cleanup = runInNewContext(js, scope)();
  return { scope, finish, cleanup, shown: () => shown };
}

test('same-well refresh keeps accepted details visible while storage is pending', () => {
  const h = harness();
  expect(h.shown()).toEqual(old);
  expect(h.scope.setLastPullInfo).not.toHaveBeenCalled();
  h.cleanup();
});

test('a different well clears the prior well immediately', () => {
  const h = harness(null, 'Dwyer');
  expect(h.shown()).toBeNull();
  h.cleanup();
});

test('accepted replacement arrives without an intermediate empty row', async () => {
  const h = harness({lastPullDateTime: 'new accepted pull', lastPullBbls: 165,
    lastPullTopLevel: '12', lastPullBottomLevel: '9'});
  h.finish({}); await tick();
  expect(h.scope.setLastPullInfo).toHaveBeenCalledTimes(1);
  expect(h.shown()).toMatchObject({dateTime: 'new accepted pull', bbls: 165});
  h.cleanup();
});

test.each([null, { unavailable: true }])('an accepted missing/unavailable observation clears stale details', async snapshot => {
  const h = harness(snapshot);
  expect(h.shown()).toEqual(old);
  h.finish({}); await tick();
  expect(h.shown()).toBeNull();
  h.cleanup();
});

test('cancelled refresh cannot overwrite the visible observation', async () => {
  const h = harness(); h.cleanup(); h.finish({}); await tick();
  expect(h.shown()).toEqual(old);
  expect(h.scope.setLastPullInfo).not.toHaveBeenCalled();
});


test.each([false,true])('actual header keeps route/operator rows in place before and after catalogue hydration (Fold=%s)', foldablePhoneLayout => {
  let header = '';
  function find(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.attributes.getText(ast).includes('openPicker(index)'))
      header = node.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast);
  expect(header).not.toBe('');
  const compiled = ts.transpileModule('const header = ' + header, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText + '\nheader';
  const render = (config: unknown) => runInNewContext(compiled, {
    React, View: 'View', Text: 'Text', TouchableOpacity: 'Button', ActivityIndicator: 'Spinner',
    styles: { headerCenter: 'center', routeName: 'route', operatorName: 'operator' },
    wellConfigMap: config, item:'Olson',index:0,setFocusedIndex:()=>{},foldablePhoneLayout,
    getRouteColor: () => '#fff', openPicker: () => {}, t: () => 'of',
  }) as React.ReactElement<{children: React.ReactElement<{style: unknown; children: unknown}>[]}>;
  const pending = render(null).props.children.filter(n => n.type === 'Text');
  const loaded = render({Olson: {route: 'Tallgrass', operator: 'OASIS'}}).props.children.filter(n => n.type === 'Text');
  expect(pending).toHaveLength(3);
  expect(loaded).toHaveLength(3);
  expect(pending[0].props.children).toBe('\u00a0');
  expect(pending[2].props.children).toBe('\u00a0');
  expect(loaded[0].props.children).toBe('Tallgrass');
  expect(loaded[2].props.children).toBe('OASIS');
});
