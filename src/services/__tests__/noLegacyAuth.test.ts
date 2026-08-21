import { readFileSync } from 'fs';
import { join } from 'path';

const driverAuth = readFileSync(join(__dirname, '..', 'driverAuth.ts'), 'utf8');
const login = readFileSync(join(__dirname, '..', '..', '..', 'app', 'login.tsx'), 'utf8');
const firebase = readFileSync(join(__dirname, '..', 'firebase.ts'), 'utf8');
const secure = readFileSync(join(__dirname, '..', 'secureDriverAuth.ts'), 'utf8');

describe('WB-M no longer uses insecure legacy auth', () => {
  it('verifyLogin does not GET drivers/approved', () => {
    const start = driverAuth.indexOf('export const verifyLogin');
    const end = driverAuth.indexOf('export const verifyPasscode');
    const loginFn = driverAuth.slice(start, end);
    expect(loginFn).toMatch(/secureLogin/);
    expect(loginFn).not.toMatch(/legacy fallback/);
    expect(loginFn).not.toMatch(/DRIVERS_APPROVED/);
  });

  it('revalidation uses verifyDriverSession, not approved hash', () => {
    expect(driverAuth).toMatch(/verifySessionOnServer/);
    expect(driverAuth).not.toMatch(/Revalidating session for hash/);
  });

  it('session does not persist passcodeHash as identity', () => {
    expect(driverAuth).toMatch(/deleteItemAsync\("passcodeHash"\)/);
  });

  it('login refuses hash-bearing URLs', () => {
    expect(login).toMatch(/refused hash-bearing login URL/);
    expect(login).not.toMatch(/drivers\/approved\/\$\{hash\}/);
  });

  it('does not attach the API key as RTDB auth', () => {
    expect(firebase).not.toMatch(/\?auth=\$\{FIREBASE_API_KEY\}/);
    expect(firebase).toMatch(/getValidIdToken/);
  });

  it('secure login persists a custom-token Firebase session', () => {
    expect(secure).toMatch(/persistCustomTokenSession/);
    expect(secure).toMatch(/authenticateDriver/);
  });

  it('packet uploads do not fall back to public incoming', () => {
    expect(firebase).toMatch(/not writing public incoming/);
    expect(firebase).not.toMatch(/legacy path/);
  });

  it('does not increment incoming_version after a successful command', () => {
    expect(firebase).not.toMatch(/await incrementIncomingVersion/);
  });
});

