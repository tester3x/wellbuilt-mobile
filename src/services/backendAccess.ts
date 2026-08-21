/**
 * Classified RTDB reads. Missing paths are not_found.
 * Auth, permission, timeout, and transport failures are NEVER collapsed
 * into "the record does not exist" — that was stranding edits as
 * "awaiting server" after a session failure.
 */

import {
  ConnectionDiagnosis,
  diagnoseHttpStatus,
  diagnoseThrown,
} from './connectionDiagnosis';

const FIREBASE_DATABASE_URL = 'https://wellbuilt-sync-default-rtdb.firebaseio.com';

export interface BackendReadResult<T = unknown> {
  found: boolean;
  data: T | null;
  diagnosis: ConnectionDiagnosis | null;
}

export async function readJsonPath(
  path: string,
  fetchFn: typeof fetch = fetch,
): Promise<BackendReadResult> {
  try {
    let token = 'missing';
    try {
      const { getValidIdToken } = await import('./firebaseAuthSession');
      token = await getValidIdToken();
    } catch (err) {
      if (fetchFn === fetch) {
        return { found: false, data: null, diagnosis: diagnoseThrown(err) };
      }
      /* injected fetchFn in unit tests — proceed without a live token */
    }
    if (token === 'missing' && fetchFn === fetch) {
      return {
        found: false,
        data: null,
        diagnosis: { kind: 'auth_session', code: 'id_token_required', retryable: false },
      };
    }
    const res = await fetchFn(
      `${FIREBASE_DATABASE_URL}/${path}.json?auth=${encodeURIComponent(token)}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    );
    if (!res.ok) {
      const d = diagnoseHttpStatus(res.status);
      if (res.status === 404) return { found: false, data: null, diagnosis: null };
      return { found: false, data: null, diagnosis: d };
    }
    const body = await res.json();
    if (body == null) return { found: false, data: null, diagnosis: null };
    return { found: true, data: body, diagnosis: null };
  } catch (err) {
    return { found: false, data: null, diagnosis: diagnoseThrown(err) };
  }
}

/** Packet-id local timestamp → display string. Display only; never a calc input. */
export function displayTimeFromPacketId(packetId: string | null | undefined): string {
  if (!packetId) return '';
  const m = String(packetId).match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!m) return '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (![year, month, day, hour, minute].every((n) => Number.isFinite(n))) return '';
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${month}/${day}/${year} ${hour12}:${String(minute).padStart(2, '0')} ${ampm}`;
}
