import { readFileSync } from 'fs';
import { join } from 'path';
import { validate, definitionSchema } from '@tester3x/wellbuilt-contracts/transport';
import { GOVERNED_PACKET_ACCESS, isGovernedPacketAccessEnabled } from '../governedPacketAccessFlag';
import {
  acceptResolveExecutionBindingResponse,
  bindingCacheIndexKey,
  bindingCacheRecordKey,
  buildResolveExecutionBindingRequest,
  EXECUTION_BINDING_CACHE_VERSION,
  GOVERNED_ACCESS_MAP,
  loadPersistedExecutionBindingFromKv,
  persistExecutionBindingToKv,
  restoreExecutionBindingRecord,
  serializeExecutionBindingIndex,
  serializeExecutionBindingRecord,
  type ExecutionBindingKv,
} from '../governedPacketAccessCore';
import {
  restoreGovernedExecutionBinding,
  runGovernedExecutionBinding,
  governedUiKind,
} from '../governedPacketAccessRuntime';
import {
  clearExecutionBindingMemory,
  getRememberedExecutionBinding,
  rememberExecutionBinding,
} from '../governedPacketAccessMemory';
import {
  GOVERNED_JOB_ID_QUERY_KEY,
  GOVERNED_JOB_ID_RECORD_PATH,
  GOVERNED_JOB_ID_URL_SCHEME,
  governedRecordReceivingHref,
  readGovernedJobIdFromHref,
  readGovernedJobIdFromRecordParams,
} from '../governedJobIdIngress';
import { WBM_ENVELOPE_KEY } from '../wbmBootstrapCache';

const root = join(__dirname, '../../..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');
function reasonOf(r: unknown): string {
  return String((r as { reason?: string }).reason || '');
}

const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const HASH_C = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const session = { companyId: 'liquid-gold', driverId: '2cad521c-13ac-4b6c-b1ab-07843c6bf06f' };
const binding = {
  packageId: 'water-hauling',
  packetRevision: 1,
  contentHash: HASH_A,
  policyHash: HASH_B,
};

function productionWaterDefinition(extra: unknown[] = []) {
  const capabilities = [
    { capabilityId: 'lifecycle', moduleVersion: 1, configuration: {} },
    { capabilityId: 'pickup', moduleVersion: 1, configuration: { unit: 'bbl' } },
    ...extra,
  ];
  const jobCaps = capabilities.map((c: any) => c.capabilityId);
  const commandRules: any[] = [
    { command: 'lifecycle.advance', states: ['planned', 'accepted', 'atPickup', 'loaded', 'inTransit', 'atDropoff', 'unloaded'] },
    { command: 'lifecycle.close', states: ['unloaded'] },
    { command: 'lifecycle.cancel', states: ['planned', 'accepted'] },
    { command: 'pickup.record', states: ['atPickup'] },
  ];
  return {
    schemaVersion: 1,
    packetId: 'water-hauling',
    industryId: 'oil-gas',
    segmentId: 'produced-water',
    label: 'Water Hauling',
    jobTypes: [{ jobTypeId: 'pw', label: 'Production Water', capabilities: jobCaps }],
    capabilities,
    fields: [{ key: 'pickupLocationId', label: 'Pickup', capabilityId: 'pickup', kind: 'location', required: true }],
    commandRules,
    workflow: [
      { from: 'planned', to: 'accepted', command: 'lifecycle.advance' },
      { from: 'accepted', to: 'atPickup', command: 'lifecycle.advance' },
      { from: 'atPickup', to: 'loaded', command: 'lifecycle.advance' },
      { from: 'loaded', to: 'inTransit', command: 'lifecycle.advance' },
      { from: 'inTransit', to: 'atDropoff', command: 'lifecycle.advance' },
      { from: 'atDropoff', to: 'unloaded', command: 'lifecycle.advance' },
      { from: 'unloaded', to: 'closed', command: 'lifecycle.close' },
      { from: 'planned', to: 'cancelled', command: 'lifecycle.cancel' },
    ],
    compatibility: { minimumContractVersion: 1, legacyAdapterId: null, migrationFrom: null },
  };
}

