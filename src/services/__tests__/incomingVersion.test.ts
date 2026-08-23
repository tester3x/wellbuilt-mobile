import {
  decideIncomingVersionEvent,
  appliedVersionStorageKey,
  parseStoredVersion,
  shouldMarkIncomingVersionApplied,
  appliedVersionForDriver,
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
    expect(sync).toMatch(/shouldMarkIncomingVersionApplied/);
  });
});
