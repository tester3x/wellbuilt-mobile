/**
 * Pure validation of resolveExecutionBinding responses and durable cache rows.
 * Contracts 0.7.0 public APIs only. No second hash algorithm.
 */
import { validate, definitionSchema } from '@tester3x/wellbuilt-contracts/transport';
import {
  CONTRACTS_CAPABILITY_LIFECYCLE,
  CONTRACTS_CAPABILITY_PICKUP,
  type DispatchExecutionContext,
  type ExecutionBindingPin,
  type ExecutionBindingSnapshot,
} from './governedPacketAccessMemory';

export const EXECUTION_BINDING_CACHE_VERSION = 2 as const;
export const EXECUTION_BINDING_INDEX_PREFIX = 'wbm.executionBinding.index.v2.';
export const EXECUTION_BINDING_RECORD_PREFIX = 'wbm.executionBinding.record.v2.';

export type BindingAcceptFail = { ok: false; reason: string; field?: string };
export type BindingAcceptResult = { ok: true; snapshot: ExecutionBindingSnapshot } | BindingAcceptFail;

export type SessionIdentity = { companyId: string; driverId: string };

export type GovernedAccessKind =
  | 'ok'
  | 'missing_job'
  | 'unauthenticated'
  | 'offline_uncached'
  | 'network'
  | 'invalid'
  | 'packet_denied';

function fail(reason: string, field?: string): BindingAcceptFail {
  return field ? { ok: false, reason, field } : { ok: false, reason };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ownString(obj: Record<string, unknown>, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc || desc.get !== undefined || desc.set !== undefined) return null;
  if (typeof desc.value !== 'string') return null;
  const trimmed = desc.value.trim();
  return trimmed ? trimmed : null;
}

function ownNumber(obj: Record<string, unknown>, key: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return null;
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  if (!desc || desc.get !== undefined || desc.set !== undefined) return null;
  if (typeof desc.value !== 'number' || !Number.isSafeInteger(desc.value) || desc.value < 1) return null;
  return desc.value;
}

function snapshotPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readBinding(raw: unknown): ExecutionBindingPin | null {
  if (!isPlainObject(raw)) return null;
  const packageId = ownString(raw, 'packageId');
  const packetRevision = ownNumber(raw, 'packetRevision');
  const contentHash = ownString(raw, 'contentHash');
  const policyHash = ownString(raw, 'policyHash');
  if (!packageId || packetRevision == null || !contentHash || !policyHash) return null;
  if (!/^[a-f0-9]{64}$/.test(contentHash) || !/^[a-f0-9]{64}$/.test(policyHash)) return null;
  return { packageId, packetRevision, contentHash, policyHash };
}

export function bindingCacheIndexKey(jobId: string): string {
  return `${EXECUTION_BINDING_INDEX_PREFIX}${jobId}`;
}

export function bindingCacheRecordKey(jobId: string, binding: ExecutionBindingPin): string {
  return [
    EXECUTION_BINDING_RECORD_PREFIX,
    jobId,
    binding.packageId,
    String(binding.packetRevision),
    binding.contentHash,
    binding.policyHash,
  ].join('.');
}

export function pinsEqual(a: ExecutionBindingPin, b: ExecutionBindingPin): boolean {
  return (
    a.packageId === b.packageId
    && a.packetRevision === b.packetRevision
    && a.contentHash === b.contentHash
    && a.policyHash === b.policyHash
  );
}

function acceptImplementedEffects(raw: unknown): readonly unknown[] | null {
  if (!Array.isArray(raw)) return null;
  if (Object.getPrototypeOf(raw) !== Array.prototype) return null;
  if (raw.length !== 0) return null;
  return [];
}

export type LocalDispatchIdentity = {
  jobTypeId?: string;
  wellName?: string;
  ndicWellName?: string;
};