const execution = { jobTypeId: 'pw', wellName: 'Python', ndicWellName: 'PYTHON 1' };

function okResponse(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    jobId: 'job-1',
    companyId: session.companyId,
    driverId: session.driverId,
    binding,
    execution,
    definition: productionWaterDefinition(),
    implementedEffects: [],
    ...over,
  };
}

function memoryKv(): ExecutionBindingKv & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async getItem(key) { return map.has(key) ? map.get(key)! : null; },
    async setItem(key, value) { map.set(key, value); },
    async removeItem(key) { map.delete(key); },
  };
}

function harness(over: Record<string, any> = {}) {
  const kv = over.kv || memoryKv();
  const calls: unknown[] = [];
  const resolve = over.resolve || (async (request: { jobId: string }) => {
    calls.push(request);
    return okResponse(over.responseOver || {});
  });
  return {
    kv,
    calls,
    deps: {
      governed: over.governed === true,
      jobId: over.jobId ?? 'job-1',
      session: over.session === undefined ? session : over.session,
      connectivityStatus: over.connectivityStatus || 'reachable',
      resolve,
      loadCached: (jobId: string, sess: typeof session) => loadPersistedExecutionBindingFromKv(kv, { jobId, session: sess }),
      persist: (snapshot: any) => persistExecutionBindingToKv(kv, snapshot),
      invalidate: (jobId: string) => kv.removeItem(bindingCacheIndexKey(jobId)),
      surface: over.surface,
      jobType: over.jobType,
    },
  };
}

beforeEach(() => {
  clearExecutionBindingMemory();
});

describe('G-014 identity and request', () => {
  test('1. injectable flag-off preserves current behavior and makes no resolver call', async () => {
    const h = harness({ governed: false });
    const out = await runGovernedExecutionBinding(h.deps);
    expect(out.ok).toBe(true);
    expect(out.ok && out.snapshot).toBeNull();
    expect(h.calls).toHaveLength(0);
    const tabs = src('app/(tabs)/index.tsx');
    expect(tabs).toMatch(/pathname:\s*'\/record'/);
  });

  test('2. flag ON sends exactly { jobId }', async () => {
    const h = harness({ governed: true });
    const out = await runGovernedExecutionBinding(h.deps);
    expect(out.ok).toBe(true);
    expect(h.calls).toEqual([{ jobId: 'job-1' }]);
    expect(Object.keys(buildResolveExecutionBindingRequest('job-1'))).toEqual(['jobId']);
  });

  test('3. selected Dashboard jobId is used without local substitution', async () => {
    const h = harness({ governed: true, jobId: 'W0Om3TsAHAJ4bu8d8K49' });
    await runGovernedExecutionBinding({
      ...h.deps,
      resolve: async (request) => {
        h.calls.push(request);
        return okResponse({ jobId: 'W0Om3TsAHAJ4bu8d8K49' });
      },
    });
    expect(h.calls[0]).toEqual({ jobId: 'W0Om3TsAHAJ4bu8d8K49' });
    const tabs = src('app/(tabs)/index.tsx');
    expect(tabs).not.toMatch(/jobId:\s*wellName/);
    const record = src('app/record.tsx');
    expect(record).toMatch(/readGovernedJobIdFromRecordParams\(params\)/);
    expect(record).not.toMatch(/jobId:\s*wellName/);
  });

  test('4. caller authority/binding fields are never sent', () => {
    const req = buildResolveExecutionBindingRequest('job-1') as Record<string, unknown>;
    for (const k of ['companyId', 'targetCompanyId', 'driverId', 'driverHash', 'packageId', 'packetRevision', 'revision', 'contentHash', 'policyHash', 'capabilities', 'implementedEffects', 'role', 'roles', 'uid', 'isPlatformAdmin']) {
      expect(k in req).toBe(false);
    }
    const api = src('src/services/secureOperationalApi.ts');
    expect(api).toMatch(/'resolveExecutionBinding', \{ jobId \}/);
  });

  test('5. wrong response jobId fails closed', () => {
    expect(reasonOf(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1', session, raw: okResponse({ jobId: 'other' }),
    }))).toBe('job_id_mismatch');
  });

  test('6. wrong companyId fails closed', () => {
    expect(reasonOf(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1', session, raw: okResponse({ companyId: 'other-hauler' }),
    }))).toBe('company_id_mismatch');
  });

  test('7. wrong driverId fails closed', () => {
    expect(reasonOf(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1', session, raw: okResponse({ driverId: 'ffffffff-0000-0000-0000-ffffffffffff' }),
    }))).toBe('driver_id_mismatch');
  });
});

