export const CONTRACTS_CAPABILITY_LIFECYCLE = 'lifecycle';
export const CONTRACTS_CAPABILITY_PICKUP = 'pickup';

export type ExecutionBindingPin = {
  packageId: string;
  packetRevision: number;
  contentHash: string;
  policyHash: string;
};

export type ExecutionBindingSnapshot = {
  jobId: string;
  companyId: string;
  driverId: string;
  binding: ExecutionBindingPin;
  definition: Record<string, unknown>;
  implementedEffects: readonly unknown[];
};

const memory = new Map<string, ExecutionBindingSnapshot>();

export function rememberExecutionBinding(snapshot: ExecutionBindingSnapshot): void {
  memory.set(snapshot.jobId, snapshot);
}

export function forgetExecutionBinding(jobId: string): void {
  memory.delete(jobId);
}

export function clearExecutionBindingMemory(): void {
  memory.clear();
}

export function getRememberedExecutionBinding(jobId: string): ExecutionBindingSnapshot | null {
  const id = typeof jobId === 'string' ? jobId.trim() : '';
  if (!id) return null;
  return memory.get(id) ?? null;
}

function capabilityIdsFromDefinition(definition: unknown): Set<string> {
  const granted = new Set<string>();
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return granted;
  const caps = (definition as Record<string, unknown>).capabilities;
  if (!Array.isArray(caps)) return granted;
  for (const entry of caps) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const id = (entry as Record<string, unknown>).capabilityId;
    if (typeof id === 'string' && id.trim()) granted.add(id);
  }
  return granted;
}

export function lookupGovernedCapability(jobId: string, capabilityId: string): boolean {
  const snap = getRememberedExecutionBinding(jobId);
  if (!snap) return false;
  if (!Array.isArray(snap.implementedEffects) || snap.implementedEffects.length !== 0) return false;
  if (capabilityId !== CONTRACTS_CAPABILITY_LIFECYCLE && capabilityId !== CONTRACTS_CAPABILITY_PICKUP) {
    return false;
  }
  return capabilityIdsFromDefinition(snap.definition).has(capabilityId);
}
