import {
  decideIncomingVersionEvent,
  appliedVersionStorageKey,
  parseStoredVersion,
  shouldMarkIncomingVersionApplied,
  appliedVersionForDriver,
  verifiedDriverId,
  loadAppliedIncomingVersion,
  markIncomingVersionApplied,
  resetAppliedIncomingVersionForTests,
  captureAndApplyOutgoingStatus,
  peekAppliedIncomingVersion,
  peekAppliedIncomingVersionOwner,
  type AppliedVersionReaders,
} from '../incomingVersion';
import { createCoalescedRunner } from '../syncCoalesce';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

describe('incoming_version attach / apply', () => {
  it('phone sleeps through a version increment → first reattach snapshot syncs', () => {
    expect(decideIncomingVersionEvent({
      appliedVersion: 40,
      incomingVersion: 41,
      seenThisAttach: false,
    })).toBe('sync');
  });

  it('first listener value after reattach cannot hide a missed version', () => {
    expect(decideIncomingVersionEvent({
      appliedVersion: 10,
      incomingVersion: 12,
      seenThisAttach: false,
    })).toBe('sync');
    expect(decideIncomingVersionEvent({
      appliedVersion: 12,
      incomingVersion: 12,
      seenThisAttach: false,
    })).toBe('ignore');
  });

  it('true cold baseline (never applied) does not treat the first snapshot as a change', () => {
    expect(decideIncomingVersionEvent({
      appliedVersion: null,
      incomingVersion: 7,
      seenThisAttach: false,
    })).toBe('ignore');
  });

  it('later snapshots on the same attach still sync when the counter advances', () => {
    expect(decideIncomingVersionEvent({
      appliedVersion: 7,
      incomingVersion: 8,
      seenThisAttach: true,
    })).toBe('sync');
  });

  it('foreground + version event coalesce to one fetch', async () => {
    let runs = 0;
    const run = createCoalescedRunner(async () => {
      runs += 1;
      await Promise.resolve();
      return runs;
    });
    const [a, b, c] = await Promise.all([run(), run(), run()]);
    expect(runs).toBe(1);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(c).toBe(1);
  });

  it('storage key is per authenticated driver', () => {
    expect(appliedVersionStorageKey('driver-a')).not.toBe(appliedVersionStorageKey('driver-b'));
    expect(parseStoredVersion('41')).toBe(41);
    expect(parseStoredVersion(null)).toBeNull();
  });

  it('failed fetch does not mark the version applied', () => {
    expect(shouldMarkIncomingVersionApplied({ fetchOk: false, snapshotsSaved: true })).toBe(false);
    expect(shouldMarkIncomingVersionApplied({ fetchOk: true, snapshotsSaved: false })).toBe(false);
    expect(shouldMarkIncomingVersionApplied({ fetchOk: true, snapshotsSaved: true })).toBe(true);
    expect(appliedVersionForDriver({ driverId: 'a', version: 40 }, 'b')).toBeNull();
    expect(appliedVersionForDriver({ driverId: 'a', version: 40 }, 'a')).toBe(40);
  });
});

describe('foreground / version wiring', () => {
  const index = src('app/(tabs)/index.tsx');
  const sync = src('src/services/backgroundSync.ts');
  const listener = src('src/services/firebaseListener.ts');

  it('every AppState active transition fetches getDriverOutgoingStatus', () => {
    expect(index).toMatch(/nextAppState === 'active'/);
    expect(index).toMatch(/syncOnForeground\(\)/);
    expect(sync).toMatch(/export async function syncOnForeground/);
    expect(sync).toMatch(/fetchDriverOutgoingStatus/);
    expect(index).not.toMatch(/onViewableItemsChanged[\s\S]{0,400}syncFromProcessedFolder/);
  });

  it('watcher compares against persisted applied version, not a null baseline', () => {
    expect(listener).toMatch(/decideIncomingVersionEvent/);
    expect(listener).toMatch(/loadAppliedIncomingVersion/);
    expect(sync).toMatch(/markIncomingVersionApplied/);
  });

  it('active second phone version event syncs through the coalesced callable once', () => {
    expect(sync).toMatch(/incoming_version changed - fetching updated responses/);
    expect(sync).toMatch(/runOutgoingStatusSync/);
    expect(sync).toMatch(/createCoalescedRunner/);
    expect(sync).toMatch(/captureAndApplyOutgoingStatus/);
    expect(sync).toMatch(/markApplied: markIncomingVersionApplied/);
  });

  it('captures incoming_version before getDriverOutgoingStatus', () => {
    const incoming = src('src/services/incomingVersion.ts');
    const capture = incoming.slice(
      incoming.indexOf('export async function captureAndApplyOutgoingStatus'),
      incoming.indexOf('await io.fetchOutgoingStatus()'),
    );
    expect(capture).toMatch(/fetchIncomingVersion/);
    expect(capture).toMatch(/versionBeforeFetch/);
    expect(sync.indexOf('captureAndApplyOutgoingStatus')).toBeGreaterThan(0);
    expect(sync.indexOf('fetchIncomingVersion')).toBeGreaterThan(0);
    expect(sync.indexOf('fetchDriverOutgoingStatus')).toBeGreaterThan(0);
  });
});