describe('G-014 binding and definition', () => {
  test('8. complete valid response succeeds', async () => {
    expect(validate(definitionSchema, productionWaterDefinition()).ok).toBe(true);
    const h = harness({ governed: true, surface: 'open' });
    const out = await runGovernedExecutionBinding(h.deps);
    expect(out.ok).toBe(true);
    expect(out.ok && out.snapshot?.binding).toEqual(binding);
  });

  test('9. partial binding fails closed', () => {
    expect(reasonOf(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1',
      session,
      raw: okResponse({ binding: { packageId: 'water-hauling', packetRevision: 1, contentHash: HASH_A } }),
    }))).toBe('incomplete_binding');
  });

  test('10. malformed definition fails closed', () => {
    expect(reasonOf(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1', session, raw: okResponse({ definition: { schemaVersion: 1 } }),
    }))).toBe('definition_invalid');
  });

  test('11. invalid/nonempty implementedEffects fails closed', () => {
    expect(reasonOf(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1', session, raw: okResponse({ implementedEffects: ['pickup.record'] }),
    }))).toBe('implemented_effects_not_empty_array');
    expect(reasonOf(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1', session, raw: okResponse({ implementedEffects: 'none' }),
    }))).toBe('implemented_effects_not_empty_array');
  });

  test('12. unknown/catalog aliases grant nothing', async () => {
    const h = harness({ governed: true, surface: 'open' });
    await runGovernedExecutionBinding(h.deps);
    const snap = getRememberedExecutionBinding('job-1')!;
    const aliases = ['splitTickets', 'splitHaul', 'PW', 'jsa', 'multiHaul'];
    for (const alias of aliases) {
      expect((snap.definition.capabilities as any[]).some((c) => c.capabilityId === alias)).toBe(false);
    }
  });

  test('13. missing required capability denies the affected surface', async () => {
    const lifecycleOnly = productionWaterDefinition();
    (lifecycleOnly.capabilities as any[]).splice(1, 1);
    lifecycleOnly.jobTypes[0].capabilities = ['lifecycle'];
    lifecycleOnly.commandRules = lifecycleOnly.commandRules.filter((r: any) => r.command !== 'pickup.record');
    lifecycleOnly.fields = [];
    const h = harness({
      governed: true,
      surface: 'pull',
      resolve: async (req: { jobId: string }) => {
        h.calls.push(req);
        return okResponse({ definition: lifecycleOnly });
      },
    });
    const out = await runGovernedExecutionBinding(h.deps);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe('packet_denied');
  });

  test('14. JobType PW alone cannot bypass packet access', async () => {
    const lifecycleOnly = productionWaterDefinition();
    (lifecycleOnly.capabilities as any[]).splice(1, 1);
    lifecycleOnly.jobTypes[0].capabilities = ['lifecycle'];
    lifecycleOnly.commandRules = lifecycleOnly.commandRules.filter((r: any) => r.command !== 'pickup.record');
    lifecycleOnly.fields = [];
    const h = harness({
      governed: true,
      surface: 'pull',
      jobType: 'PW',
      resolve: async () => okResponse({ definition: lifecycleOnly }),
    });
    const out = await runGovernedExecutionBinding(h.deps);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.kind).toBe('packet_denied');
      expect(out.reason).toMatch(/job_type_cannot_bypass_packet|missing_capability/);
    }
  });

  test('15. newer package revision does not replace the pinned revision', async () => {
    const h = harness({ governed: true });
    const first = await runGovernedExecutionBinding(h.deps);
    expect(first.ok && first.snapshot?.binding.packetRevision).toBe(1);
    const later = await runGovernedExecutionBinding({
      ...h.deps,
      resolve: async () => okResponse({ binding: { ...binding, packetRevision: 2, contentHash: HASH_C } }),
    });
    expect(later.ok && later.snapshot?.binding.packetRevision).toBe(1);
    expect(h.calls).toHaveLength(1);
  });
});

