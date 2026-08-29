// Phase-2 client: v2 refresh-token contract — inequality semantics, dual
// contract with the saturated legacy node, persistence, and the migration
// matrix (old/new/mixed clients, replay, offline catch-up, fresh install,
// malformed tokens, rollback).
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

import {
  appliedRevisionV2StorageKey,
  decideRevisionV2Event,
  loadAppliedRevisionV2,
  markRevisionV2Applied,
  peekAppliedRevisionV2,
  resetAppliedRevisionV2ForTests,
  revisionV2TokenOf,
} from '../revisionV2';
import { captureAndApplyOutgoingStatus, decideIncomingVersionEvent } from '../incomingVersion';

const SATURATED = 4.3005353146607763e20;

beforeEach(() => resetAppliedRevisionV2ForTests());

describe('token parsing (mirrors the server parser)', () => {
  test('canonical node, bare string, junk', () => {
    expect(revisionV2TokenOf({ v: 2, token: 'op1', at: 5 })).toBe('op1');
    expect(revisionV2TokenOf('bare')).toBe('bare');
    expect(revisionV2TokenOf(null)).toBeNull();
    expect(revisionV2TokenOf(undefined)).toBeNull();
    expect(revisionV2TokenOf(SATURATED)).toBeNull();
    expect(revisionV2TokenOf({ v: 2, token: 42 })).toBeNull();
    expect(revisionV2TokenOf(['x'])).toBeNull();
    expect(revisionV2TokenOf('  ')).toBeNull();
  });
});

describe('decideRevisionV2Event — inequality, never numeric order', () => {
  test('changed token syncs; identical replay token is ignored', () => {
    expect(decideRevisionV2Event({ appliedToken: 'op1', incomingToken: 'op2', seenThisAttach: true })).toBe('sync');
    expect(decideRevisionV2Event({ appliedToken: 'op2', incomingToken: 'op2', seenThisAttach: true })).toBe('ignore');
  });

  test('tokens are unordered: a lexicographically "smaller" new token still syncs', () => {
    expect(decideRevisionV2Event({ appliedToken: 'zzz', incomingToken: 'aaa', seenThisAttach: true })).toBe('sync');
  });

  test('malformed/absent incoming token never syncs (no loop on junk)', () => {
    expect(decideRevisionV2Event({ appliedToken: 'op1', incomingToken: null, seenThisAttach: true })).toBe('ignore');
    expect(decideRevisionV2Event({ appliedToken: null, incomingToken: null, seenThisAttach: false })).toBe('ignore');
  });

  test('offline catch-up: first snapshot after reattach syncs iff a persisted token differs', () => {
    expect(decideRevisionV2Event({ appliedToken: 'op1', incomingToken: 'op9', seenThisAttach: false })).toBe('sync');
    expect(decideRevisionV2Event({ appliedToken: 'op9', incomingToken: 'op9', seenThisAttach: false })).toBe('ignore');
  });

  test('fresh install / cleared state: no applied token → first event ignored (bootstrap fetch owns the initial refresh)', () => {
    expect(decideRevisionV2Event({ appliedToken: null, incomingToken: 'op1', seenThisAttach: false })).toBe('ignore');
    // ...but a LIVE change after attach syncs even with nothing applied yet.
    expect(decideRevisionV2Event({ appliedToken: null, incomingToken: 'op1', seenThisAttach: true })).toBe('sync');
  });
});

describe('mixed old/new contract', () => {
  test('old client semantics stay blind on the frozen legacy node; the v2 path syncs', () => {
    // Old client: strict-greater against the persisted saturated value.
    expect(decideIncomingVersionEvent({ appliedVersion: SATURATED, incomingVersion: SATURATED, seenThisAttach: true })).toBe('ignore');
    // New client on v2: any token change syncs.
    expect(decideRevisionV2Event({ appliedToken: 'op1', incomingToken: 'op2', seenThisAttach: true })).toBe('sync');
  });

  test('legacy bridge visible to old clients: a ULP-stepped value passes strict-greater', () => {
    const bumped = SATURATED + 65536; // what the Phase-2 server bridge writes
    expect(decideIncomingVersionEvent({ appliedVersion: SATURATED, incomingVersion: bumped, seenThisAttach: true })).toBe('sync');
  });

  test('rollback compatibility: v2 node absent → v2 ignores; legacy path still decides', () => {
    expect(decideRevisionV2Event({ appliedToken: 'op1', incomingToken: revisionV2TokenOf(null), seenThisAttach: true })).toBe('ignore');
    expect(decideIncomingVersionEvent({ appliedVersion: 60, incomingVersion: 61, seenThisAttach: true })).toBe('sync');
  });
});

