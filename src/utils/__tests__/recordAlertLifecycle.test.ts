import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppAlert, useAppAlert } from '../../../components/AppAlert';

let mounts = 0;
let unmounts = 0;
jest.mock('react-native', () => {
  const R = require('react');
  return {
    Modal: function Modal(props: any) {
      R.useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
      return R.createElement('Modal', props, props.children);
    },
    View: 'View', Text: 'Text', TouchableOpacity: 'Button',
    StyleSheet: { create: (x: unknown) => x },
  };
});
jest.mock('react-native-responsive-screen', () => ({ widthPercentageToDP: () => 10, heightPercentageToDP: () => 10 }));

test('submit state updates keep the same native alert modal mounted', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let alert!: ReturnType<typeof useAppAlert>;
  let redraw!: () => void;
  function Form() {
    const [, setTick] = React.useState(0);
    redraw = () => setTick(t => t + 1);
    alert = useAppAlert();
    return React.createElement(AppAlert, alert.alertProps);
  }
  let tree!: ReactTestRenderer;
  act(() => { tree = create(React.createElement(Form)); });
  act(() => alert.show('Unable to send', 'Try again'));
  expect(tree.root.findByType('Modal' as any).props.visible).toBe(true);
  act(() => redraw());
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
  act(() => alert.hide());
  expect(mounts).toBe(1);
  act(() => tree.unmount());
});
