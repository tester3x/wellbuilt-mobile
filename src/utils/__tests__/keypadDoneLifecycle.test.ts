import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Keyboard } from 'react-native';
import { MeasurementKeypadProvider, useMeasurementKeypad } from '../../contexts/MeasurementKeypadContext';
import LevelFieldInput from '../../components/LevelFieldInput';

jest.mock('react-native', () => ({
  Keyboard: { dismiss: jest.fn() },
  StyleSheet: { create: (x: unknown) => x },
  Platform: { OS: 'ios', select: (values: any) => values.ios },
  NativeModules: {},
  View: 'View', Text: 'Text', TextInput: 'TextInput',
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('../../components/TankLevelKeypad', () => ({ __esModule: true, default: () => null }));

let keypad: ReturnType<typeof useMeasurementKeypad>;
function Probe() { keypad = useMeasurementKeypad(); return null; }
let tree: ReactTestRenderer;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => { callback(0); return 0; }) as typeof requestAnimationFrame;
  jest.clearAllMocks();
  act(() => { tree = create(React.createElement(MeasurementKeypadProvider, null, React.createElement(Probe))); });
});
afterEach(() => act(() => tree.unmount()));

test('top level and BBL fields both activate the custom keypad with the system keyboard suppressed', () => {
  act(() => tree.update(React.createElement(MeasurementKeypadProvider, null,
    React.createElement(Probe),
    React.createElement(LevelFieldInput, { fieldKey: 'record-tank-level', value: '', variant: 'level', onChange: () => {} }),
    React.createElement(LevelFieldInput, { fieldKey: 'record-bbls-taken', value: '', variant: 'numeric', onChange: () => {} }),
  )));
  const inputs = tree.root.findAllByType('TextInput' as any);
  expect(inputs).toHaveLength(2);
  for (const [index, variant] of ['level', 'numeric'].entries()) {
    expect(inputs[index].props.showSoftInputOnFocus).toBe(false);
    act(() => inputs[index].props.onFocus());
    expect(keypad.isOpen).toBe(true);
    expect(keypad.variant).toBe(variant);
  }
});

test('Done releases focus before submitting and ignores synchronous duplicate Done', () => {
  const blur = jest.fn();
  const done = jest.fn((value: string) => {
    expect(value).toBe('140');
    expect(blur).toHaveBeenCalledTimes(1);
    expect(Keyboard.dismiss).toHaveBeenCalled();
    expect(keypad.isActiveField('bbls')).toBe(false);
    keypad.commitDone();
  });
  act(() => {
    keypad.registerMeasurementInput('bbls', { current: { focus: jest.fn(), blur } } as any);
    keypad.openKeypad({ fieldKey: 'bbls', variant: 'numeric', value: '140', onDismiss: () => {}, onDone: done });
  });
  act(() => keypad.commitDone());
  expect(done).toHaveBeenCalledTimes(1);
  expect(keypad.isOpen).toBe(false);
});

test('a completion callback can activate another field without Done clearing it afterward', () => {
  act(() => keypad.openKeypad({ fieldKey: 'level', value: '10 4', onDismiss: () => {}, onDone: () => {
    keypad.openKeypad({ fieldKey: 'bbls', value: '', variant: 'numeric', onDismiss: () => {}, onDone: () => {} });
  } }));
  act(() => keypad.commitDone());
  expect(keypad.isActiveField('bbls')).toBe(true);
});
