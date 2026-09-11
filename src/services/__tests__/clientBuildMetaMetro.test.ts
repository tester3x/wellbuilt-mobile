import fs from 'fs';
import path from 'path';
import vm from 'vm';

// Exercise Metro's eager namespace import, which ts-jest's imports do not model.
const babel = require('@babel/core');
const source = fs.readFileSync(path.join(__dirname, '../clientBuildMeta.ts'), 'utf8');

function loadMetadata(code: string) {
  const optionalNativeModule = jest.fn(() => {
    throw new Error('`new NativeEventEmitter()` requires a non-null argument.');
  });
  const rn = Object.defineProperty({ Platform: { OS: 'ios' } }, 'PushNotificationIOS', {
    enumerable: true, get: optionalNativeModule,
  });
  const context: any = { __DEV__: false, __METRO_GLOBAL_PREFIX__: '' };
  context.global = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('metro-runtime/src/polyfills/require.js'), 'utf8'), context);
  const modules: Record<string, unknown> = {
    'react-native': rn,
    'expo-constants': { expoConfig: { version: '2.1.0' }, nativeBuildVersion: '81' },
  };
  for (const [name, value] of Object.entries(modules)) {
    context.__d((_g: unknown, _r: unknown, _d: unknown, _a: unknown, module: any) => {
      module.exports = value;
    }, name, []);
  }
  // Route dynamic imports through the real Metro importAll implementation.
  const compiled = babel.transformSync(code, {
    filename: 'clientBuildMeta.ts', configFile: false, babelrc: false,
    presets: ['babel-preset-expo'],
    plugins: [({ types: t }: any) => ({ visitor: {
      CallExpression(p: any) {
        if (p.node.callee.type === 'Import') {
          p.replaceWith(t.callExpression(t.identifier('__importMetro'), p.node.arguments));
        }
      },
    } })],
  }).code;
  context.exports = {};
  context.require = (name: string) => name in modules ? context.__r(name) : require(name);
  context.__importMetro = async (name: string) => context.__r.importAll(name);
  vm.runInContext(compiled, context);
  return { read: context.exports.governedClientBuildMeta, optionalNativeModule };
}

test('pull metadata reads Platform without initializing optional native exports', async () => {
  const { read, optionalNativeModule } = loadMetadata(source);
  await expect(read()).resolves.toEqual({ platform: 'ios', appVersion: '2.1.0', versionCode: '81' });
  expect(optionalNativeModule).not.toHaveBeenCalled();
});

test('reproduces the former dynamic import touching the unavailable iOS module', async () => {
  const oldSource = source.replace("require('react-native')", "await import('react-native')");
  const { read, optionalNativeModule } = loadMetadata(oldSource);
  await read();
  expect(optionalNativeModule).toHaveBeenCalledTimes(1);
});
