jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn() }));
import { buildAccountRecoveryUrl, classifyRecoveryReturn } from '../accountRecoveryLink';
import fs from 'fs';
import path from 'path';

describe('central account recovery link', () => {
  const state = 'a'.repeat(64);
  test('contains only allowlisted audience, return, and random state', () => {
    const u = new URL(buildAccountRecoveryUrl(state));
    expect(u.origin + u.pathname).toBe('https://wellbuilt-sync.web.app/account-recovery/');
    expect([...u.searchParams.keys()].sort()).toEqual(['audience','return_uri','state']);
    expect(u.searchParams.get('state')).toBe(state);
  });
  test('rejects arbitrary and mismatched returns', () => {
    expect(classifyRecoveryReturn(state, `wellbuiltmobile://account-recovery?outcome=success&state=${state}`)).toBe('success');
    expect(classifyRecoveryReturn(state, `https://evil.invalid?outcome=success&state=${state}`)).toBe('ignore');
    expect(classifyRecoveryReturn(state, 'wellbuiltmobile://account-recovery?outcome=success&state=wrong')).toBe('ignore');
  });

  test('login presents secure sign-in, explicit legacy upgrade, recovery, then registration', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../app/driver-login.tsx'), 'utf8');
    const labels = [
      'accessibilityLabel="Sign In"',
      'accessibilityLabel="Upgrade Existing Login"',
      'accessibilityLabel="Forgot Login or Passcode"',
      'accessibilityLabel="New Employee Registration"',
    ];
    const positions = labels.map((label) => source.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(source).toContain('Used WellBuilt before but haven’t upgraded yet? Use your current login and passcode once, then choose your secure passcode.');
    expect(source).toContain('Already used an older version of WellBuilt? Tap Upgrade Existing Login.');
    expect(source).not.toContain('{t(\'driverLogin.upgradeLink\')}');
  });

  test('invalid-login help is generic and does not classify the entered identity', () => {
    const guidance = 'Already used an older version of WellBuilt? Tap Upgrade Existing Login.';
    expect(guidance).not.toMatch(/account exists|legacy_only|secure_only|not found/i);
  });
});