function memoryStore(): { store: Record<string, string>; readers: (driverId: string | null | (() => Promise<string | null>)) => AppliedVersionReaders } {
  const store: Record<string, string> = {};
  return {
    store,
    readers: (driverId) => ({
      getDriverId: typeof driverId === 'function' ? driverId : async () => driverId,
      getItem: async (key) => store[key] ?? null,
      setItem: async (key, value) => {
        store[key] = value;
      },
    }),
  };
}

describe('incoming_version driver identity fail-closed', () => {
  beforeEach(() => {
    resetAppliedIncomingVersionForTests();
  });

  it('never stores applied versions under an unknown driver key', () => {
    expect(verifiedDriverId('unknown')).toBeNull();
    expect(verifiedDriverId('UNKNOWN')).toBeNull();
    expect(verifiedDriverId(' Unknown ')).toBeNull();
    expect(verifiedDriverId('')).toBeNull();
    expect(verifiedDriverId(null)).toBeNull();
    expect(() => appliedVersionStorageKey('unknown')).toThrow('applied_version_requires_verified_driver');
    expect(() => appliedVersionStorageKey('UNKNOWN')).toThrow('applied_version_requires_verified_driver');
    expect(() => appliedVersionStorageKey('')).toThrow('applied_version_requires_verified_driver');
  });

  it('Driver A memory cannot be returned for Driver B', async () => {
    const { store, readers } = memoryStore();
    await markIncomingVersionApplied(41, 'driver-a', readers('driver-a'));
    expect(store[appliedVersionStorageKey('driver-a')]).toBe('41');
    expect(store[appliedVersionStorageKey('driver-b')]).toBeUndefined();
    expect(await loadAppliedIncomingVersion(readers('driver-b'))).toBeNull();
    expect(await loadAppliedIncomingVersion(readers('driver-a'))).toBe(41);
  });

  it('getDriverId() rejection returns null', async () => {
    const { readers } = memoryStore();
    await markIncomingVersionApplied(41, 'driver-a', readers('driver-a'));
    const rejected = readers(async () => {
      throw new Error('identity_unavailable');
    });
    expect(await loadAppliedIncomingVersion(rejected)).toBeNull();
  });

  it('missing authenticated driver returns null', async () => {
    const { readers } = memoryStore();
    await markIncomingVersionApplied(41, 'driver-a', readers('driver-a'));
    expect(await loadAppliedIncomingVersion(readers(null))).toBeNull();
    expect(await loadAppliedIncomingVersion(readers('unknown'))).toBeNull();
  });

  it('a failed identity lookup cannot suppress the next driver’s first sync', async () => {
    const { store, readers } = memoryStore();
    await markIncomingVersionApplied(41, 'driver-a', readers('driver-a'));
    expect(await loadAppliedIncomingVersion(readers(async () => {
      throw new Error('identity_unavailable');
    }))).toBeNull();

    store[appliedVersionStorageKey('driver-b')] = '40';
    const appliedB = await loadAppliedIncomingVersion(readers('driver-b'));
    expect(appliedB).toBe(40);
    expect(decideIncomingVersionEvent({
      appliedVersion: appliedB,
      incomingVersion: 41,
      seenThisAttach: false,
    })).toBe('sync');
  });

  it('a successfully saved snapshot/version remains scoped to its verified driver', async () => {
    const { store, readers } = memoryStore();
    await markIncomingVersionApplied(7, 'driver-a', readers('driver-a'));
    await markIncomingVersionApplied(9, 'unknown', readers('unknown'));
    await markIncomingVersionApplied(9, 'UNKNOWN', readers('UNKNOWN'));
    await markIncomingVersionApplied(9, null, readers(null));
    expect(store).toEqual({ [appliedVersionStorageKey('driver-a')]: '7' });
    expect(await loadAppliedIncomingVersion(readers('driver-a'))).toBe(7);
    expect(await loadAppliedIncomingVersion(readers('driver-b'))).toBeNull();
  });
});