function readExecution(raw: unknown): DispatchExecutionContext | null {
  if (!isPlainObject(raw)) return null;
  const jobTypeId = ownString(raw, 'jobTypeId');
  const wellName = ownString(raw, 'wellName');
  const ndicWellName = ownString(raw, 'ndicWellName');
  if (!jobTypeId || !wellName || !ndicWellName) return null;
  return { jobTypeId, wellName, ndicWellName };
}

export function executionEqual(a: DispatchExecutionContext, b: DispatchExecutionContext): boolean {
  return a.jobTypeId === b.jobTypeId && a.wellName === b.wellName && a.ndicWellName === b.ndicWellName;
}

function matchLocalIdentity(
  execution: DispatchExecutionContext,
  local: LocalDispatchIdentity | undefined,
): BindingAcceptFail | null {
  if (!local) return null;
  const jobTypeId = typeof local.jobTypeId === 'string' ? local.jobTypeId.trim() : '';
  const wellName = typeof local.wellName === 'string' ? local.wellName.trim() : '';
  const ndicWellName = typeof local.ndicWellName === 'string' ? local.ndicWellName.trim() : '';
  if (jobTypeId && jobTypeId !== execution.jobTypeId) return fail('job_type_mismatch', 'jobTypeId');
  if (wellName && wellName !== execution.wellName) return fail('well_mismatch', 'wellName');
  if (ndicWellName && ndicWellName !== execution.ndicWellName) return fail('well_mismatch', 'ndicWellName');
  return null;
}

/** Request body is exactly { jobId }. */
export function buildResolveExecutionBindingRequest(jobId: string): { jobId: string } {
  return { jobId };
}

export function acceptResolveExecutionBindingResponse(input: {
  requestedJobId: string;
  session: SessionIdentity;
  raw: unknown;
  localIdentity?: LocalDispatchIdentity;
}): BindingAcceptResult {
  const requestedJobId = typeof input.requestedJobId === 'string' ? input.requestedJobId.trim() : '';
  if (!requestedJobId) return fail('missing_job_id');
  const companyId = typeof input.session.companyId === 'string' ? input.session.companyId.trim() : '';
  const driverId = typeof input.session.driverId === 'string' ? input.session.driverId.trim() : '';
  if (!companyId || !driverId) return fail('unauthenticated_session');
  if (!isPlainObject(input.raw)) return fail('response_must_be_object');
  if (input.raw.ok !== true) return fail('not_ok');
  const jobId = ownString(input.raw, 'jobId');
  if (!jobId) return fail('missing_job_id', 'jobId');
  if (jobId !== requestedJobId) return fail('job_id_mismatch', 'jobId');
  const responseCompanyId = ownString(input.raw, 'companyId');
  const responseDriverId = ownString(input.raw, 'driverId');
  if (!responseCompanyId) return fail('missing_company_id', 'companyId');
  if (!responseDriverId) return fail('missing_driver_id', 'driverId');
  if (responseCompanyId !== companyId) return fail('company_id_mismatch', 'companyId');
  if (responseDriverId !== driverId) return fail('driver_id_mismatch', 'driverId');
  const binding = readBinding(input.raw.binding);
  if (!binding) return fail('incomplete_binding', 'binding');
  const validated = validate(definitionSchema, input.raw.definition);
  if (!validated.ok) return fail('definition_invalid', validated.path || 'definition');
  const implementedEffects = acceptImplementedEffects(input.raw.implementedEffects);
  if (!implementedEffects) return fail('implemented_effects_not_empty_array', 'implementedEffects');
  const execution = readExecution(input.raw.execution);
  if (!execution) return fail('incomplete_execution', 'execution');
  const localMismatch = matchLocalIdentity(execution, input.localIdentity);
  if (localMismatch) return localMismatch;
  const snapshot: ExecutionBindingSnapshot = Object.freeze({
    jobId,
    companyId: responseCompanyId,
    driverId: responseDriverId,
    binding: Object.freeze({ ...binding }),
    execution: Object.freeze({ ...execution }),
    definition: Object.freeze(snapshotPlain(validated.value)) as Record<string, unknown>,
    implementedEffects: Object.freeze([...implementedEffects]),
  });
  return { ok: true, snapshot };
}

