jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
      setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
      removeItem: jest.fn(async (k: string) => { delete store[k]; }),
    },
  };
});

const mockSecure: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => (k in mockSecure ? mockSecure[k] : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockSecure[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockSecure[k]; }),
}));
jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn() }));
jest.mock('expo-device', () => ({ modelName: 'test' }));

let mockUser: { uid: string } | null = { uid: 'uid-zfold' };
const mockCallable = jest.fn();
jest.mock('../firebaseAuthSession', () => ({
  authorizedCallable: (...args: unknown[]) => mockCallable(...args),
  persistCustomTokenSession: jest.fn(async () => {
    mockUser = { uid: mockSecure.wb_auth_uid || 'uid-zfold' };
    return { idToken: 'id', refreshToken: 'rt' };
  }),
  clearAuthSession: jest.fn(async () => { mockUser = null; }),
  getFirebaseAuth: () => ({ currentUser: mockUser }),
  getValidIdToken: jest.fn(async () => 'id'),
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import { completeAuthenticatedSession } from '../driverAuth';
import {
  fetchAssignmentClassified,
  filterWellConfigByAssignment,
  loadWellConfig,
  parseBootstrapEnvelope,
  peekWellConfigCacheForTests,
  resetWellConfigCacheForTests,
  scopedWellsForDisplay,
  seedWellConfigCacheForTests,
  WellConfigUnavailableError,
} from '../wellConfig';
import { authorizeEstablishedSession } from '../postAuthGate';
import { decidePostAuthRoute, verdictFromAuthoritative } from '../eligibility';
import { secureIngestPacket } from '../secureOperationalApi';
import { mintPacketId } from '../firebase';
import { snapshotToEnvelope, type WbmBootstrapSnapshot } from '../wbmBootstrapCache';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const appSrc = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

const MIKEZFOLD = '2cad521c-13ac-4b6c-b1ab-07843c6bf06f';
const MIKES24 = '99ff4b35-51ab-4d45-8d54-18b3b8515c9b';

function snap(driverId: string, routes: string[], wells: string[] = []): WbmBootstrapSnapshot {
  const catalog: Record<string, { allowedBottom: number; numTanks: number; loadLine: number; route: string }> = {};
  for (const route of routes) {
    catalog[`${route} 1`] = { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route };
  }
  for (const well of wells) {
    catalog[well] = catalog[well] || { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Direct' };
  }
  return {
    ok: true,
    driverId,
    companyId: 'liquid-gold',
    active: true,
    assignedRoutes: routes,
    assignedWells: wells,
    assignmentRevision: 1,
    assignmentDigest: `dig-${driverId}`,
    eligibilityStatus: 'eligible',
    eligibilityReason: 'scope_ok',
    wells: catalog,
    wellCount: Object.keys(catalog).length,
    logoutAt: null,
  };
}

describe('aligned recovery: one secure canonical route/well source', () => {
  beforeEach(() => {
    resetWellConfigCacheForTests();
    mockCallable.mockReset();
    for (const k of Object.keys(mockSecure)) delete mockSecure[k];
  });

  it('manual login receives the exact profile route/well scope from bootstrapWbmSession', async () => {
    const live = snap(MIKEZFOLD, ['Gabriels'], ['Watford 1']);
    mockCallable.mockImplementation(async (name: string) => {
      if (name === 'bootstrapWbmSession') return live;
      throw new Error(`unexpected ${name}`);
    });
    mockSecure.wb_auth_uid = 'uid-zfold';
    mockUser = { uid: 'uid-zfold' };
    const session = await completeAuthenticatedSession({
      customToken: 'tok-zfold',
      driverId: MIKEZFOLD,
      displayName: 'Mikezfold',
      companyId: 'liquid-gold',
      authMethod: 'manual',
      assignedRoutes: ['Gabriels'],
    });
    expect(session.driverId).toBe(MIKEZFOLD);
    expect(mockCallable).toHaveBeenCalledWith('bootstrapWbmSession', {});
    const wells = await loadWellConfig(true);
    expect(Object.keys(wells || {}).sort()).toEqual(['Gabriels 1', 'Watford 1']);
    expect(peekWellConfigCacheForTests().envelope?.driverId).toBe(MIKEZFOLD);
    expect(peekWellConfigCacheForTests().envelope?.eligibility.routes).toEqual(['Gabriels']);
  });

  it('SSO login receives the same canonical scope', async () => {
    const live = snap(MIKEZFOLD, ['Gabriels']);
    mockCallable.mockResolvedValue(live);
    mockSecure.wb_auth_uid = 'uid-zfold';
    mockUser = { uid: 'uid-zfold' };
    await completeAuthenticatedSession({
      customToken: 'tok-sso',
      driverId: MIKEZFOLD,
      displayName: 'Mikezfold',
      companyId: 'liquid-gold',
      authMethod: 'sso',
    });
    expect(mockCallable).toHaveBeenCalledWith('bootstrapWbmSession', {});
    const v = await fetchAssignmentClassified();
    expect(v.status).toBe('eligible');
    expect(v.routes).toEqual(['Gabriels']);
  });

  it('cold start restore cannot use another identity cache', async () => {
    seedWellConfigCacheForTests(snapshotToEnvelope(snap(MIKEZFOLD, ['Gabriels'])));
    mockSecure.driverId = MIKES24;
    mockSecure.companyId = 'liquid-gold';
    mockCallable.mockRejectedValue(new Error('failed-precondition: scope_missing'));
    await expect(loadWellConfig()).rejects.toBeInstanceOf(WellConfigUnavailableError);
    expect(peekWellConfigCacheForTests().envelope?.driverId).not.toBe(MIKEZFOLD);
  });

  it('session-verify retry and Settings both go through live bootstrapWbmSession', () => {
    const verify = appSrc('app/session-verify.tsx');
    const settings = appSrc('app/settings.tsx');
    const index = appSrc('app/index.tsx');
    const gate = src('postAuthGate.ts');
    const well = src('wellConfig.ts');
    expect(verify).toMatch(/authorizeEstablishedSession/);
    expect(index).toMatch(/authorizeEstablishedSession/);
    expect(gate).toMatch(/resolveCurrentEligibility/);
    expect(well).toMatch(/fetchAssignmentClassified/);
    expect(well).toMatch(/bootstrapWbmSession/);
    expect(settings).toMatch(/loadWellConfig\(true\)/);
  });

  it('Mikezfold and MikeS24 cannot share cached routes/wells', async () => {
    seedWellConfigCacheForTests(snapshotToEnvelope(snap(MIKEZFOLD, ['Gabriels'])));
    mockSecure.driverId = MIKES24;
    mockSecure.companyId = 'liquid-gold';
    mockCallable.mockResolvedValue(snap(MIKES24, ['Watford']));
    const wells = await loadWellConfig(true);
    expect(Object.keys(wells || {})).toEqual(['Watford 1']);
    expect(peekWellConfigCacheForTests().envelope?.driverId).toBe(MIKES24);
    expect(peekWellConfigCacheForTests().config?.['Gabriels 1']).toBeUndefined();
  });

  it('denied bootstrap is unknown/retryable, not empty ineligible', async () => {
    mockSecure.driverId = MIKEZFOLD;
    mockSecure.companyId = 'liquid-gold';
    mockCallable.mockRejectedValue(new Error('permission-denied'));
    const v = await fetchAssignmentClassified();
    expect(v.status).toBe('unknown');
    expect(v.retryable).toBe(true);
    expect(decidePostAuthRoute({
      hasLocalSession: true,
      revalidation: 'valid',
      eligibility: 'unknown',
      eligibleDestination: '/welcome',
    })).toBe('/session-verify');
  });

  it('malformed profile scope does not silently become an empty assignment', () => {
    const v = verdictFromAuthoritative({ not: 'an-array' }, null);
    expect(v.status).toBe('unknown');
    expect(v.retryable).toBe(true);
    expect(v.routes).toBeNull();
    expect(scopedWellsForDisplay(
      { 'Gabriel 1': { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Gabriels' } },
      { routes: [], wells: [], status: 'unknown', reason: 'scope_malformed' },
    )).toEqual({});
  });

  it('no client GET of drivers/profiles/{driverId} or API-key well_config parent read', () => {
    const well = src('wellConfig.ts');
    const auth = src('driverAuth.ts');
    const secure = src('secureDriverAuth.ts');
    expect(well).not.toMatch(/drivers\/profiles\/\$\{/);
    expect(well).not.toMatch(/well_config\.json\?auth=/);
    expect(well).not.toMatch(/FIREBASE_API_KEY/);
    expect(auth).not.toMatch(/bootstrapDriverSession/);
    expect(secure).not.toMatch(/bootstrapDriverSession/);
    expect(well).toMatch(/bootstrapWbmSession/);
    expect(parseBootstrapEnvelope({ status: 'eligible' })).toBeNull();
  });
});

describe('aligned recovery: pull origin and pipeline preservation', () => {
  beforeEach(() => {
    mockCallable.mockReset();
    mockCallable.mockResolvedValue({ ok: true, key: 'k1' });
  });

  it('a WB-M pull for an assigned well uses ingestWbmPull { packet } only', async () => {
    const packet = {
      requestType: 'pull',
      wellName: 'Gabriel 1',
      packetId: '20260820_124211_Gabriel1_frr2t3',
      tankLevelFeet: 9.583333333333334,
      bblsTaken: 140,
      dateTimeUTC: '2026-08-20T17:42:02.991Z',
      idempotencyKey: '20260820_124211_Gabriel1_frr2t3',
    };
    await secureIngestPacket(packet);
    expect(mockCallable).toHaveBeenCalledWith('ingestWbmPull', { packet });
    expect(mockCallable.mock.calls[0][1]).not.toHaveProperty('assignedRoutes');
    expect(JSON.stringify(mockCallable.mock.calls[0][1])).not.toMatch(/assignedRoutes|assignedWells/);
  });

  it('WB-M does not ingest WB-T jobs or mutate route profiles from a pull', () => {
    const api = src('secureOperationalApi.ts');
    const firebase = src('firebase.ts');
    expect(api).toMatch(/ingestWbmPull/);
    expect(api).not.toMatch(/['"]ingestDriverPacket['"]/);
    expect(firebase).toMatch(/secureIngestPacket/);
    expect(firebase).toMatch(/not writing public incoming/);
    expect(firebase).toMatch(/requestType: 'pull'/);
    expect(src('wellConfig.ts')).not.toMatch(/ingestWbmPull/);
  });

  it('packet identity format remains YYYYMMDD_HHMMSS_Well_rand6', () => {
    const id = mintPacketId('Gabriel 1', new Date('2026-08-20T17:42:11.000Z'));
    expect(id).toMatch(/^20260820_\d{6}_Gabriel1_[a-z0-9]{6}$/);
  });

  it('visible-well filter still gates which wells a driver can open/pull', () => {
    const pool = {
      'Gabriel 1': { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Gabriels' },
      'Watford 1': { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Watford' },
    };
    expect(Object.keys(filterWellConfigByAssignment(pool, ['Gabriels'], []))).toEqual(['Gabriel 1']);
    expect(filterWellConfigByAssignment(pool, [], [])).toEqual({});
  });

  it('offline/idempotency source still mints one packetId and does not fall back to public incoming', () => {
    const firebase = src('firebase.ts');
    const queue = src('packetQueue.ts');
    expect(firebase).toMatch(/retries\/replays are idempotent/);
    expect(queue).toMatch(/mintPacketId/);
    expect(firebase).toMatch(/not writing public incoming/);
  });
});