function captureIo(opts: {
  versionBefore: number | null;
  versionDuringFetch?: number;
  driverId?: unknown;
  currentDriverId?: string | null;
  responses?: unknown[];
  failSave?: boolean;
  failOutgoing?: boolean;
}) {
  const marked: Array<{ version: number; driverId: string }> = [];
  const { store, readers } = memoryStore();
  const currentId = opts.currentDriverId === undefined
    ? (typeof opts.driverId === 'string' ? opts.driverId : 'driver-a')
    : opts.currentDriverId;
  let liveVersion = opts.versionBefore;
  return {
    marked,
    store,
    readers,
    io: {
      fetchIncomingVersion: async () => opts.versionBefore,
      fetchOutgoingStatus: async () => {
        if (opts.failOutgoing) return null;
        if (opts.versionDuringFetch != null) liveVersion = opts.versionDuringFetch;
        return {
          driverId: opts.driverId === undefined ? 'driver-a' : opts.driverId,
          responses: opts.responses ?? [{ wellName: 'Gabriel 1' }],
          unavailableWells: [],
        };
      },
      saveResponses: async () => {
        if (opts.failSave) throw new Error('snapshot_save_failed');
      },
      saveUnavailable: async () => undefined,
      markApplied: async (version: number, expectedDriverId: string) => {
        const ok = await markIncomingVersionApplied(version, expectedDriverId, readers(currentId));
        if (ok) marked.push({ version, driverId: expectedDriverId });
        return ok;
      },
    },
    liveVersion: () => liveVersion,
  };
}

describe('incoming_version snapshot capture race', () => {
  beforeEach(() => {
    resetAppliedIncomingVersionForTests();
  });

  it('N is captured; N+1 publishes while the callable runs; only N is marked', async () => {
    const harness = captureIo({ versionBefore: 10, versionDuringFetch: 11 });
    const out = await captureAndApplyOutgoingStatus(harness.io);
    expect(out.markedVersion).toBe(10);
    expect(harness.marked).toEqual([{ version: 10, driverId: 'driver-a' }]);
    expect(harness.liveVersion()).toBe(11);
    expect(peekAppliedIncomingVersion()).toBe(10);
  });

  it('N+1 subsequently causes sync', async () => {
    const harness = captureIo({ versionBefore: 10, versionDuringFetch: 11 });
    const out = await captureAndApplyOutgoingStatus(harness.io);
    expect(out.markedVersion).toBe(10);
    expect(decideIncomingVersionEvent({
      appliedVersion: out.markedVersion,
      incomingVersion: harness.liveVersion(),
      seenThisAttach: true,
    })).toBe('sync');
    expect(decideIncomingVersionEvent({
      appliedVersion: 10,
      incomingVersion: 11,
      seenThisAttach: false,
    })).toBe('sync');
  });

  it('Driver A result followed by current Driver B cannot mark B', async () => {
    const harness = captureIo({
      versionBefore: 41,
      driverId: 'driver-a',
      currentDriverId: 'driver-b',
    });
    const out = await captureAndApplyOutgoingStatus(harness.io);
    expect(out.markedVersion).toBeNull();
    expect(harness.marked).toEqual([]);
    expect(harness.store[appliedVersionStorageKey('driver-b')]).toBeUndefined();
    expect(harness.store[appliedVersionStorageKey('driver-a')]).toBeUndefined();
    expect(peekAppliedIncomingVersionOwner()).not.toBe('driver-b');
    expect(peekAppliedIncomingVersion()).toBeNull();
  });

  it('failed initial counter read marks nothing', async () => {
    const harness = captureIo({ versionBefore: null });
    const out = await captureAndApplyOutgoingStatus(harness.io);
    expect(out.fetched).toBe(true);
    expect(out.markedVersion).toBeNull();
    expect(harness.marked).toEqual([]);
    expect(peekAppliedIncomingVersion()).toBeNull();
  });

  it('failed snapshot processing marks nothing', async () => {
    const harness = captureIo({ versionBefore: 10, failSave: true });
    const out = await captureAndApplyOutgoingStatus(harness.io);
    expect(out.markedVersion).toBeNull();
    expect(harness.marked).toEqual([]);
    expect(peekAppliedIncomingVersion()).toBeNull();
  });
});