export function serializeExecutionBindingRecord(snapshot: ExecutionBindingSnapshot): string {
  return JSON.stringify({
    cacheVersion: EXECUTION_BINDING_CACHE_VERSION,
    jobId: snapshot.jobId,
    companyId: snapshot.companyId,
    driverId: snapshot.driverId,
    binding: snapshot.binding,
    execution: snapshot.execution,
    definition: snapshot.definition,
    implementedEffects: snapshot.implementedEffects,
  });
}

export function serializeExecutionBindingIndex(snapshot: ExecutionBindingSnapshot): string {
  return JSON.stringify({
    cacheVersion: EXECUTION_BINDING_CACHE_VERSION,
    jobId: snapshot.jobId,
    binding: snapshot.binding,
    execution: snapshot.execution,
  });
}

export function restoreExecutionBindingRecord(input: {
  jobId: string;
  session: SessionIdentity;
  indexJson: string | null | undefined;
  recordJson: string | null | undefined;
}): BindingAcceptResult {
  const jobId = typeof input.jobId === 'string' ? input.jobId.trim() : '';
  if (!jobId) return fail('missing_job_id');
  if (typeof input.indexJson !== 'string' || !input.indexJson.trim()) return fail('cache_missing');
  if (typeof input.recordJson !== 'string' || !input.recordJson.trim()) return fail('cache_missing');
  let indexRaw: unknown;
  let recordRaw: unknown;
  try {
    indexRaw = JSON.parse(input.indexJson);
    recordRaw = JSON.parse(input.recordJson);
  } catch {
    return fail('cache_corrupt');
  }
  if (!isPlainObject(indexRaw) || !isPlainObject(recordRaw)) return fail('cache_corrupt');
  if (indexRaw.cacheVersion !== EXECUTION_BINDING_CACHE_VERSION) return fail('cache_version');
  if (recordRaw.cacheVersion !== EXECUTION_BINDING_CACHE_VERSION) return fail('cache_version');
  const indexJobId = ownString(indexRaw, 'jobId');
  const recordJobId = ownString(recordRaw, 'jobId');
  if (!indexJobId || !recordJobId || indexJobId !== jobId || recordJobId !== jobId) {
    return fail('cache_job_mismatch', 'jobId');
  }
  const indexBinding = readBinding(indexRaw.binding);
  const recordBinding = readBinding(recordRaw.binding);
  if (!indexBinding || !recordBinding) return fail('incomplete_binding', 'binding');
  if (!pinsEqual(indexBinding, recordBinding)) return fail('cache_pin_mismatch', 'binding');
  const indexExecution = readExecution(indexRaw.execution);
  const recordExecution = readExecution(recordRaw.execution);
  if (!indexExecution || !recordExecution) return fail('incomplete_execution', 'execution');
  if (!executionEqual(indexExecution, recordExecution)) return fail('cache_execution_mismatch', 'execution');
  return acceptResolveExecutionBindingResponse({
    requestedJobId: jobId,
    session: input.session,
    raw: {
      ok: true,
      jobId: recordJobId,
      companyId: recordRaw.companyId,
      driverId: recordRaw.driverId,
      binding: recordBinding,
      execution: recordExecution,
      definition: recordRaw.definition,
      implementedEffects: recordRaw.implementedEffects,
    },
  });
}

