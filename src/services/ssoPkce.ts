/**
 * PKCE for WB-M. Verifier originates and stays in WB-M SecureStore.
 * Never placed in a URL.
 *
 * Attempts are keyed by state, expire, and do not overlap. The verifier
 * is compared against the callback state BEFORE any delete.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const ACTIVE_STATE_KEY = 'wbm_sso_active_state';
const ATTEMPT_PREFIX = 'wbm_sso_attempt_';
const ATTEMPT_TTL_MS = 10 * 60 * 1000;

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

type PkceAttempt = {
  verifier: string;
  state: string;
  createdAt: number;
};

function attemptKey(state: string): string {
  return `${ATTEMPT_PREFIX}${state}`;
}

async function readAttempt(state: string): Promise<PkceAttempt | null> {
  const raw = await SecureStore.getItemAsync(attemptKey(state));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PkceAttempt;
    if (!parsed?.verifier || !parsed?.state || !parsed?.createdAt) return null;
    if (Date.now() - parsed.createdAt > ATTEMPT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function beginWbmPkce(): Promise<{
  state: string;
  codeChallenge: string;
  authorizeUrl: string;
}> {
  const active = await SecureStore.getItemAsync(ACTIVE_STATE_KEY);
  if (active) {
    const existing = await readAttempt(active);
    if (existing) {
      throw new Error('sso_attempt_in_progress');
    }
    await SecureStore.deleteItemAsync(attemptKey(active));
    await SecureStore.deleteItemAsync(ACTIVE_STATE_KEY);
  }

  const rawV = await Crypto.getRandomBytesAsync(32);
  const rawS = await Crypto.getRandomBytesAsync(32);
  const verifier = b64url(rawV);
  const state = b64url(rawS);
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  const codeChallenge = digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const attempt: PkceAttempt = { verifier, state, createdAt: Date.now() };
  await SecureStore.setItemAsync(attemptKey(state), JSON.stringify(attempt));
  await SecureStore.setItemAsync(ACTIVE_STATE_KEY, state);
  const params = new URLSearchParams({
    v: '1',
    aud: 'wellbuilt-mobile',
    cc: codeChallenge,
    ccm: 'S256',
    state,
  });
  return {
    state,
    codeChallenge,
    authorizeUrl: `wellbuilt-suite://sso-authorize?${params.toString()}`,
  };
}

export async function takeWbmPkce(state: string): Promise<string> {
  const expectedActive = await SecureStore.getItemAsync(ACTIVE_STATE_KEY);
  const attempt = await readAttempt(state);
  if (!attempt || !expectedActive || expectedActive !== state || attempt.state !== state) {
    throw new Error('sso_state_mismatch');
  }
  await SecureStore.deleteItemAsync(attemptKey(state));
  await SecureStore.deleteItemAsync(ACTIVE_STATE_KEY);
  return attempt.verifier;
}
