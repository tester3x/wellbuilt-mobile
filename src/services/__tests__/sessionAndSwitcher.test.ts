import { readFileSync } from 'fs';
import { join } from 'path';

const layout = readFileSync(join(__dirname, '..', '..', '..', 'app', '_layout.tsx'), 'utf8');
const loginScreen = readFileSync(join(__dirname, '..', '..', '..', 'app', 'driver-login.tsx'), 'utf8');
const switcher = readFileSync(join(__dirname, '..', '..', 'components', 'AppSwitcher.tsx'), 'utf8');
const listener = readFileSync(join(__dirname, '..', 'firebaseListener.ts'), 'utf8');
const session = readFileSync(join(__dirname, '..', 'firebaseAuthSession.ts'), 'utf8');

describe('canonical session replaces hash session', () => {
  it('manual login no longer requires passcodeHash', () => {
    expect(loginScreen).toMatch(/result\.valid && result\.driverId && result\.displayName/);
    expect(loginScreen).not.toMatch(/result\.passcodeHash/);
  });

  it('cascade logout uses identity-bound live bootstrap, not a profile GET', () => {
    expect(layout).toMatch(/checkCanonicalSsoLogout/);
    expect(layout).toMatch(/performPermittedLogout/);
    expect(layout).not.toMatch(/drivers\/approved\/\$\{hash\}\/logoutAt/);
    expect(layout).not.toMatch(/drivers\/profiles\/\$\{driverId\}\/logoutAt/);
  });

  it('AppSwitcher identity uses driverId and never puts hash in a URL', () => {
    expect(layout).toMatch(/driverId/);
    expect(switcher).toMatch(/wellbuilt-tickets:\/\/sso-start/);
    expect(switcher).toMatch(/wellbuilt-tickets:\/\/sso-start/);
    expect(switcher).not.toMatch(/login\?\$\{params/);
  });

  it('listener uses the shared Auth app, not a second initializeApp', () => {
    expect(listener).toMatch(/getFirebaseDatabase/);
    expect(listener).not.toMatch(/initializeApp\(/);
    expect(session).toMatch(/signInWithCustomToken/);
    expect(session).toMatch(/onAuthStateChanged/);
    expect(session).toMatch(/getIdToken/);
  });
});