export type ExecutionBindingKv = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export async function persistExecutionBindingToKv(
  kv: ExecutionBindingKv,
  snapshot: ExecutionBindingSnapshot,
): Promise<void> {
  const indexKey = bindingCacheIndexKey(snapshot.jobId);
  const recordKey = bindingCacheRecordKey(snapshot.jobId, snapshot.binding);
  const previousIndex = await kv.getItem(indexKey);
  if (previousIndex) {
    try {
      const parsed = JSON.parse(previousIndex) as { binding?: ExecutionBindingPin };
      if (parsed?.binding) {
        const previousRecordKey = bindingCacheRecordKey(snapshot.jobId, parsed.binding);
        if (previousRecordKey !== recordKey) await kv.removeItem(previousRecordKey);
      }
    } catch { /* replace */ }
  }
  await kv.setItem(recordKey, serializeExecutionBindingRecord(snapshot));
  await kv.setItem(indexKey, serializeExecutionBindingIndex(snapshot));
}

export async function loadPersistedExecutionBindingFromKv(
  kv: ExecutionBindingKv,
  input: { jobId: string; session: SessionIdentity },
): Promise<BindingAcceptResult> {
  const jobId = typeof input.jobId === 'string' ? input.jobId.trim() : '';
  if (!jobId) return fail('missing_job_id');
  const indexJson = await kv.getItem(bindingCacheIndexKey(jobId));
  if (!indexJson) return fail('cache_missing');
  let binding: ExecutionBindingPin | null = null;
  try {
    const parsed = JSON.parse(indexJson) as { binding?: ExecutionBindingPin };
    if (parsed?.binding) binding = parsed.binding;
  } catch {
    return fail('cache_corrupt');
  }
  if (!binding) return fail('cache_corrupt');
  const recordJson = await kv.getItem(bindingCacheRecordKey(jobId, binding));
  return restoreExecutionBindingRecord({ jobId, session: input.session, indexJson, recordJson });
}

export async function invalidatePersistedExecutionBindingInKv(
  kv: ExecutionBindingKv,
  jobId: string,
): Promise<void> {
  const id = typeof jobId === 'string' ? jobId.trim() : '';
  if (!id) return;
  const indexKey = bindingCacheIndexKey(id);
  const indexJson = await kv.getItem(indexKey);
  if (indexJson) {
    try {
      const parsed = JSON.parse(indexJson) as { binding?: ExecutionBindingPin };
      if (parsed?.binding) await kv.removeItem(bindingCacheRecordKey(id, parsed.binding));
    } catch { /* drop index */ }
  }
  await kv.removeItem(indexKey);
}

export type GovernedSurface = 'open' | 'pull';

export function requiredCapabilityForSurface(surface: GovernedSurface): string {
  return surface === 'pull' ? CONTRACTS_CAPABILITY_PICKUP : CONTRACTS_CAPABILITY_LIFECYCLE;
}

export function packetGrantsCapability(definition: unknown, capabilityId: string): boolean {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return false;
  const caps = (definition as Record<string, unknown>).capabilities;
  if (!Array.isArray(caps)) return false;
  return caps.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    return (entry as Record<string, unknown>).capabilityId === capabilityId;
  });
}

/**
 * Contracts 0.7.0 capability → current 7d87f17 WB-M access gate → surface.
 * Re-census: Production Water is still the well-pull /record path, not WB-T
 * tickets. Route Me/DDJD do not carry a Dashboard dispatch jobId.
 * lifecycle = enter/open the record surface (including wellbuiltmobile://record?jobId=).
 * pickup = submit a Production Water pull.
 */
export const GOVERNED_ACCESS_MAP = Object.freeze([
  Object.freeze({
    contractsCapabilityId: CONTRACTS_CAPABILITY_LIFECYCLE,
    wbmGate: 'openProductionWaterRecord',
    surfaces: Object.freeze(['/record new pull', 'handlePullPress', 'wellbuiltmobile://record?jobId=']),
  }),
  Object.freeze({
    contractsCapabilityId: CONTRACTS_CAPABILITY_PICKUP,
    wbmGate: 'submitProductionWaterPull',
    surfaces: Object.freeze(['record handleSubmit']),
  }),
]);

export function accessDeniedByJobTypeText(_jobType: unknown): boolean {
  return true;
}
