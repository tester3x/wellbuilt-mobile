import * as fs from 'fs';
import * as path from 'path';
import {
  consumeRegisterHardwareBack,
  decideRegisterHardwareBack,
  shouldClearPasscodeOnLeaveRegistration,
  shouldInstallRegisterBackHandler,
} from '../registrationBack';

const login = fs.readFileSync(path.join(__dirname, '../../../app/driver-login.tsx'), 'utf8');
const layout = fs.readFileSync(path.join(__dirname, '../../../app/_layout.tsx'), 'utf8');
const driverAuth = fs.readFileSync(
  path.join(__dirname, '../../services/driverAuth.ts'),
  'utf8',
);

const switchToLogin = login.slice(
  login.indexOf('const handleSwitchToLogin'),
  login.indexOf('// Android Back:'),
);
const switchToRegister = login.slice(
  login.indexOf('const handleSwitchToRegister'),
  login.indexOf('const renderPasscodeInput'),
);
const registerBlock = login.slice(
  login.indexOf("{mode === 'register' && ("),
  login.indexOf("{/* VERIFYING/REGISTERING MODE */}"),
);
const backEffect = login.slice(
  login.indexOf('useFocusEffect('),
  login.indexOf('const checkInitialState'),
);

describe('decideRegisterHardwareBack', () => {
  test('keyboard open → dismiss keyboard, stay on Registration', () => {
    expect(decideRegisterHardwareBack(true)).toBe('dismiss-keyboard');
  });

  test('keyboard closed → return to Sign In (never exit the app)', () => {
    expect(decideRegisterHardwareBack(false)).toBe('return-to-sign-in');
  });
});

describe('consumeRegisterHardwareBack — always consumed on Registration', () => {
  test('open keyboard dismisses IME and does not switch mode', () => {
    const dismissKeyboard = jest.fn();
    const returnToSignIn = jest.fn();
    const consumed = consumeRegisterHardwareBack({
      keyboardVisible: true,
      dismissKeyboard,
      returnToSignIn,
    });
    expect(consumed).toBe(true);
    expect(dismissKeyboard).toHaveBeenCalledTimes(1);
    expect(returnToSignIn).not.toHaveBeenCalled();
  });

  test('closed keyboard returns to Sign In and does not finish the activity', () => {
    const dismissKeyboard = jest.fn();
    const returnToSignIn = jest.fn();
    const consumed = consumeRegisterHardwareBack({
      keyboardVisible: false,
      dismissKeyboard,
      returnToSignIn,
    });
    expect(consumed).toBe(true);
    expect(returnToSignIn).toHaveBeenCalledTimes(1);
    expect(dismissKeyboard).not.toHaveBeenCalled();
  });

  test('two-step: first Back dismisses keyboard, second Back returns to Sign In', () => {
    const dismissKeyboard = jest.fn();
    const returnToSignIn = jest.fn();
    expect(
      consumeRegisterHardwareBack({
        keyboardVisible: true,
        dismissKeyboard,
        returnToSignIn,
      }),
    ).toBe(true);
    expect(
      consumeRegisterHardwareBack({
        keyboardVisible: false,
        dismissKeyboard,
        returnToSignIn,
      }),
    ).toBe(true);
    expect(dismissKeyboard).toHaveBeenCalledTimes(1);
    expect(returnToSignIn).toHaveBeenCalledTimes(1);
  });
});

describe('handler is Registration-only (Sign In keeps root/exit Back)', () => {
  test.each(['register'] as const)('installs on %s', (mode) => {
    expect(shouldInstallRegisterBackHandler(mode)).toBe(true);
  });

  test.each([
    'checking',
    'login',
    'upgrade',
    'upgrading',
    'verifying',
    'registering',
    'pending',
    'approved',
    'rejected',
    'error',
  ] as const)('does not install on %s', (mode) => {
    expect(shouldInstallRegisterBackHandler(mode)).toBe(false);
  });
});

describe('shared Sign In destination (hardware / header / link)', () => {
  test('hardware Back, header Back, and Sign in link all call handleSwitchToLogin', () => {
    expect(backEffect).toContain('handleSwitchToLogin');
    expect(backEffect).toContain('consumeRegisterHardwareBack');
    expect(login).toContain('testID="register-header-back"');
    expect(login).toMatch(/testID="register-header-back"[\s\S]*?onPress=\{handleSwitchToLogin\}/);
    expect(registerBlock).toContain('onPress={handleSwitchToLogin}');
    expect(registerBlock).toContain("t('driverLogin.alreadyRegistered')");
    expect(registerBlock).toContain("t('driverLogin.signInLink')");
  });

  test('handleSwitchToLogin is the in-screen Sign In fallback (no stack pop, no exitApp)', () => {
    expect(switchToLogin).toContain("setMode('login')");
    expect(switchToLogin).not.toContain('router.back');
    expect(switchToLogin).not.toContain('router.replace');
    expect(switchToLogin).not.toContain('exitApp');
    expect(backEffect).not.toContain('router.back');
    expect(backEffect).not.toContain('BackHandler.exitApp');
  });
});

describe('no leaking global BackHandler', () => {
  test('root layout does not install a BackHandler', () => {
    expect(layout).not.toContain('BackHandler');
  });

  test('driver-login installs via useFocusEffect and removes on blur/unmount', () => {
    expect(login).toContain("from '@react-navigation/native'");
    expect(login).toContain('useFocusEffect');
    expect(login).toContain("BackHandler.addEventListener('hardwareBackPress'");
    expect(backEffect).toContain('shouldInstallRegisterBackHandler(mode)');
    expect(backEffect).toMatch(/return \(\) =>\s*sub\.remove\(\)/);
  });

  test('the listener is not added at module scope', () => {
    const beforeComponent = login.slice(0, login.indexOf('export default function DriverLoginScreen'));
    expect(beforeComponent).not.toContain('BackHandler.addEventListener');
  });
});

describe('passcode is not restored after leaving Registration', () => {
  test('policy: leaving Registration clears the typed passcode', () => {
    expect(shouldClearPasscodeOnLeaveRegistration()).toBe(true);
  });

  test('handleSwitchToLogin clears passcode (and does not persist it)', () => {
    expect(switchToLogin).toContain("setPasscode('')");
    expect(switchToLogin).not.toContain('SecureStore');
    expect(switchToLogin).not.toContain('AsyncStorage');
  });

  test('reopening Registration also starts with a cleared passcode', () => {
    expect(switchToRegister).toContain("setPasscode('')");
    expect(switchToRegister).toContain("setMode('register')");
  });

  test('existing non-sensitive field behavior is unchanged on leave', () => {
    expect(switchToLogin).not.toContain('setLegalName');
    expect(switchToLogin).not.toContain('setCompanyCode');
    expect(switchToLogin).not.toContain('setDisplayName');
  });

  test('submitRegistration still never writes a local pending passcode', () => {
    const submit = driverAuth.slice(
      driverAuth.indexOf('export const submitRegistration'),
      driverAuth.indexOf('export const getPendingRegistration'),
    );
    expect(submit).toContain('deleteItemAsync("pendingPasscode")');
    expect(submit).toContain('deleteItemAsync("pendingPasscodeHash")');
    expect(submit).not.toMatch(/setItemAsync\(\s*["']pendingPasscode/);
  });
});
