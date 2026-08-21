/**
 * Suite-owned SSO logout. Manual WB-M login ignores Suite logoutAt.
 * Decision uses a LIVE bootstrap logoutAt, never a cached envelope.
 * The live decision is bound to the exact session that started the check
 * and is handed off as an identity-bound permit, never a bare boolean.
 */
import { getSessionGeneration, type SessionLogoutPermit } from './wbmSessionFence';

export type BoundSsoLogoutCapture = {
  generation: number;
  driverId: string;
  companyId: string;
  authMethod: string;
  driverVerifiedAt: string;
  authUid: string;
};

export type BoundSsoLogoutCurrent = {
  generation: number;
  driverId: string | null;
  companyId: string | null;
  authMethod: string | null;
  driverVerifiedAt: string | null;
  authUid: string | null;
};

export type { SessionLogoutPermit };

export function evaluateSsoLogout(input: {
  authMethod: string | null;
  verifiedAtMs: number | null;
  liveLogoutAtMs: number | null;
}): 'logout' | 'keep' {
  if (input.authMethod !== 'sso') return 'keep';
  if (input.liveLogoutAtMs == null || !Number.isFinite(input.liveLogoutAtMs)) return 'keep';
  if (input.verifiedAtMs == null || !Number.isFinite(input.verifiedAtMs)) return 'keep';
  return input.liveLogoutAtMs > input.verifiedAtMs ? 'logout' : 'keep';
}

export function normalizeLogoutAt(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) return asNum;
  }
  return null;
}

/**
 * Identity-fenced Suite logout. Unavailable, stale, or mismatched
 * live responses KEEP the current session and must never log out a
 * different or newer driver.
 */
export function evaluateBoundSsoLogout(input: {
  capture: BoundSsoLogoutCapture;
  current: BoundSsoLogoutCurrent;
  response: { driverId?: unknown; companyId?: unknown; logoutAt?: unknown } | null | undefined;
  hasAuthSession: boolean;
}): 'logout' | 'keep' {
  if (!input.hasAuthSession) return 'keep';
  const { capture, current, response } = input;
  if (capture.generation !== current.generation) return 'keep';
  if (!capture.driverId || capture.driverId !== current.driverId) return 'keep';
  if (capture.companyId !== (current.companyId || '')) return 'keep';
  if (capture.authMethod !== 'sso' || current.authMethod !== 'sso') return 'keep';
  if (!capture.driverVerifiedAt || capture.driverVerifiedAt !== current.driverVerifiedAt) return 'keep';
  if (!capture.authUid || capture.authUid !== current.authUid) return 'keep';
  if (!response || typeof response !== 'object') return 'keep';
  if (typeof response.driverId !== 'string' || !response.driverId) return 'keep';
  if (typeof response.companyId !== 'string') return 'keep';
  if (response.driverId !== capture.driverId || response.driverId !== current.driverId) return 'keep';
  if (response.companyId !== capture.companyId || response.companyId !== (current.companyId || '')) return 'keep';
  const liveLogoutAtMs = normalizeLogoutAt(response.logoutAt);
  if (liveLogoutAtMs == null) return 'keep';
  return evaluateSsoLogout({
    authMethod: 'sso',
    verifiedAtMs: Number(capture.driverVerifiedAt),
    liveLogoutAtMs,
  });
}

function readLiveAuthUid(getFirebaseAuth: () => { currentUser?: { uid?: string } | null }): string | null {
  try {
    return getFirebaseAuth().currentUser?.uid || null;
  } catch {
    return null;
  }
}

/**
 * Live Suite logout check. Captures generation + identity + Auth UID
 * BEFORE the callable, then re-reads after it resolves.
 * Returns an identity-bound permit or null (KEEP). Does not log out.
 */
export async function checkCanonicalSsoLogout(): Promise<SessionLogoutPermit | null> {
  try {
    const SecureStore = await import('expo-secure-store');
    const { authorizedCallable, getFirebaseAuth } = await import('./firebaseAuthSession');

    const driverId = await SecureStore.getItemAsync('driverId');
    const companyId = (await SecureStore.getItemAsync('companyId')) || '';
    const authMethod = await SecureStore.getItemAsync('authMethod');
    const driverVerifiedAt = await SecureStore.getItemAsync('driverVerifiedAt');
    const authUid = readLiveAuthUid(getFirebaseAuth)
      || (await SecureStore.getItemAsync('wb_auth_uid'));
    if (authMethod !== 'sso' || !driverId || !driverVerifiedAt || !authUid) return null;

    const generation = getSessionGeneration();

    const snap = await authorizedCallable<{
      driverId?: unknown;
      companyId?: unknown;
      logoutAt?: unknown;
    }>('bootstrapWbmSession', {});

    const current: BoundSsoLogoutCurrent = {
      generation: getSessionGeneration(),
      driverId: await SecureStore.getItemAsync('driverId'),
      companyId: await SecureStore.getItemAsync('companyId'),
      authMethod: await SecureStore.getItemAsync('authMethod'),
      driverVerifiedAt: await SecureStore.getItemAsync('driverVerifiedAt'),
      authUid: readLiveAuthUid(getFirebaseAuth)
        || (await SecureStore.getItemAsync('wb_auth_uid')),
    };

    const hasAuthSession = !!current.authUid;
    if (evaluateBoundSsoLogout({
      capture: { generation, driverId, companyId, authMethod, driverVerifiedAt, authUid },
      current,
      response: snap,
      hasAuthSession,
    }) !== 'logout') {
      return null;
    }

    return {
      generation,
      driverId,
      companyId,
      authMethod,
      driverVerifiedAt,
      authUid,
    };
  } catch {
    return null;
  }
}
