/**
 * Android Back on New Employee Registration.
 *
 * Registration is a *mode* on `/driver-login`, not a stack screen. Popping the
 * route (router.back / default hardware Back) finishes the auth activity and
 * closes WB-M. The Sign In destination is therefore an in-screen mode switch
 * shared by hardware Back, the header Back control, and the "Sign in" link.
 *
 * Direct launch / empty history uses the same fallback — never exitApp.
 */

export type RegisterHardwareBackAction = 'dismiss-keyboard' | 'return-to-sign-in';

export function shouldInstallRegisterBackHandler(mode: string): boolean {
  return mode === 'register';
}

export function decideRegisterHardwareBack(keyboardVisible: boolean): RegisterHardwareBackAction {
  return keyboardVisible ? 'dismiss-keyboard' : 'return-to-sign-in';
}

/**
 * Apply the hardware-back decision. Always returns true while Registration is
 * showing so Android does not finish the activity.
 */
export function consumeRegisterHardwareBack(opts: {
  keyboardVisible: boolean;
  dismissKeyboard: () => void;
  returnToSignIn: () => void;
}): boolean {
  const action = decideRegisterHardwareBack(opts.keyboardVisible);
  if (action === 'dismiss-keyboard') {
    opts.dismissKeyboard();
    return true;
  }
  opts.returnToSignIn();
  return true;
}

/** Leaving Registration must drop the typed passcode; it is never persisted. */
export function shouldClearPasscodeOnLeaveRegistration(): boolean {
  return true;
}
