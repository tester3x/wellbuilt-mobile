import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BackHandler, Keyboard } from 'react-native';
import { MeasurementKeypadProvider, useMeasurementKeypad } from '../../contexts/MeasurementKeypadContext';
import LevelFieldInput from '../../components/LevelFieldInput';

jest.mock('react-native', () => ({
  Keyboard: { dismiss: jest.fn() },
  BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  StyleSheet: { create: (x: unknown) => x },
  Platform: { OS: 'ios', select: (values: any) => values.ios },
  NativeModules: {},
  View: 'View', Text: 'Text', TextInput: 'TextInput',
}));
jest.mock('../../utils/keypadNavigationBar', () => ({
  hideNavigationForKeypad: jest.fn(), releaseKeypadNavigation: jest.fn(),
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

test('Close commits only the field, never workflow Done, and releases navigation ownership', () => {
  const commit = jest.fn(); const done = jest.fn();
  const nav = jest.requireMock('../../utils/keypadNavigationBar');
  act(() => keypad.openKeypad({ fieldKey: 'bbls', variant: 'numeric', value: '140',
    onDismiss: jest.fn(), onDone: done, onCommitValue: commit }));
  expect(nav.hideNavigationForKeypad).toHaveBeenCalledTimes(1);
  const owner = nav.hideNavigationForKeypad.mock.calls[0][0];
  act(() => { keypad.commitAndDismiss(); });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledWith('140');
  expect(done).not.toHaveBeenCalled();
  expect(keypad.isOpen).toBe(false);
  expect(nav.releaseKeypadNavigation).toHaveBeenCalledWith(owner);
});

test('Close remains available with an invalid draft and does not submit it', () => {
  const done = jest.fn(); const commit = jest.fn();
  act(() => keypad.openKeypad({ fieldKey: 'level', value: "10'15", variant: 'level',
    onDismiss: jest.fn(), onDone: done, onCommitValue: commit }));
  expect(keypad.canCommit).toBe(false);
  act(() => { keypad.commitAndDismiss(); });
  expect(done).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(keypad.isOpen).toBe(false);
});

test('hardware Back closes the keypad rather than leaving the screen', () => {
  const commit = jest.fn(); const done = jest.fn();
  act(() => keypad.openKeypad({ fieldKey: 'bbls', value: '140', variant: 'numeric',
    onDismiss: jest.fn(), onDone: done, onCommitValue: commit }));
  const register = BackHandler.addEventListener as jest.Mock;
  const callback = register.mock.calls[register.mock.calls.length - 1][1];
  let handled = false;
  act(() => { handled = callback(); });
  expect(handled).toBe(true);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(done).not.toHaveBeenCalled();
  expect(keypad.isOpen).toBe(false);
});

test('Next field handoff keeps navigation hidden until closing the destination field', () => {
  const nav = jest.requireMock('../../utils/keypadNavigationBar');
  const levelCommit = jest.fn(); const bblCommit = jest.fn();
  const done = jest.fn();
  act(() => keypad.openKeypad({ fieldKey: 'level', value: '10 4', variant: 'level',
    onDismiss: jest.fn(), onDone: done, onCommitValue: levelCommit,
    onNext: value => {
      levelCommit(value);
      keypad.openKeypad({ fieldKey: 'bbls', value: '140', variant: 'numeric',
        onDismiss: jest.fn(), onDone: done, onCommitValue: bblCommit });
    } }));
  act(() => keypad.commitNext());
  expect(keypad.activeFieldKey).toBe('bbls');
  expect(nav.hideNavigationForKeypad).toHaveBeenCalledTimes(1);
  expect(nav.releaseKeypadNavigation).not.toHaveBeenCalled();
  act(() => { keypad.commitAndDismiss(); });
  expect(bblCommit).toHaveBeenCalledTimes(1);
  expect(done).not.toHaveBeenCalled();
  expect(nav.releaseKeypadNavigation).toHaveBeenCalledTimes(1);
});
