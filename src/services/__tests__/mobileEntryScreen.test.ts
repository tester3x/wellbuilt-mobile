import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runInNewContext } from 'vm';
import ts from 'typescript';
import { parsePlatformOwnerHint } from '../platformRuntime.generated';

const Renderer = require('react-test-renderer');
const { act } = React;
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const compiled = ts.transpileModule(readFileSync(join(__dirname, '../../../app/sso-start.tsx'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function harness() {
  const state = { account: true, navigation: false, focus: true, params: {} as Record<string, unknown> };
  const established = jest.fn(async (_owner?: unknown) => true);
  const authorize = jest.fn(async () => ({ authorizeUrl: 'suite://authorize' }));
  const open = jest.fn(async () => {});
  const module = { exports: {} as any };
  const mocks: Record<string, unknown> = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'expo-router': {
      useLocalSearchParams: () => state.params, useRootNavigationState: () => state.navigation ? { key: 'root' } : undefined,
      useFocusEffect: (effect: () => unknown) => React.useEffect(() => state.focus ? effect() as any : undefined, [effect, state.focus]),
      Redirect: (props: unknown) => React.createElement('redirect', props as any), router: { replace: jest.fn() },
    },
    'react-native': { View: 'view', Text: 'text', Pressable: 'button', ActivityIndicator: 'spinner' },
    'expo-linking': { openURL: open },
    '../modules/wellbuilt-platform/AccountGate': { useAccountReady: () => state.account },
    '../src/services/platformEntry': { hasEstablishedWbmEntry: established, refreshEstablishedWbmEntry: jest.fn(async () => 'keep') },
    '../src/services/platformRuntime.generated': { parsePlatformOwnerHint },
    '../src/services/ssoPkce': { beginWbmPkce: authorize },
    '../src/services/mobileEntry': require('../mobileEntry'),
  };
  runInNewContext(compiled, { exports: module.exports, module, require: (name: string) => { if (!(name in mocks)) throw Error(name); return mocks[name]; } });
  let tree: any;
  const update = async () => { await act(async () => { if (tree) tree.update(React.createElement(module.exports.default)); else tree = Renderer.create(React.createElement(module.exports.default)); await tick(); }); };
  return { state, established, authorize, open, update, tree: () => tree, close: async () => { await act(async () => tree.unmount()); } };
}
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { jest.spyOn(console, 'info').mockImplementation(() => {}); jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

test('post-update entry waits for both account restore and mounted navigation before redirecting', async () => {
  const h = harness(); h.state.account = false; await h.update(); expect(h.established).not.toHaveBeenCalled();
  h.state.account = true; await h.update(); expect(h.established).not.toHaveBeenCalled();
  h.state.navigation = true; await h.update(); expect(h.tree().root.findByType('redirect').props.href).toBe('/(tabs)');
  expect(h.authorize).not.toHaveBeenCalled(); await h.close();
});
test('reused handoff screen rechecks new owner hints instead of retaining the first one-shot result', async () => {
  const h = harness(); h.state.navigation = true; await h.update();
  h.state.params = { driverId: 'driver-b', companyId: 'company-b' }; h.established.mockResolvedValue(false); await h.update();
  expect(h.established).toHaveBeenLastCalledWith({ driverId: 'driver-b', companyId: 'company-b' });
  expect(h.tree().root.findAllByType('redirect')).toHaveLength(0); expect(h.authorize).toHaveBeenCalledTimes(1); await h.close();
});
test('returning focus retries a stalled handoff; invalid parameters never resume cached access', async () => {
  const h = harness(); h.state.navigation = true; h.established.mockResolvedValue(false); await h.update();
  h.state.focus = false; await h.update(); h.established.mockResolvedValue(true); h.state.focus = true; await h.update();
  expect(h.tree().root.findAllByType('redirect')).toHaveLength(1);
  h.state.params = { redirect: 'untrusted' }; await h.update(); expect(h.tree().root.findAllByType('redirect')).toHaveLength(0);
  expect(h.established).toHaveBeenCalledTimes(2); await h.close();
});
