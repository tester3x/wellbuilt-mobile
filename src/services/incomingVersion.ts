/**
 * incoming_version attach/apply contract.
 *
 * Applied versions are stored only under a verified authenticated driver id.
 * Identity/storage failure returns null and never reuses unverified memory.
 */

export type IncomingVersionDecision = 'sync' | 'ignore';

export function decideIncomingVersionEvent(input: {
  appliedVersion: number | null;
  incomingVersion: number | null | undefined;
  seenThisAttach: boolean;
}): IncomingVersionDecision {
  const incoming = Number(input.incomingVersion);
  if (!Number.isFinite(incoming)) return 'ignore';

  if (!input.seenThisAttach) {
    if (input.appliedVersion == null) return 'ignore';
    return incoming > input.appliedVersion ? 'sync' : 'ignore';
  }

  if (input.appliedVersion != null && incoming <= input.appliedVersion) {
    return 'ignore';
  }
  return 'sync';
}

export function verifiedDriverId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  if (!id || id.toLowerCase() === 'unknown') return null;
  return id;
}

export function appliedVersionStorageKey(driverId: string): string {
  const id = verifiedDriverId(driverId);
  if (!id) {
    throw new Error('applied_version_requires_verified_driver');
  }
  return `@wbm_applied_incoming_version:${id}`;
}

export function parseStoredVersion(raw: string | null): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export type AppliedVersionMemory = { driverId: string; version: number };

export function appliedVersionForDriver(
  memory: AppliedVersionMemory | null,
  driverId: string | null,
): number | null {
  if (!memory || !driverId) return null;
  if (memory.driverId !== driverId) return null;
  return memory.version;
}

export function shouldMarkIncomingVersionApplied(input: {
  fetchOk: boolean;
  snapshotsSaved: boolean;
}): boolean {
  return input.fetchOk === true && input.snapshotsSaved === true;
}

let memoryApplied: AppliedVersionMemory | null = null;

export function peekAppliedIncomingVersion(): number | null {
  return memoryApplied?.version ?? null;
}

export function peekAppliedIncomingVersionOwner(): string | null {
  return memoryApplied?.driverId ?? null;
}

export function resetAppliedIncomingVersionForTests(): void {
  memoryApplied = null;
}

export type AppliedVersionReaders = {
  getDriverId: () => Promise<string | null | undefined>;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

async function productionReaders(): Promise<AppliedVersionReaders> {
  const { getDriverId } = await import('./driverAuth');
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  return {
    getDriverId,
    getItem: (k) => AsyncStorage.getItem(k),
    setItem: (k, v) => AsyncStorage.setItem(k, v),
  };
}

export async function loadAppliedIncomingVersion(
  readers?: AppliedVersionReaders,
): Promise<number | null> {
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
    const scoped = appliedVersionForDriver(memoryApplied, driverId);
    if (scoped != null) return scoped;
    if (memoryApplied && memoryApplied.driverId !== driverId) {
      memoryApplied = null;
    }
    const raw = await io.getItem(appliedVersionStorageKey(driverId));
    const version = parseStoredVersion(raw);
    memoryApplied = version == null ? null : { driverId, version };
    return memoryApplied?.version ?? null;
  } catch {
    memoryApplied = null;
    return null;
  }
}

export async function markIncomingVersionApplied(
  version: number,
  expectedDriverId: unknown,
  readers?: AppliedVersionReaders,
): Promise<boolean> {
  if (!Number.isFinite(version)) return false;
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
    memoryApplied = { driverId: current, version };
    await io.setItem(appliedVersionStorageKey(current), String(version));
    return true;
  } catch {
    return false;
  }
}

export type OutgoingStatusCapture<T = unknown> = {
  driverId?: unknown;
  responses: T[];
  unavailableWells?: string[];
};

export type OutgoingStatusSyncIo<T = unknown> = {
  fetchIncomingVersion: () => Promise<number | null>;
  fetchOutgoingStatus: () => Promise<OutgoingStatusCapture<T> | null>;
  saveResponses: (responses: T[]) => Promise<void>;
  saveUnavailable: (wells: string[]) => Promise<void>;
  markApplied: (version: number, expectedDriverId: string) => Promise<unknown>;
};

export async function captureAndApplyOutgoingStatus<T>(
  io: OutgoingStatusSyncIo<T>,
): Promise<{ count: number; markedVersion: number | null; fetched: boolean }> {
  let versionBeforeFetch: number | null = null;
  try {
    versionBeforeFetch = await io.fetchIncomingVersion();
  } catch {
    versionBeforeFetch = null;
  }

  let result: OutgoingStatusCapture<T> | null = null;
  try {
    result = await io.fetchOutgoingStatus();
  } catch {
    return { count: 0, markedVersion: null, fetched: false };
  }
  if (!result) {
    return { count: 0, markedVersion: null, fetched: false };
  }

  const responses = Array.isArray(result.responses) ? result.responses : [];
  const unavailable = Array.isArray(result.unavailableWells) ? result.unavailableWells : [];
  try {
    await io.saveResponses(responses);
    await io.saveUnavailable(unavailable);
  } catch {
    return { count: 0, markedVersion: null, fetched: true };
  }

  const expected = verifiedDriverId(result.driverId);
  if (
    versionBeforeFetch == null
    || !expected
    || !shouldMarkIncomingVersionApplied({ fetchOk: true, snapshotsSaved: true })
  ) {
    return { count: responses.length, markedVersion: null, fetched: true };
  }

  const appliedOk = await io.markApplied(versionBeforeFetch, expected);
  return {
    count: responses.length,
    markedVersion: appliedOk === false ? null : versionBeforeFetch,
    fetched: true,
  };
}
