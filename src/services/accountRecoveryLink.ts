import { Linking } from 'react-native';
import * as Crypto from 'expo-crypto';

export const ACCOUNT_RECOVERY_URL = 'https://wellbuilt-sync.web.app/account-recovery/';
export const WBM_RECOVERY_RETURN = 'wellbuilt-mobile://account-recovery';

export function buildAccountRecoveryUrl(state: string): string {
  if (!/^[a-f0-9]{64}$/.test(state)) throw new Error('invalid recovery state');
  const url = new URL(ACCOUNT_RECOVERY_URL);
  url.searchParams.set('audience', 'wellbuilt-mobile');
  url.searchParams.set('return_uri', WBM_RECOVERY_RETURN);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function openAccountRecovery(): Promise<string> {
  const state = (await Crypto.getRandomBytesAsync(32))
    .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
  await Linking.openURL(buildAccountRecoveryUrl(state));
  return state;
}

export function classifyRecoveryReturn(expectedState: string, url: string): 'success' | 'cancel' | 'ignore' {
  try {
    const parsed = new URL(url);
    if (`${parsed.protocol}//${parsed.host}` !== WBM_RECOVERY_RETURN) return 'ignore';
    if (!expectedState || parsed.searchParams.get('state') !== expectedState) return 'ignore';
    const outcome = parsed.searchParams.get('outcome');
    return outcome === 'success' ? 'success' : outcome === 'cancel' ? 'cancel' : 'ignore';
  } catch { return 'ignore'; }
}
