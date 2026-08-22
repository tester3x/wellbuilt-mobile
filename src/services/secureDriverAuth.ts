/**
 * WB-M secure login. Always uses authenticateDriver.
 * Firebase custom-token sign-in happens inside completeAuthenticatedSession
 * so the whole establishment is one owned session transition.
 */

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
  return data;
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

export async function changeOwnPasscode(params: {
  currentPasscode: string;
  newPasscode: string;
}) {
  const { authorizedCallable } = await import('./firebaseAuthSession');
  return authorizedCallable<{ ok: true }>('driverChangeOwnPasscode', {
    currentPasscode: params.currentPasscode,
    newPasscode: params.newPasscode,
  });
}

export async function upgradeOwnLegacyLogin(params: {
  displayName: string;
  currentPasscode: string;
  newPasscode: string;
}) {
  return callUnauthed<{
    driverId: string;
    displayName: string;
    conflicts: unknown[];
    preserved: string[];
    copiedFields: string[];
  }>('upgradeOwnLegacyDriverLogin', {
    displayName: params.displayName,
    currentPasscode: params.currentPasscode,
    newPasscode: params.newPasscode,
  });
}

export async function checkDriverRegistrationStatus(pendingId: string) {
  return callUnauthed<{ status: 'none' | 'pending' | 'approved' | 'rejected'; driverId?: string | null }>(
    'checkDriverRegistrationStatus',
    { pendingId },
  );
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
  if (!data.customToken) {
    throw new Error('ssoExchangeAuthorizationCode did not return a Firebase custom token');
  }
  return data;
}
