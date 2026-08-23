/**
 * incoming_version attach/apply contract.
 *
 * Live processIncomingPull historically wrote packets/outgoing without
 * bumping this counter. Foreground fetch remains the durable wake path;
 * applied versions are stored per authenticated driver so a previous
 * driver's in-memory value cannot suppress the next driver's first sync.
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

export function appliedVersionStorageKey(driverId: string): string {
  const id = (driverId || '').trim() || 'unknown';
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
  driverId: string,
): number | null {
  if (!memory) return null;
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

export async function loadAppliedIncomingVersion(): Promise<number | null> {
  try {
    const { getDriverId } = await import('./driverAuth');
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const driverId = (await getDriverId()) || 'unknown';
    const scoped = appliedVersionForDriver(memoryApplied, driverId);
    if (scoped != null) return scoped;
    if (memoryApplied && memoryApplied.driverId !== driverId) {
      memoryApplied = null;
    }
    const raw = await AsyncStorage.getItem(appliedVersionStorageKey(driverId));
    const version = parseStoredVersion(raw);
    memoryApplied = version == null ? null : { driverId, version };
    return memoryApplied?.version ?? null;
  } catch {
    return appliedVersionForDriver(memoryApplied, memoryApplied?.driverId || 'unknown');
  }
}

export async function markIncomingVersionApplied(version: number): Promise<void> {
  if (!Number.isFinite(version)) return;
  try {
    const { getDriverId } = await import('./driverAuth');
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const driverId = (await getDriverId()) || 'unknown';
    memoryApplied = { driverId, version };
    await AsyncStorage.setItem(appliedVersionStorageKey(driverId), String(version));
  } catch {
    // in-memory applied version still prevents reattach baseline hide
  }
}
