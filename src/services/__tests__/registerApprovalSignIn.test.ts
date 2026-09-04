/**
 * Registration approval → Sign In contract (state machine).
 *
 * After an admin approves a registration, the employee must be returned to the
 * Sign In screen and authenticate with the passcode they chose. Approval must NOT
 * fabricate/establish a local driver session and must NOT navigate into the app.
 * (No RN render harness in this project — the state-machine wiring is pinned from
 * source, and the service contract is pinned from driverAuth.ts.)
 */
import * as fs from 'fs';
import * as path from 'path';
import en from '../../i18n/locales/en.json';
import es from '../../i18n/locales/es.json';

const login = fs.readFileSync(path.join(__dirname, '../../../app/driver-login.tsx'), 'utf8');
const driverAuth = fs.readFileSync(path.join(__dirname, '../driverAuth.ts'), 'utf8');

const approvedBlock = login.slice(
  login.indexOf("{mode === 'approved' && ("),
  login.indexOf("{mode === 'rejected'"),
);
const handler = login.slice(
  login.indexOf('const handleApprovedSignIn'),
  login.indexOf('const handleCancelRegistration'),
);

describe('approved screen → Sign In (no session, no app navigation)', () => {
  test('the approved-screen button is labelled Sign In and calls handleApprovedSignIn', () => {
    expect(approvedBlock).toContain('onPress={handleApprovedSignIn}');
    expect(approvedBlock).toContain("t('driverLogin.signIn')");
    // It no longer routes into the app via the old completion handler.
    expect(approvedBlock).not.toContain('handleCompleteRegistration');
    expect(approvedBlock).not.toContain("t('driverLogin.continueToApp')");
  });

  test('the approved screen shows the sign-in hint text', () => {
    expect(approvedBlock).toContain("t('driverLogin.approvedSignInHint')");
  });

  test('handleApprovedSignIn returns to the login form only', () => {
    expect(handler).toContain("setMode('login')");
  });

  test('handleApprovedSignIn does NOT establish a session or navigate into the app', () => {
    expect(handler).not.toContain('completeRegistration');
    expect(handler).not.toContain('authorizeEstablishedSession');
    expect(handler).not.toContain('router.replace');
    expect(handler).not.toContain('saveDriverSession');
    expect(handler).not.toContain('completeAuthenticatedSession');
  });

  test('the old session-establishing completion handler is gone from the approval path', () => {
    // handleCompleteRegistration (authorizeEstablishedSession + router.replace on
    // approval) was removed — no approval code path can auto-enter the app now.
    expect(login).not.toContain('const handleCompleteRegistration');
  });
});

describe('service contract: approval polling never establishes a session', () => {
  const completeReg = driverAuth.slice(
    driverAuth.indexOf('export const completeRegistration'),
    driverAuth.indexOf('export const clearPendingRegistration'),
  );
  test('completeRegistration signals approved_login_required, not a session', () => {
    expect(completeReg).toContain("approved_login_required");
    expect(completeReg).not.toContain('saveDriverSession');
    expect(completeReg).not.toContain('completeAuthenticatedSession');
    expect(completeReg).not.toContain('signInWithCustomToken');
  });

  const submitReg = driverAuth.slice(
    driverAuth.indexOf('export const submitRegistration'),
    driverAuth.indexOf('export const completeRegistration'),
  );
  test('submitRegistration stores only the server pendingId and never opens a session', () => {
    expect(submitReg).toContain('pendingSecureId');
    expect(submitReg).toContain('secureRegister(params)');
    expect(submitReg).not.toContain('saveDriverSession');
    expect(submitReg).not.toContain('completeAuthenticatedSession');
    // ported contract field
    expect(submitReg).toContain('companyCode');
  });
});

describe('approvedSignInHint locale parity', () => {
  test('exists in en + es', () => {
    expect((en as any).driverLogin.approvedSignInHint).toBeTruthy();
    expect((es as any).driverLogin.approvedSignInHint).toBeTruthy();
  });
});