describe('G-014 cache/offline', () => {
  test('16. valid resolution persists before access reports success', async () => {
    const h = harness({ governed: true, surface: 'open' });
    const out = await runGovernedExecutionBinding(h.deps);
    expect(out.ok).toBe(true);
    const index = await h.kv.getItem(bindingCacheIndexKey('job-1'));
    expect(typeof index).toBe('string');
    expect(index).toContain('water-hauling');
  });

  test('17. restart restores the exact pinned job', async () => {
    const kv = memoryKv();
    const first = harness({ kv, governed: true, surface: 'open' });
    const saved = await runGovernedExecutionBinding(first.deps);
    clearExecutionBindingMemory();
    expect(getRememberedExecutionBinding('job-1')).toBeNull();
    const restored = await restoreGovernedExecutionBinding({
      governed: true,
      jobId: 'job-1',
      session,
      loadCached: (jobId, sess) => loadPersistedExecutionBindingFromKv(kv, { jobId, session: sess }),
      surface: 'open',
    });
    expect(restored.ok).toBe(true);
    if (restored.ok && saved.ok) {
      expect(restored.snapshot?.binding).toEqual(saved.snapshot?.binding);
    }
  });

  test('18. changed binding invalidates old cache', async () => {
    const kv = memoryKv();
    const first = acceptResolveExecutionBindingResponse({ requestedJobId: 'job-1', session, raw: okResponse() });
    if (!first.ok) throw new Error('setup');
    await persistExecutionBindingToKv(kv, first.snapshot);
    const oldKey = bindingCacheRecordKey('job-1', first.snapshot.binding);
    const changed = acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1',
      session,
      raw: okResponse({ binding: { ...binding, contentHash: HASH_C } }),
    });
    if (!changed.ok) throw new Error('setup2');
    await persistExecutionBindingToKv(kv, changed.snapshot);
    expect(await kv.getItem(oldKey)).toBeNull();
    const loaded = await loadPersistedExecutionBindingFromKv(kv, { jobId: 'job-1', session });
    expect(loaded.ok && loaded.snapshot.binding.contentHash).toBe(HASH_C);
  });

  test('19. corrupt/partial cache fails closed', async () => {
    const kv = memoryKv();
    await kv.setItem(bindingCacheIndexKey('job-1'), '{not-json');
    const corrupt = await loadPersistedExecutionBindingFromKv(kv, { jobId: 'job-1', session });
    expect(corrupt.ok).toBe(false);
    const accepted = acceptResolveExecutionBindingResponse({ requestedJobId: 'job-1', session, raw: okResponse() });
    if (!accepted.ok) throw new Error('setup');
    const kv2 = memoryKv();
    await kv2.setItem(bindingCacheIndexKey('job-1'), serializeExecutionBindingIndex(accepted.snapshot));
    const partial = await loadPersistedExecutionBindingFromKv(kv2, { jobId: 'job-1', session });
    expect(partial.ok).toBe(false);
  });

  test('20. other job cannot reuse cache', async () => {
    const kv = memoryKv();
    const saved = acceptResolveExecutionBindingResponse({ requestedJobId: 'job-1', session, raw: okResponse() });
    if (!saved.ok) throw new Error('setup');
    await persistExecutionBindingToKv(kv, saved.snapshot);
    rememberExecutionBinding(saved.snapshot);
    const other = await loadPersistedExecutionBindingFromKv(kv, { jobId: 'job-2', session });
    expect(other.ok).toBe(false);
  });

  test('21. other driver/company cannot reuse cache', () => {
    const saved = acceptResolveExecutionBindingResponse({ requestedJobId: 'job-1', session, raw: okResponse() });
    if (!saved.ok) throw new Error('setup');
    const otherCo = restoreExecutionBindingRecord({
      jobId: 'job-1',
      session: { companyId: 'other-hauler', driverId: session.driverId },
      indexJson: serializeExecutionBindingIndex(saved.snapshot),
      recordJson: serializeExecutionBindingRecord(saved.snapshot),
    });
    expect((otherCo as { reason: string }).reason).toBe('company_id_mismatch');
    const otherDrv = restoreExecutionBindingRecord({
      jobId: 'job-1',
      session: { companyId: session.companyId, driverId: 'ffffffff-0000-0000-0000-ffffffffffff' },
      indexJson: serializeExecutionBindingIndex(saved.snapshot),
      recordJson: serializeExecutionBindingRecord(saved.snapshot),
    });
    expect((otherDrv as { reason: string }).reason).toBe('driver_id_mismatch');
  });

  test('22. uncached offline governed job fails closed', async () => {
    const h = harness({ governed: true, connectivityStatus: 'offline' });
    const out = await runGovernedExecutionBinding(h.deps);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe('offline_uncached');
    expect(h.calls).toHaveLength(0);
  });

  test('23. valid cached job follows existing offline behavior', async () => {
    const kv = memoryKv();
    const first = harness({ kv, governed: true, surface: 'open' });
    await runGovernedExecutionBinding(first.deps);
    clearExecutionBindingMemory();
    const offline = await runGovernedExecutionBinding({
      ...first.deps,
      connectivityStatus: 'offline',
      resolve: async () => { throw new Error('should_not_call'); },
    });
    expect(offline.ok).toBe(true);
  });

  test('24. resolver failure does not fall back to local flags', async () => {
    const h = harness({
      governed: true,
      surface: 'open',
      jobType: 'PW',
      resolve: async () => { throw new Error('unavailable'); },
    });
    const out = await runGovernedExecutionBinding(h.deps);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.kind).toBe('network');
      expect(out.reason).toBe('unavailable');
    }
  });
});

