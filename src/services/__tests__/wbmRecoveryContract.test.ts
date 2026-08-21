jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
const mockSecure: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => (k in mockSecure ? mockSecure[k] : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockSecure[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockSecure[k]; }),
}));

const mockCallable = jest.fn();
jest.mock('../firebaseAuthSession', () => ({
  authorizedCallable: (...args: unknown[]) => mockCallable(...args),
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  filterWellConfigByAssignment,
  loadWellConfig,
  resetWellConfigCacheForTests,
  scopedWellsForDisplay,
  WellConfigUnavailableError,
  WellConfigMap,
} from '../wellConfig';
import { secureIngestPacket, secureSubmitFieldCommand, getFieldCommandStatus } from '../secureOperationalApi';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const rootSrc = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

const pool: WellConfigMap = {
  'Gabriel 1': { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Gabriels' },
  'Watford 1': { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Watford' },
  'Other Route 1': { allowedBottom: 3, numTanks: 1, loadLine: 1.33, route: 'Other Route' },
};

describe('WB-M route-scoped well display', () => {
  it('a routed driver sees only wells on permitted routes', () => {
    const out = filterWellConfigByAssignment(pool, ['Gabriels'], []);
    expect(Object.keys(out)).toEqual(['Gabriel 1']);
  });

  it('directly permitted wells follow assignedWells', () => {
    const out = filterWellConfigByAssignment(pool, ['Gabriels'], ['Watford 1']);
    expect(Object.keys(out).sort()).toEqual(['Gabriel 1', 'Watford 1']);
  });

  it('empty assignment is not all-company-wells', () => {
    expect(filterWellConfigByAssignment(pool, [], [])).toEqual({});
  });

  it('unknown or ineligible assignment fail closed', () => {
    expect(scopedWellsForDisplay(pool, { routes: [], wells: [], status: 'unknown', reason: 'assigned_routes_missing' })).toEqual({});
    expect(scopedWellsForDisplay(pool, { routes: [], wells: [], status: 'ineligible', reason: 'explicit_empty' })).toEqual({});
    expect(scopedWellsForDisplay(pool, { routes: ['Unrouted'], wells: [], status: 'ineligible', reason: 'unrouted_only' })).toEqual({});
  });
});

describe('pull ingest uses deployed ingestDriverPacket envelope', () => {
  beforeEach(() => {
    mockCallable.mockReset();
    mockCallable.mockResolvedValue({ ok: true, key: 'k1' });
  });

  it('secureIngestPacket calls ingestDriverPacket with { packet }', async () => {
    const packet = { requestType: 'pull', wellName: 'Gabriel 1', idempotencyKey: 'abc12345' };
    await secureIngestPacket(packet);
    expect(mockCallable).toHaveBeenCalledWith('ingestWbmPull', { packet });
  });

  it('edit/history/control commands fail explicitly', async () => {
    await expect(secureSubmitFieldCommand({ requestType: 'edit' }))
      .rejects.toThrow('unsupported_field_command:edit');
    await expect(getFieldCommandStatus({ packetId: 'x' }))
      .rejects.toThrow('unsupported_field_command:getFieldCommandStatus');
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('source no longer references nonexistent production callables', () => {
    const api = src('secureOperationalApi.ts');
    const firebase = src('firebase.ts');
    expect(api).toMatch(/'ingestWbmPull'/);
    expect(api).not.toMatch(/authorizedCallable\([^)]*'submitFieldCommand'/);
    expect(api).not.toMatch(/authorizedCallable\([^)]*'getFieldCommandStatus'/);
    expect(firebase).toMatch(/secureIngestPacket/);
    expect(firebase).toMatch(/not writing public incoming/);
  });
});

describe('fresh install does not depend on cached well_config', () => {
  beforeEach(() => {
    resetWellConfigCacheForTests();
    mockCallable.mockReset();
    for (const k of Object.keys(mockSecure)) delete mockSecure[k];
    mockSecure.driverId = 'drv';
    mockSecure.companyId = 'liquid-gold';
  });

  it('source pins authenticated well catalog', () => {
    const wellConfig = src('wellConfig.ts');
    expect(wellConfig).toMatch(/bootstrapWbmSession/);
    expect(wellConfig).toMatch(/WellConfigUnavailableError/);
    expect(wellConfig).not.toMatch(/well_config\.json\?auth=/);
    expect(wellConfig).not.toMatch(/drivers\/approved/);
  });

  it('uncached fetch failure is a precise fail-closed error, not empty wells', async () => {
    mockCallable.mockRejectedValue(new Error('failed-precondition: scope_missing'));
    await expect(loadWellConfig(true)).rejects.toBeInstanceOf(WellConfigUnavailableError);
    await expect(loadWellConfig(true)).rejects.toThrow(/scope_missing/);
  });

  it('successful catalog is used as returned, not as all-company fallback', async () => {
    mockCallable.mockResolvedValue({
      ok: true,
      driverId: 'drv',
      companyId: 'liquid-gold',
      active: true,
      assignedRoutes: ['Gabriels'],
      assignedWells: [],
      assignmentRevision: 1,
      assignmentDigest: 'dig',
      eligibilityStatus: 'eligible',
      eligibilityReason: 'scope_ok',
      wells: { 'Gabriel 1': { route: 'Gabriels', allowedBottom: 3, numTanks: 1, loadLine: 1.33 } },
      wellCount: 1,
    });
    const wells = await loadWellConfig(true);
    expect(mockCallable).toHaveBeenCalledWith('bootstrapWbmSession', {});
    expect(Object.keys(wells || {})).toEqual(['Gabriel 1']);
  });
});

describe('session-verify Settings regression', () => {
  it('failure screen has Settings and logout, not only retry', () => {
    const src = rootSrc('app/session-verify.tsx');
    expect(src).toMatch(/router\.push\('\/settings'\)/);
    expect(src).toMatch(/clearDriverSession/);
  });
});

describe('aquarium code is absent from the recovery branch', () => {
  it('FLIP aquarium modules are not in the tree', () => {
    const files = [
      'src/components/TankFlipAquarium.tsx',
      'src/ui/duckFloat.ts',
      'src/ui/fishWander.ts',
      'src/ui/flipFluid.ts',
    ];
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    for (const f of files) {
      expect(fs.existsSync(path.join(__dirname, '../../..', f))).toBe(false);
    }
    const tabs = rootSrc('app/(tabs)/index.tsx');
    expect(tabs).not.toMatch(/TankFlipAquarium/);
    expect(tabs).not.toMatch(/duckFloat|fishWander|flipFluid/);
  });
});
