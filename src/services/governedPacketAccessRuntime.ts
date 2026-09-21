import {
  acceptResolveExecutionBindingResponse,
  buildResolveExecutionBindingRequest,
  type BindingAcceptResult,
  type GovernedAccessKind,
  type SessionIdentity,
  packetGrantsCapability,
  requiredCapabilityForSurface,
  type GovernedSurface,
} from './governedPacketAccessCore';
import {
  forgetExecutionBinding,
  rememberExecutionBinding,
  lookupGovernedCapability,
  type ExecutionBindingSnapshot,
} from './governedPacketAccessMemory';

export type GovernedReadyOk = { ok: true; snapshot: ExecutionBindingSnapshot | null; kind: 'ok' };
export type GovernedReadyFail = {
  ok: false;
  kind: Exclude<GovernedAccessKind, 'ok'>;
  reason: string;
  field?: string;
  retryable: boolean;
};
export type GovernedReadyResult = GovernedReadyOk | GovernedReadyFail;

function isOffline(status: string): boolean {
  return status === 'offline' || status === 'degraded';
}

function fail(
  kind: Exclude<GovernedAccessKind, 'ok'>,
  reason: string,
  retryable: boolean,
  field?: string,
): GovernedReadyFail {
  return field ? { ok: false, kind, reason, retryable, field } : { ok: false, kind, reason, retryable };
}

export async function runGovernedExecutionBinding(input: {
  governed: boolean;
  jobId: unknown;
  session: SessionIdentity | null;
  connectivityStatus: string;
  resolve: (request: { jobId: string }) => Promise<unknown>;
  loadCached: (jobId: string, session: SessionIdentity) => Promise<BindingAcceptResult>;
  persist: (snapshot: ExecutionBindingSnapshot) => Promise<void>;
  invalidate: (jobId: string) => Promise<void>;
  surface?: GovernedSurface;
  jobType?: unknown;
}): Promise<GovernedReadyResult> {
  if (input.governed !== true) {
    return { ok: true, snapshot: null, kind: 'ok' };
  }
  const id = typeof input.jobId === 'string' ? input.jobId.trim() : '';
  if (!id) return fail('missing_job', 'missing_job_id', false);
  if (!input.session?.companyId || !input.session?.driverId) {
    return fail('unauthenticated', 'unauthenticated_session', true);
  }

  const cached = await input.loadCached(id, input.session);
  if (cached.ok) {
    rememberExecutionBinding(cached.snapshot);
    return finishSurface(cached.snapshot, input.surface, input.jobType);
  }

  if (isOffline(input.connectivityStatus)) {
    forgetExecutionBinding(id);
    return fail('offline_uncached', 'uncached_offline', true);
  }

  let raw: unknown;
  try {
    raw = await input.resolve(buildResolveExecutionBindingRequest(id));
  } catch (err: any) {
    forgetExecutionBinding(id);
    return fail('network', err?.code || err?.message || 'resolve_failed', true);
  }

  const accepted = acceptResolveExecutionBindingResponse({
    requestedJobId: id,
    session: input.session,
    raw,
  });
  if (!accepted.ok) {
    forgetExecutionBinding(id);
    await input.invalidate(id);
    return fail('invalid', accepted.reason, false, accepted.field);
  }

  try {
    await input.persist(accepted.snapshot);
  } catch {
    forgetExecutionBinding(id);
    return fail('invalid', 'persist_failed', true);
  }
  rememberExecutionBinding(accepted.snapshot);
  return finishSurface(accepted.snapshot, input.surface, input.jobType);
}

function finishSurface(
  snapshot: ExecutionBindingSnapshot,
  surface: GovernedSurface | undefined,
  jobType: unknown,
): GovernedReadyResult {
  if (typeof jobType === 'string' && jobType.trim()) {
    const cap = requiredCapabilityForSurface(surface || 'open');
    if (!packetGrantsCapability(snapshot.definition, cap)) {
      return fail('packet_denied', 'job_type_cannot_bypass_packet', false);
    }
  }
  if (surface) {
    const cap = requiredCapabilityForSurface(surface);
    if (!lookupGovernedCapability(snapshot.jobId, cap)) {
      return fail('packet_denied', `missing_capability:${cap}`, false);
    }
  }
  return { ok: true, snapshot, kind: 'ok' };
}

export async function restoreGovernedExecutionBinding(input: {
  governed: boolean;
  jobId: unknown;
  session: SessionIdentity | null;
  loadCached: (jobId: string, session: SessionIdentity) => Promise<BindingAcceptResult>;
  surface?: GovernedSurface;
}): Promise<GovernedReadyResult> {
  if (input.governed !== true) {
    return { ok: true, snapshot: null, kind: 'ok' };
  }
  const id = typeof input.jobId === 'string' ? input.jobId.trim() : '';
  if (!id) return fail('missing_job', 'missing_job_id', false);
  if (!input.session?.companyId || !input.session?.driverId) {
    return fail('unauthenticated', 'unauthenticated_session', true);
  }
  const cached = await input.loadCached(id, input.session);
  if (!cached.ok) {
    forgetExecutionBinding(id);
    return fail('invalid', cached.reason, false, cached.field);
  }
  rememberExecutionBinding(cached.snapshot);
  return finishSurface(cached.snapshot, input.surface, undefined);
}

export function governedUiKind(result: GovernedReadyResult): 'ready' | 'network' | 'offline' | 'packet' | 'missing' {
  if (result.ok) return 'ready';
  if (result.kind === 'offline_uncached') return 'offline';
  if (result.kind === 'packet_denied') return 'packet';
  if (result.kind === 'missing_job') return 'missing';
  return 'network';
}
