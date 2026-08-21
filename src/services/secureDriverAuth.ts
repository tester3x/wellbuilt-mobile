/**
 * WB-M secure login. Always uses authenticateDriver + a real Firebase session.
 * Never falls back to drivers/approved/{hash}.
 */
import { persistCustomTokenSession } from './firebaseAuthSession';

const PROJECT_ID = 'wellbuilt-sync';
const REGION = 'us-central1';
const CALLABLE_BASE = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

async function callUnauthed<T>(name: string, data: Record<string, unknown>): Promise<T> {
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
  const data = await callUnauthed<{
    customToken: string | null;
    driverId: string;
    displayName: string;
    legalName?: string;
    companyId?: string;
    companyName?: string;
    isAdmin?: boolean;
    isViewer?: boolean;
    roles?: string[];
    assignedRoutes?: unknown;
    assignedCustomers?: unknown;
    tier?: string | null;
  }>('authenticateDriver', { displayName, passcode });

  if (!data.customToken) {
    throw new Error('authenticateDriver did not return a Firebase custom token');
  }
  const session = await persistCustomTokenSession(data.customToken);
  return { ...data, idToken: session.idToken, refreshToken: session.refreshToken };
}

export async function secureRegister(params: {
  displayName: string;
  passcode: string;
  companyName?: string;
  legalName?: string;
}) {
  return callUnauthed<{ pendingId: string; status: string }>('requestDriverRegistration', {
    ...params,
    source: 'wbm',
  });
}

export async function checkDriverRegistrationStatus(pendingId: string) {
  return callUnauthed<{ status: 'none' | 'pending' | 'approved' | 'rejected'; driverId?: string | null }>(
    'checkDriverRegistrationStatus',
    { pendingId },
  );
}

export async function bootstrapDriverSession() {
  const { authorizedCallable } = await import('./firebaseAuthSession');
  return authorizedCallable<{
    driverId: string;
    companyId: string;
    displayName: string | null;
    legalName: string | null;
    companyName: string | null;
    isAdmin: boolean;
    isViewer: boolean;
    roles: string[];
    tier: string | null;
    assignedRoutes: unknown;
    assignedWells: unknown;
    assignedCustomers: unknown;
    dashboardUid: string | null;
    dashboardRole: string | null;
    defaultPackageId: string | null;
    active: true;
  }>('bootstrapDriverSession', {});
}

export async function exchangeSsoCode(params: {
  code: string;
  codeVerifier: string;
}) {
  const data = await callUnauthed<{
    customToken: string;
    driverId: string;
    companyId: string;
    displayName?: string | null;
  }>('ssoExchangeAuthorizationCode', {
    protocolVersion: 1,
    audience: 'wellbuilt-mobile',
    code: params.code,
    codeVerifier: params.codeVerifier,
  });
  const session = await persistCustomTokenSession(data.customToken);
  return { ...data, idToken: session.idToken, refreshToken: session.refreshToken };
}
