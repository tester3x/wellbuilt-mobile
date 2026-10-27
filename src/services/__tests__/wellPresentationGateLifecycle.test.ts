/** The actual account gate mounts these route hooks while restore is pending.
 * Execute their actual useCallback/effect dependency lists with real React hooks;
 * only native UI and the data boundary are replaced in this lifecycle fixture. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import React from 'react';
const Renderer = require('react-test-renderer');
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'Spinner', AppState: { addEventListener: () => ({ remove() {} }) } }));
jest.mock('../../../modules/wellbuilt-platform/index', () => ({ addListener: () => ({ remove() {} }) }));
jest.mock('../../../modules/wellbuilt-platform/delivery', () => ({ subscribePending: () => () => {} }));
jest.mock('expo-splash-screen', () => ({ hideAsync: async () => {} }));
const Gate = require('../../../modules/wellbuilt-platform/AccountGate');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function hooks(file: string, loaderName: string) {
  const ast = ts.createSourceFile(file, readFileSync(resolve(__dirname, '../../../app', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let loader!: ts.Node, effect!: ts.Node;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === loaderName) loader = node.initializer!;
    if (ts.isCallExpression(node) && ['useEffect', 'useFocusEffect'].includes(node.expression.getText(ast))) {
      const text = node.arguments[0]?.getText(ast) || '';
      if (text.includes(loaderName + '(')) effect = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!loader || !effect) throw Error(`Actual loader hooks missing: ${file}`);
  const compile = (node: ts.Node) => {
    const code = ts.transpileModule(`return ${node.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    return new Function('scope', `with(scope){${code}}`) as (scope: any) => any;
  };
  return { loader: compile(loader), effect: compile(effect) };
}
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

describe.each([
  ['well-data.tsx', 'fetchData'], ['summary.tsx', 'loadSummaryData'], ['history.tsx', 'loadHistory'],
])('actual AccountGate + %s lifecycle', (file, loaderName) => {
  beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => jest.restoreAllMocks());
  async function mount() {
    const actual = hooks(file, loaderName), restore = deferred<'current' | 'restored'>();
    const dataRead = jest.fn(() => new Promise(() => {}));
    const error = jest.fn(), subscribe = jest.fn(() => () => {}), expanded = jest.fn(async () => {});
    const base = {
      useCallback: React.useCallback, useEffect: React.useEffect,
      useFocusEffect: (effect: () => void) => React.useEffect(effect, [effect]),
      loadExpandedStates: expanded,
      AsyncStorage: { getItem: jest.fn(async (key: string) => key === 'selected' ? JSON.stringify(['Well A']) : null) },
      STORAGE_KEY_SELECTED_WELLS: 'selected', STORAGE_KEY_SLIDER_FEET: 'feet', STORAGE_KEY_SLIDER_HOURS: 'hours', STORAGE_KEY_SLIDER_MODE: 'mode', STORAGE_KEY_LOAD_SIZE: 'size',
      wellName: 'Well A', dateFilter: 'all', wellFilter: 'all', getSessionGeneration: () => 1,
      loadWellPresentation: dataRead, loadWellHistoryPresentation: dataRead,
      setError: error, setLoading() {}, setData() {}, setCachedRows() {}, setSavedHistory() {}, setRefreshingSavedHistory() {},
      setExpandedId() {}, isCurrentUserViewer: async () => false, setIsViewer() {}, onEditDeliveryResult: subscribe,
    };
    let loader: (force?: boolean) => Promise<void>;
    function Probe() {
      const platformAccountReady = Gate.useAccountReady();
      const request = React.useRef(0);
      const scope = { ...base, platformAccountReady, historyRequest: request, summaryRequest: request };
      loader = actual.loader(scope); (scope as any)[loaderName] = loader;
      actual.effect(scope);
      return React.createElement('Probe', { ready: platformAccountReady });
    }
    let rendered: any;
    await Renderer.act(async () => { rendered = Renderer.create(React.createElement(Gate, { restore: () => restore.promise }, React.createElement(Probe))); await flush(); });
    return { restore, dataRead, error, subscribe, expanded, invoke: (force = false) => loader(force), unmount: () => Renderer.act(async () => rendered.unmount()) };
  }
  it.each(['current', 'restored'] as const)('does no owner/data work before %s restore and loads once when ready', async mode => {
    const f = await mount(); expect(f.dataRead).not.toHaveBeenCalled(); expect(f.error).not.toHaveBeenCalled();
    expect(f.expanded).not.toHaveBeenCalled(); expect(f.subscribe).not.toHaveBeenCalled();
    await f.invoke(true); expect(f.dataRead).not.toHaveBeenCalled();
    await Renderer.act(async () => { f.restore.resolve(mode); await flush(); });
    expect(f.dataRead).toHaveBeenCalledTimes(1); expect(f.error.mock.calls.some(([value]) => value)).toBe(false);
    await f.unmount();
  });
  it('failed account restore never exposes cached presentation as app access', async () => {
    const f = await mount();
    await Renderer.act(async () => { f.restore.reject(Object.assign(Error('not included'), { code: 'platform/access-denied' })); await flush(); });
    expect(f.dataRead).not.toHaveBeenCalled(); expect(f.expanded).not.toHaveBeenCalled(); await f.unmount();
  });
});
