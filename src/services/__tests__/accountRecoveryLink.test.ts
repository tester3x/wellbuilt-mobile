jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn() }));
import { buildAccountRecoveryUrl, classifyRecoveryReturn } from '../accountRecoveryLink';

describe('central account recovery link', () => {
  const state = 'a'.repeat(64);
  test('contains only allowlisted audience, return, and random state', () => {
    const u = new URL(buildAccountRecoveryUrl(state));
    expect(u.origin + u.pathname).toBe('https://wellbuilt-sync.web.app/account-recovery/');
    expect([...u.searchParams.keys()].sort()).toEqual(['audience','return_uri','state']);
    expect(u.searchParams.get('state')).toBe(state);
  });
  test('rejects arbitrary and mismatched returns', () => {
    expect(classifyRecoveryReturn(state, `wellbuilt-mobile://account-recovery?outcome=success&state=${state}`)).toBe('success');
    expect(classifyRecoveryReturn(state, `https://evil.invalid?outcome=success&state=${state}`)).toBe('ignore');
    expect(classifyRecoveryReturn(state, 'wellbuilt-mobile://account-recovery?outcome=success&state=wrong')).toBe('ignore');
  });
});