describe('G-014 UX/regression', () => {
  test('25. resolver failure exits loading and permits retry', async () => {
    const h = harness({
      governed: true,
      resolve: async () => { throw new Error('unavailable'); },
    });
    const out = await runGovernedExecutionBinding(h.deps);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.retryable).toBe(true);
    expect(governedUiKind(out)).toBe('network');
    const gate = src('src/components/GovernedPacketAccessGate.tsx');
    expect(gate).toMatch(/governedPacket\.retry/);
    expect(gate).toMatch(/setAttempt/);
  });

  test('26. capability denial is distinct from network failure', async () => {
    const lifecycleOnly = productionWaterDefinition();
    (lifecycleOnly.capabilities as any[]).splice(1, 1);
    lifecycleOnly.jobTypes[0].capabilities = ['lifecycle'];
    lifecycleOnly.commandRules = lifecycleOnly.commandRules.filter((r: any) => r.command !== 'pickup.record');
    lifecycleOnly.fields = [];
    const denied = await runGovernedExecutionBinding(harness({
      governed: true,
      surface: 'pull',
      resolve: async () => okResponse({ definition: lifecycleOnly }),
    }).deps);
    const net = await runGovernedExecutionBinding(harness({
      governed: true,
      resolve: async () => { throw new Error('unavailable'); },
    }).deps);
    expect(governedUiKind(denied)).toBe('packet');
    expect(governedUiKind(net)).toBe('network');
  });

  test('27. standalone carousel pull navigates directly to /record without blocking', () => {
    const gate = src('src/components/GovernedPacketAccessGate.tsx');
    expect(gate).toMatch(/if \(!governed\) \{\s*return <>\{children\}<\/>;/s);
    const tabs = src('app/(tabs)/index.tsx');
    expect(tabs).toMatch(/pathname:\s*'\/record'/);
    expect(tabs).not.toMatch(/beginGovernedProductionWaterPull/);
  });

  test('28-31. unrelated surfaces unchanged', () => {
    const access = src('src/services/governedPacketAccess.ts');
    expect(access).not.toMatch(/afr|AFR|ddjd|DDJD|freshWater|serviceWork/i);
    expect(src('src/services/eligibility.ts')).toMatch(/evaluateAuthoritativeAssignedRoutes/);
    expect(src('app/history.tsx')).toMatch(/pathname: '\/record'/);
  });

  test('32. no credential is persisted', () => {
    const core = src('src/services/governedPacketAccessCore.ts');
    expect(core).not.toMatch(/idToken|password|passcode|refreshToken/);
    const accepted = acceptResolveExecutionBindingResponse({ requestedJobId: 'job-1', session, raw: okResponse() });
    if (!accepted.ok) throw new Error('setup');
    const json = serializeExecutionBindingRecord(accepted.snapshot);
    expect(json).not.toMatch(/idToken|password|passcode/);
  });

  test('33. resolver integration performs no client authority write', () => {
    const api = src('src/services/secureOperationalApi.ts');
    const fn = api.slice(api.indexOf('secureResolveExecutionBinding'), api.indexOf('Receipt lookup'));
    expect(fn).toMatch(/resolveExecutionBinding/);
    expect(fn).not.toMatch(/\.set\(|\.update\(|\.remove\(/);
  });

  test('34. WB-M does not duplicate WB-T split/multi-haul execution', () => {
    const files = [
      src('src/services/governedPacketAccess.ts'),
      src('src/services/governedPacketAccessRuntime.ts'),
      src('src/services/governedPacketAccessCore.ts'),
      src('src/components/GovernedPacketAccessGate.tsx'),
    ].join('\n');
    expect(files).not.toMatch(/splitChainId|haulGroupId|multiHaul|splitTicket/);
  });

  test('35. no server effect is claimed', () => {
    expect(GOVERNED_ACCESS_MAP.every((row) => row.contractsCapabilityId === 'lifecycle' || row.contractsCapabilityId === 'pickup')).toBe(true);
    const accepted = acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1', session, raw: okResponse({ implementedEffects: [] }),
    });
    expect(accepted.ok && accepted.snapshot.implementedEffects).toEqual([]);
  });
});

describe('G-014 contracts and mapping', () => {
  test('exact 0.7.0 and registry-only npmrc', () => {
    const pkg = JSON.parse(src('package.json'));
    expect(pkg.dependencies['@tester3x/wellbuilt-contracts']).toBe('0.7.0');
    expect(src('.npmrc').trim()).toBe('@tester3x:registry=https://npm.pkg.github.com');
  });

  test('capability map is lifecycle/pickup to WB-M pull surfaces', () => {
    expect(GOVERNED_ACCESS_MAP[0].contractsCapabilityId).toBe('lifecycle');
    expect(GOVERNED_ACCESS_MAP[0].wbmGate).toBe('openProductionWaterRecord');
    expect(GOVERNED_ACCESS_MAP[1].contractsCapabilityId).toBe('pickup');
    expect(GOVERNED_ACCESS_MAP[1].wbmGate).toBe('submitProductionWaterPull');
  });
});

describe('G-014R1 current-release port', () => {
  test('current-line modules are not replaced by old G-014 copies', () => {
    const record = src('app/record.tsx');
    expect(record).toMatch(/from '\.\.\/src\/utils\/recordLoadHints'/);
    expect(record).toMatch(/editDateTimeUTC/);
    expect(record).toMatch(/finalizeEdit/);
    expect(record).toMatch(/WellBuiltBusyOverlay/);
    expect(record).toMatch(/submitWbmEditV3|submitPullEdit/);
    const api = src('src/services/secureOperationalApi.ts');
    expect(api).toMatch(/clientMeta/);
    expect(api).toMatch(/ingestWbmPull/);
    expect(api).toMatch(/submitWbmEditV3/);
    expect(api).toMatch(/secureResolveExecutionBinding/);
    const jestCfg = src('jest.config.js');
    expect(jestCfg).toMatch(/jsx: 'react-jsx'/);
    expect(jestCfg).toMatch(/@tester3x\/wellbuilt-contracts/);
    expect(src('src/services/routeMe.ts')).toMatch(/DEFAULT_DDJD_PILOT_REASON/);
    expect(src('src/utils/recordLoadHints.ts')).toMatch(/getRecordLoadBlockReason/);
  });

  test('assigned-job/DDJD/Route Me still have no Dashboard dispatch jobId', () => {
    const routeMe = src('src/services/routeMe.ts');
    expect(routeMe).toMatch(/export interface RouteMeWell/);
    expect(routeMe).not.toMatch(/jobId/);
    expect(routeMe).toMatch(/authorizedCallable<RouteMeResult>\('getDriverRouteMe', \{\}\)/);
    const tabs = src('app/(tabs)/index.tsx');
    expect(tabs).not.toMatch(/params:\s*\{\s*wellName:\s*wells\[currentIndex\],\s*jobId/);
  });

  test('reachable receiving route is wellbuiltmobile://record?jobId=', () => {
    expect(GOVERNED_JOB_ID_URL_SCHEME).toBe('wellbuiltmobile');
    expect(GOVERNED_JOB_ID_RECORD_PATH).toBe('/record');
    expect(GOVERNED_JOB_ID_QUERY_KEY).toBe('jobId');
    const href = governedRecordReceivingHref('W0Om3TsAHAJ4bu8d8K49', 'Gab 1');
    expect(href).toBe('wellbuiltmobile://record?jobId=W0Om3TsAHAJ4bu8d8K49&wellName=Gab+1');
    expect(readGovernedJobIdFromHref(href)).toBe('W0Om3TsAHAJ4bu8d8K49');
    expect(readGovernedJobIdFromRecordParams({ jobId: 'W0Om3TsAHAJ4bu8d8K49', wellName: 'Gab 1' })).toBe('W0Om3TsAHAJ4bu8d8K49');
    expect(readGovernedJobIdFromRecordParams({ jobId: 'Gab 1', wellName: 'Gab 1' })).toBe('');
    expect(readGovernedJobIdFromRecordParams({ wellName: 'Gab 1' })).toBe('');
    expect(readGovernedJobIdFromHref('wellbuiltmobile://record?wellName=Gab%201')).toBe('');
    const appJson = JSON.parse(src('app.json'));
    expect(appJson.expo.scheme).toBe('wellbuiltmobile');
    expect(src('app/record.tsx')).toMatch(/readGovernedJobIdFromRecordParams\(params\)/);
    expect(src('src/components/AppSwitcher.tsx')).toMatch(/wellbuilt-tickets:\/\/sso-start/);
  });

  test('durable cache keys do not collide with bootstrap/drafts', () => {
    expect(WBM_ENVELOPE_KEY).toBe('@wellbuilt_wbm_bootstrap_v1');
    const core = src('src/services/governedPacketAccessCore.ts');
    expect(core).toMatch(/wbm\.executionBinding\.index\.v2\./);
    expect(core).toMatch(/wbm\.executionBinding\.record\.v2\./);
    expect(core).not.toMatch(/@wellbuilt_wbm_bootstrap_v1/);
    expect(core).not.toMatch(/wellbuilt_draft_/);
    expect(src('app/record.tsx')).toMatch(/wellbuilt_draft_/);
  });

  test('field-test release ships with governed access ON', () => {
    expect(GOVERNED_PACKET_ACCESS).toBe(true);
    expect(isGovernedPacketAccessEnabled()).toBe(true);
    expect(src('src/services/governedPacketAccessFlag.ts')).toMatch(/boolean = true/);
  });
});

describe('G-015 authoritative well context', () => {
  const fixture = JSON.parse(src('src/services/__tests__/__fixtures__/g015-execution-binding-response.json'));

  test('1-2. governed jobId opens the returned well without a caller wellName', async () => {
    expect(validate(definitionSchema, fixture.definition).ok).toBe(true);
    expect(Object.keys(fixture.execution)).toEqual(['jobTypeId', 'wellName', 'ndicWellName']);
    const accepted = acceptResolveExecutionBindingResponse({
      requestedJobId: fixture.jobId,
      session: { companyId: fixture.companyId, driverId: fixture.driverId },
      raw: fixture,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.snapshot.execution.wellName).toBe('Python');
    const record = src('app/record.tsx');
    expect(record).toMatch(/resolvedWellName/);
    expect(record).toMatch(/queryWellName/);
    expect(record).toMatch(/onResolved=\{onGovernedResolved\}/);
  });

  test('3. caller wellName cannot redirect to another well', () => {
    expect(reasonOf(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1',
      session,
      raw: okResponse(),
      localIdentity: { wellName: 'Gab 1' },
    }))).toBe('well_mismatch');
  });

  test('4. matching display hint is accepted; mismatch fails closed', () => {
    expect(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1', session, raw: okResponse(), localIdentity: { wellName: 'Python' },
    }).ok).toBe(true);
    expect(reasonOf(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1', session, raw: okResponse(), localIdentity: { wellName: 'Gab 1' },
    }))).toBe('well_mismatch');
  });

  test('5. missing/partial execution context fails closed', () => {
    expect(reasonOf(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1', session, raw: okResponse({ execution: undefined }),
    }))).toBe('incomplete_execution');
    expect(reasonOf(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1', session, raw: okResponse({ execution: { jobTypeId: 'pw', wellName: 'Python' } }),
    }))).toBe('incomplete_execution');
  });

  test('6. wrong jobType fails closed', () => {
    expect(reasonOf(acceptResolveExecutionBindingResponse({
      requestedJobId: 'job-1', session, raw: okResponse(), localIdentity: { jobTypeId: 'fw' },
    }))).toBe('job_type_mismatch');
  });

  test('7. old version-1 cache cannot authorize', () => {
    const accepted = acceptResolveExecutionBindingResponse({ requestedJobId: 'job-1', session, raw: okResponse() });
    if (!accepted.ok) throw new Error('setup');
    const v1index = serializeExecutionBindingIndex(accepted.snapshot).replace('"cacheVersion":2', '"cacheVersion":1');
    const v1record = serializeExecutionBindingRecord(accepted.snapshot).replace('"cacheVersion":2', '"cacheVersion":1');
    expect(restoreExecutionBindingRecord({
      jobId: 'job-1', session, indexJson: v1index, recordJson: v1record,
    }).ok).toBe(false);
    expect(EXECUTION_BINDING_CACHE_VERSION).toBe(2);
  });

  test('8. version-2 cache restores exact well after restart', async () => {
    const kv = memoryKv();
    const first = harness({ kv, governed: true, surface: 'open' });
    const saved = await runGovernedExecutionBinding(first.deps);
    clearExecutionBindingMemory();
    const restored = await restoreGovernedExecutionBinding({
      governed: true,
      jobId: 'job-1',
      session,
      loadCached: (jobId, sess) => loadPersistedExecutionBindingFromKv(kv, { jobId, session: sess }),
      surface: 'open',
    });
    expect(restored.ok).toBe(true);
    if (restored.ok && saved.ok) {
      expect(restored.snapshot?.execution).toEqual(saved.snapshot?.execution);
    }
  });

  test('9. changed execution context rejects cache', async () => {
    const accepted = acceptResolveExecutionBindingResponse({ requestedJobId: 'job-1', session, raw: okResponse() });
    if (!accepted.ok) throw new Error('setup');
    const index = JSON.parse(serializeExecutionBindingIndex(accepted.snapshot));
    const record = JSON.parse(serializeExecutionBindingRecord(accepted.snapshot));
    index.execution = { ...index.execution, wellName: 'Gab 1' };
    expect(restoreExecutionBindingRecord({
      jobId: 'job-1',
      session,
      indexJson: JSON.stringify(index),
      recordJson: JSON.stringify(record),
    }).ok).toBe(false);
  });

  test('12. submission uses the resolver-returned well', () => {
    const record = src('app/record.tsx');
    expect(record).toMatch(/isGovernedPacketAccessEnabled\(\) && params\.editMode !== 'true'/);
    expect(record).toMatch(/snapshot\?\.execution\?\.wellName/);
    expect(record).not.toMatch(/jobId:\s*wellName/);
  });
});