describe('persistence — per verified driver, separate from legacy appliedVersion', () => {
  const store = new Map<string, string>();
  const readers = (driver: string | null) => ({
    getDriverId: async () => driver,
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { store.set(k, v); },
  });

  beforeEach(() => store.clear());

  test('storage key is driver-scoped and distinct from the legacy key', () => {
    expect(appliedRevisionV2StorageKey('driver-1')).toBe('@wbm_applied_revision_v2:driver-1');
    expect(() => appliedRevisionV2StorageKey('')).toThrow();
    expect(() => appliedRevisionV2StorageKey('unknown')).toThrow();
  });

  test('mark + load round trip; driver mismatch refuses', () => {
    return (async () => {
      expect(await markRevisionV2Applied('op7', 'driver-1', readers('driver-1'))).toBe(true);
      expect(peekAppliedRevisionV2()).toBe('op7');
      resetAppliedRevisionV2ForTests();
      expect(await loadAppliedRevisionV2(readers('driver-1'))).toBe('op7');
      // A different verified driver must not inherit the token.
      resetAppliedRevisionV2ForTests();
      expect(await loadAppliedRevisionV2(readers('driver-2'))).toBeNull();
      // Mark under a mismatched identity refuses.
      expect(await markRevisionV2Applied('op9', 'driver-1', readers('driver-2'))).toBe(false);
    })();
  });

  test('identity/storage failure returns null and never reuses unverified memory', async () => {
    expect(await loadAppliedRevisionV2({
      getDriverId: async () => { throw new Error('secure store down'); },
      getItem: async () => 'op1',
      setItem: async () => undefined,
    })).toBeNull();
    expect(peekAppliedRevisionV2()).toBeNull();
  });
});

describe('captureAndApplyOutgoingStatus — dual-token capture pipeline', () => {
  const baseIo = (over: Record<string, unknown> = {}) => ({
    fetchIncomingVersion: async () => 61,
    fetchRevisionV2: async () => 'op42',
    fetchOutgoingStatus: async () => ({ driverId: 'driver-1', responses: [{ r: 1 }], unavailableWells: [] }),
    saveResponses: async () => undefined,
    saveUnavailable: async () => undefined,
    markApplied: async () => true,
    markRevisionV2Applied: async () => true,
    ...over,
  } as any);

  test('both tokens are captured BEFORE the fetch and marked after a successful save', async () => {
    const order: string[] = [];
    const io = baseIo({
      fetchIncomingVersion: async () => { order.push('legacy'); return 61; },
      fetchRevisionV2: async () => { order.push('v2'); return 'op42'; },
      fetchOutgoingStatus: async () => { order.push('fetch'); return { driverId: 'driver-1', responses: [], unavailableWells: [] }; },
      markApplied: async () => { order.push('markLegacy'); return true; },
      markRevisionV2Applied: async () => { order.push('markV2'); return true; },
    });
    const r = await captureAndApplyOutgoingStatus(io);
    expect(r).toMatchObject({ markedVersion: 61, markedRevisionV2: 'op42', fetched: true });
    expect(order.indexOf('v2')).toBeLessThan(order.indexOf('fetch'));
    expect(order.indexOf('legacy')).toBeLessThan(order.indexOf('fetch'));
    expect(order.indexOf('markV2')).toBeGreaterThan(order.indexOf('fetch'));
  });

  test('v2 marks even when the legacy version is unreadable (v2 present / legacy absent)', async () => {
    const r = await captureAndApplyOutgoingStatus(baseIo({ fetchIncomingVersion: async () => null }));
    expect(r).toMatchObject({ markedVersion: null, markedRevisionV2: 'op42', fetched: true });
  });

  test('legacy marks even when v2 is absent (legacy present / v2 absent)', async () => {
    const r = await captureAndApplyOutgoingStatus(baseIo({ fetchRevisionV2: async () => null }));
    expect(r).toMatchObject({ markedVersion: 61, markedRevisionV2: null, fetched: true });
  });

  test('legacy call sites without the v2 hooks keep working unchanged', async () => {
    const io = baseIo();
    delete io.fetchRevisionV2;
    delete io.markRevisionV2Applied;
    const r = await captureAndApplyOutgoingStatus(io);
    expect(r).toMatchObject({ markedVersion: 61, markedRevisionV2: null, fetched: true });
  });

  test('nothing marks when the save fails (a missed refresh must retry later)', async () => {
    const r = await captureAndApplyOutgoingStatus(baseIo({
      saveResponses: async () => { throw new Error('disk'); },
    }));
    expect(r).toMatchObject({ markedVersion: null, markedRevisionV2: null, fetched: true });
  });
});
