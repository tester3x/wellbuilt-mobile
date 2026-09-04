// RELEASE-BLOCKER regression suite: the signed-in DRIVER SESSION must survive a
// process restart / install -r even if expo-secure-store's Android-Keystore-backed
// entries are invalidated. The fix mirrors the (non-secret) driver identity to
// AsyncStorage and re-hydrates SecureStore from it; only an explicit Logout (or a
// genuine server revocation) clears it. These tests exercise that deterministically.

const asyncStore: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (k in asyncStore ? asyncStore[k] : null)),
    setItem: jest.fn(async (k: string, v: string) => { asyncStore[k] = v; }),
    removeItem: jest.fn(async (k: string) => { delete asyncStore[k]; }),
  },
}));

const mockSecure: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => (k in mockSecure ? mockSecure[k] : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockSecure[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockSecure[k]; }),
}));
jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn() }));
jest.mock('expo-device', () => ({ modelName: 'test' }));

let mockVerify: () => Promise<{ driverId: string; companyId: string; active: unknown }> =
  async () => ({ driverId: 'drv-1', companyId: 'liquid-gold', active: true });
jest.mock('../firebaseAuthSession', () => ({
  verifySessionOnServer: () => mockVerify(),
  clearAuthSession: jest.fn(async () => { delete mockSecure.wb_auth_uid; }),
  getFirebaseAuth: () => ({ currentUser: { uid: 'uid-1' } }),
}));

import * as SecureStore from 'expo-secure-store';
import {
  saveDriverSession, getDriverSession, getDriverId, getDriverName, isDriverVerified,
  revalidateDriverSessionClassified, performPermittedLogout, captureCurrentSessionPermit,
} from '../driverAuth';

const MIRROR_KEY = '@wellbuilt_driver_identity_v1';

/** Simulate a process restart where SecureStore's keystore entries were invalidated
 *  (install -r / cold boot) but AsyncStorage (plain file) survived. */
function invalidateSecureStoreKeepAsync() {
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
}

async function signInDrv1() {
  // wb_auth_uid is needed for the logout permit; the app writes it via persistCustomTokenSession.
  await SecureStore.setItemAsync('wb_auth_uid', 'uid-1');
  await saveDriverSession('drv-1', 'MikeS24', undefined, false, false, 'liquid-gold', 'Liquid Gold', undefined, 'manual', {
    roles: ['driver'], assignedRoutes: ['Test Route'], assignedCustomers: undefined,
  });
}

beforeEach(() => {
  for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  for (const k of Object.keys(asyncStore)) delete asyncStore[k];
  mockVerify = async () => ({ driverId: 'drv-1', companyId: 'liquid-gold', active: true });
});

describe('driver session survives process restart (identity mirror)', () => {
  test('sign in → persist → cold boot (SecureStore invalidated) → STILL signed in', async () => {
    await signInDrv1();
    expect(asyncStore[MIRROR_KEY]).toBeTruthy();          // mirror written on login

    invalidateSecureStoreKeepAsync();                      // process restart / install -r
    expect(mockSecure.driverId).toBeUndefined();

    const session = await getDriverSession();
    expect(session).not.toBeNull();
    expect(session!.driverId).toBe('drv-1');
    expect(session!.displayName).toBe('MikeS24');
    expect(session!.companyId).toBe('liquid-gold');
    expect(session!.authMethod).toBe('manual');
    expect(session!.assignedRoutes).toEqual(['Test Route']);
    expect(await isDriverVerified()).toBe(true);           // NOT shown Driver Login
  });

  test('getDriverSession RE-HYDRATES SecureStore from the mirror (self-heal)', async () => {
    await signInDrv1();
    invalidateSecureStoreKeepAsync();
    await getDriverSession();
    expect(mockSecure.driverId).toBe('drv-1');             // SecureStore repopulated
    expect(mockSecure.driverName).toBe('MikeS24');
    expect(mockSecure.companyId).toBe('liquid-gold');
  });

  test('getDriverId / getDriverName fall back to the mirror when SecureStore is empty', async () => {
    await signInDrv1();
    invalidateSecureStoreKeepAsync();
    expect(await getDriverId()).toBe('drv-1');             // never wrongly "No driverId"
    expect(await getDriverName()).toBe('MikeS24');
  });

  test('reading from the mirror does NOT clear it; repeated cold reads are stable', async () => {
    await signInDrv1();
    invalidateSecureStoreKeepAsync();
    for (let i = 0; i < 3; i++) {
      invalidateSecureStoreKeepAsync();                    // re-simulate a fresh restart each time
      expect((await getDriverSession())!.driverId).toBe('drv-1');
    }
    expect(asyncStore[MIRROR_KEY]).toBeTruthy();           // mirror intact
  });
});

describe('malformed persisted state fails safely', () => {
  test('garbage mirror JSON → getDriverSession returns null (no crash)', async () => {
    asyncStore[MIRROR_KEY] = '{not valid json';
    invalidateSecureStoreKeepAsync();
    expect(await getDriverSession()).toBeNull();
    expect(await getDriverId()).toBeNull();
  });

  test('mirror missing driverId → treated as absent', async () => {
    asyncStore[MIRROR_KEY] = JSON.stringify({ driverName: 'X' });
    invalidateSecureStoreKeepAsync();
    expect(await getDriverSession()).toBeNull();
  });
});

describe('explicit Logout is the only ordinary clear', () => {
  test('performPermittedLogout clears BOTH SecureStore and the mirror', async () => {
    await signInDrv1();
    const permit = await captureCurrentSessionPermit();
    expect(permit).not.toBeNull();
    await performPermittedLogout(permit!);
    expect(mockSecure.driverId).toBeUndefined();
    expect(asyncStore[MIRROR_KEY]).toBeUndefined();        // mirror gone
    expect(await getDriverSession()).toBeNull();           // genuinely logged out
    expect(await getDriverId()).toBeNull();
  });
});

describe('revalidation never destroys a valid session on ambiguity', () => {
  test('server confirms active + matching driverId → valid', async () => {
    await signInDrv1();
    mockVerify = async () => ({ driverId: 'drv-1', companyId: 'liquid-gold', active: true });
    expect(await revalidateDriverSessionClassified()).toBe('valid');
  });

  test('server active NOT strictly true (shape drift) → unknown (HOLD, not revoked)', async () => {
    await signInDrv1();
    mockVerify = async () => ({ driverId: 'drv-1', companyId: 'liquid-gold', active: 'true' as unknown });
    expect(await revalidateDriverSessionClassified()).toBe('unknown');
  });

  test('server throws (expired token / network) → unknown (HOLD, not revoked)', async () => {
    await signInDrv1();
    mockVerify = async () => { throw new Error('token expired'); };
    expect(await revalidateDriverSessionClassified()).toBe('unknown');
  });

  test('server maps this account to a DIFFERENT driver → revoked (genuine identity change)', async () => {
    await signInDrv1();
    mockVerify = async () => ({ driverId: 'someone-else', companyId: 'liquid-gold', active: true });
    expect(await revalidateDriverSessionClassified()).toBe('revoked');
  });

  test('missing session at revalidation → unknown (hydration), never revoked', async () => {
    // nothing signed in
    invalidateSecureStoreKeepAsync();
    expect(await revalidateDriverSessionClassified()).toBe('unknown');
  });
});
