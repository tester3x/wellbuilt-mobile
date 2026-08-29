// revisionV2.ts — client side of the v2 refresh-signal contract (Phase 2).
//
// The legacy `packets/incoming_version` double is saturated (~4.3005e20): +1
// is below the float64 ULP, so the node stopped announcing mutations, and old
// installs persist the saturated value behind a strict-greater comparison
// that a downward reset would blind forever. The server now REPLACES a small
// node inside every committed canonical mutation's atomic patch:
//
//   packets/incoming_revision_v2 = { v: 2, token: <operationId>, at: <ms> }
//
// This client compares the TOKEN FOR INEQUALITY — never numeric order:
//   token unchanged  → ignore (idempotent replay, duplicate callback)
//   token differs    → refresh the outgoing snapshot (any change, either
//                      "direction": tokens are opaque identifiers)
//   token malformed  → ignore (never sync-loop on junk; the legacy watcher
//                      and the unconditional bootstrap fetch still cover us)
//
// The legacy listener stays attached during the migration (dual contract) —
// the coalesced runner in backgroundSync makes a double fire refresh ONCE.
// Applied tokens are persisted per verified driver, separately from the
// legacy appliedVersion.

import { verifiedDriverId } from './incomingVersion';

export const INCOMING_REVISION_V2_PATH = 'packets/incoming_revision_v2';

/** Defensive token extraction — mirrors the server parser exactly. */
export function revisionV2TokenOf(raw: unknown): string | null {
  if (typeof raw === 'string') return raw.trim() || null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const token = (raw as { token?: unknown }).token;
    if (typeof token === 'string' && token.trim()) return token.trim();
  }
  return null;
}

export type RevisionV2Decision = 'sync' | 'ignore';

/**
 * Same attach semantics as the legacy decider: the first snapshot after an
 * attach syncs only when a PERSISTED applied token exists and differs (a
 * missed change while detached); with no applied token the unconditional
 * bootstrap/foreground fetch owns the initial refresh, so the event is
 * ignored rather than double-fetching.
 */
export function decideRevisionV2Event(input: {
  appliedToken: string | null;
  incomingToken: string | null;
  seenThisAttach: boolean;
}): RevisionV2Decision {
  const incoming = input.incomingToken;
  if (!incoming) return 'ignore'; // absent or malformed — never loop on junk
  if (!input.seenThisAttach) {
    if (input.appliedToken == null) return 'ignore';
    return incoming !== input.appliedToken ? 'sync' : 'ignore';
  }
  if (input.appliedToken != null && incoming === input.appliedToken) return 'ignore';
  return 'sync';
}

export function appliedRevisionV2StorageKey(driverId: string): string {
  const id = verifiedDriverId(driverId);
  if (!id) {
    throw new Error('applied_revision_v2_requires_verified_driver');
  }
  return `@wbm_applied_revision_v2:${id}`;
}

type AppliedTokenMemory = { driverId: string; token: string };
let memoryApplied: AppliedTokenMemory | null = null;

export function peekAppliedRevisionV2(): string | null {
  return memoryApplied?.token ?? null;
}

export function resetAppliedRevisionV2ForTests(): void {
  memoryApplied = null;
}

export type RevisionV2Readers = {
  getDriverId: () => Promise<string | null | undefined>;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

async function productionReaders(): Promise<RevisionV2Readers> {
  const { getDriverId } = await import('./driverAuth');
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  return {
    getDriverId,
    getItem: (k) => AsyncStorage.getItem(k),
    setItem: (k, v) => AsyncStorage.setItem(k, v),
  };
}

/** Load the persisted applied token for the CURRENT verified driver (or null). */
export async function loadAppliedRevisionV2(readers?: RevisionV2Readers): Promise<string | null> {
  try {
    const io = readers || await productionReaders();
    let rawId: string | null | undefined;
    try {
      rawId = await io.getDriverId();
    } catch {
      memoryApplied = null;
      return null;
    }
    const driverId = verifiedDriverId(rawId);
    if (!driverId) {
      memoryApplied = null;
      return null;
    }
    if (memoryApplied && memoryApplied.driverId === driverId) return memoryApplied.token;
    if (memoryApplied && memoryApplied.driverId !== driverId) memoryApplied = null;
    const raw = await io.getItem(appliedRevisionV2StorageKey(driverId));
    const token = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    memoryApplied = token == null ? null : { driverId, token };
    return memoryApplied?.token ?? null;
  } catch {
    memoryApplied = null;
    return null;
  }
}

/** Persist an applied token, only under the expected verified driver. */
export async function markRevisionV2Applied(
  token: string,
  expectedDriverId: unknown,
  readers?: RevisionV2Readers,
): Promise<boolean> {
  if (typeof token !== 'string' || !token.trim()) return false;
  const expected = verifiedDriverId(expectedDriverId);
  if (!expected) return false;
  try {
    const io = readers || await productionReaders();
    let rawId: string | null | undefined;
    try {
      rawId = await io.getDriverId();
    } catch {
      return false;
    }
    const current = verifiedDriverId(rawId);
    if (!current || current !== expected) return false;
    await io.setItem(appliedRevisionV2StorageKey(current), token.trim());
    memoryApplied = { driverId: current, token: token.trim() };
    return true;
  } catch {
    return false;
  }
}
