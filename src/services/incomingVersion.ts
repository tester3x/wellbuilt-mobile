/**
 * incoming_version attach/apply contract.
 *
 * Live processIncomingPull writes packets/outgoing and does NOT increment
 * incoming_version (only edit/delete do). A sleeping phone therefore cannot
 * recover from the version watcher alone. Foreground fetch is the durable
 * path; this module still preserves applied versions so a reattached
 * watcher cannot treat a missed increment as a fresh baseline.
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

let memoryApplied: number | null = null;

export function peekAppliedIncomingVersion(): number | null {
  return memoryApplied;
}

export function resetAppliedIncomingVersionForTests(): void {
  memoryApplied = null;
}

export async function loadAppliedIncomingVersion(): Promise<number | null> {
  if (memoryApplied != null) return memoryApplied;
  try {
    const { getDriverId } = await import('./driverAuth');
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const driverId = (await getDriverId()) || 'unknown';
    const raw = await AsyncStorage.getItem(appliedVersionStorageKey(driverId));
    memoryApplied = parseStoredVersion(raw);
    return memoryApplied;
  } catch {
    return memoryApplied;
  }
}

export async function markIncomingVersionApplied(version: number): Promise<void> {
  if (!Number.isFinite(version)) return;
  memoryApplied = version;
  try {
    const { getDriverId } = await import('./driverAuth');
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    const driverId = (await getDriverId()) || 'unknown';
    await AsyncStorage.setItem(appliedVersionStorageKey(driverId), String(version));
  } catch {
    // in-memory applied version still prevents reattach baseline hide
  }
}
