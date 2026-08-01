/**
 * Secure driver auth via Cloud Functions (callable REST).
 * Prefer over open RTDB hash login during dual-run; required after enforcement.
 */
const PROJECT_ID = 'wellbuilt-sync';
const REGION = 'us-central1';
const API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
const CALLABLE_BASE = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

async function callCallable<T>(name: string, data: Record<string, unknown>): Promise<T> {
  const resp = await fetch(`${CALLABLE_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || body.error) {
    throw new Error(body?.error?.message || `Callable ${name} failed (${resp.status})`);
  }
  return body.result as T;
}

export async function secureLogin(displayName: string, passcode: string) {
  const data = await callCallable<{
    customToken: string;
    driverId: string;
    displayName: string;
    legalName?: string;
    companyId?: string;
    companyName?: string;
    isAdmin?: boolean;
    isViewer?: boolean;
  }>('authenticateDriver', { displayName, passcode });

  if (data.customToken) {
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: data.customToken, returnSecureToken: true }),
    });
    const body = await resp.json();
    if (!resp.ok) throw new Error(body?.error?.message || 'Token exchange failed');
    // Caller may persist body.idToken for authenticated FS/RTDB
    (data as any).idToken = body.idToken;
    (data as any).refreshToken = body.refreshToken;
  }
  return data;
}

export async function secureRegister(params: {
  displayName: string;
  passcode: string;
  companyName?: string;
  legalName?: string;
}) {
  return callCallable<{ pendingId: string; status: string }>('requestDriverRegistration', {
    ...params,
    source: 'wbm',
  });
}
