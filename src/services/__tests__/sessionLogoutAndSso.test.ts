import { readFileSync } from 'fs';
import { join } from 'path';

const driverAuth = readFileSync(join(__dirname, '..', 'driverAuth.ts'), 'utf8');
const callback = readFileSync(join(__dirname, '..', '..', '..', 'app', 'sso-callback.tsx'), 'utf8');
const pkce = readFileSync(join(__dirname, '..', 'ssoPkce.ts'), 'utf8');
const wellConfig = readFileSync(join(__dirname, '..', 'wellConfig.ts'), 'utf8');
const listener = readFileSync(join(__dirname, '..', 'firebaseListener.ts'), 'utf8');
const session = readFileSync(join(__dirname, '..', 'firebaseAuthSession.ts'), 'utf8');
const secure = readFileSync(join(__dirname, '..', 'secureDriverAuth.ts'), 'utf8');

describe('WB-M session, SSO, registration, listener', () => {
  it('logout clears Firebase Auth before the next driver can inherit the session', () => {
    const start = driverAuth.indexOf('export const clearDriverSession');
    const end = driverAuth.indexOf('export const isPasscodeAvailable');
    const fn = driverAuth.slice(start, end);
    expect(fn).toMatch(/clearAuthSession/);
    expect(fn).toMatch(/clearWellConfigCache/);
    expect(session).toMatch(/signOut\(getFirebaseAuth\(\)\)/);
  });

  it('SSO callback bootstraps authoritative profile and does not hardcode isAdmin false', () => {
    expect(callback).toMatch(/completeAuthenticatedSession/);
    expect(callback).toMatch("authMethod: 'sso'");
    expect(callback).toMatch(/used\.current/);
    expect(callback).not.toMatch(/false,\s*\n\s*false,/);
    expect(driverAuth).toMatch(/bootstrapDriverSession/);
    expect(driverAuth).toMatch(/profile\.isAdmin === true/);
  });

  it('PKCE compares state before deleting the verifier and prevents overlapping attempts', () => {
    expect(pkce).toMatch(/sso_state_mismatch/);
    expect(pkce).toMatch(/sso_attempt_in_progress/);
    expect(pkce).toMatch(/ATTEMPT_TTL_MS/);
    const take = pkce.slice(pkce.indexOf('export async function takeWbmPkce'));
    const deleteAt = take.indexOf('deleteItemAsync');
    const compareAt = take.indexOf('expectedActive !== state');
    expect(compareAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(compareAt);
  });

  it('registration uses pendingSecureId and never writes pendingPasscodeHash as identity', () => {
    const submit = driverAuth.slice(driverAuth.indexOf('export const submitRegistration'));
    expect(submit).toMatch(/pendingSecureId/);
    expect(submit).toMatch(/deleteItemAsync\("pendingPasscodeHash"\)/);
    expect(driverAuth).toMatch(/checkDriverRegistrationStatus/);
    expect(driverAuth).not.toMatch(/await firebaseGet\(`\$\{DRIVERS_APPROVED\}/);
  });

  it('well config and listener use the ID token / company query', () => {
    expect(wellConfig).toMatch(/getValidIdToken/);
    expect(wellConfig).not.toMatch(/\?auth=\$\{FIREBASE_API_KEY\}/);
    expect(wellConfig).toMatch(/getDriverWellConfig/);
    expect(wellConfig).not.toMatch(/well_config\.json\?auth=/);
    expect(listener).toMatch(/orderByChild\('companyId'\)/);
    expect(listener).toMatch(/equalTo\(companyId\)/);
    expect(listener).toMatch(/missing companyId — refusing unscoped outgoing list/);
  });

  it('manual login still authenticates with a custom-token session', () => {
    expect(secure).toMatch(/persistCustomTokenSession/);
    expect(secure).toMatch(/authenticateDriver/);
  });
});
