/**
 * Versioned WB-M bootstrap envelope. Authoritative digest is the server's.
 */
import type { EligibilityVerdict } from './eligibility';

type WellConfigMap = Record<string, Record<string, unknown>>;

export const WBM_BOOTSTRAP_SCHEMA = 1;
export const WBM_ENVELOPE_KEY = '@wellbuilt_wbm_bootstrap_v1';

export type WbmBootstrapSnapshot = {
  ok: true;
  driverId: string;
  companyId: string;
  active: true;
  assignedRoutes: string[] | null;
  assignedWells: string[] | null;
  assignmentRevision: number;
  assignmentDigest: string;
  eligibilityStatus: 'eligible' | 'ineligible' | 'unknown';
  eligibilityReason: string;
  wells: WellConfigMap;
  wellCount: number;
  logoutAt?: number | null;
};

export type WbmBootstrapEnvelope = {
  schemaVersion: typeof WBM_BOOTSTRAP_SCHEMA;
  driverId: string;
  companyId: string;
  assignmentRevision: number;
  assignmentDigest: string;
  eligibility: EligibilityVerdict;
  wells: WellConfigMap;
  fetchedAt: number;
};

export function snapshotToEnvelope(snap: WbmBootstrapSnapshot): WbmBootstrapEnvelope {
  return {
    schemaVersion: WBM_BOOTSTRAP_SCHEMA,
    driverId: snap.driverId,
    companyId: snap.companyId,
    assignmentRevision: snap.assignmentRevision,
    assignmentDigest: snap.assignmentDigest,
    eligibility: {
      status: snap.eligibilityStatus,
      source: 'authoritative',
      routes: snap.assignedRoutes,
      wells: snap.assignedWells,
      reason: snap.eligibilityReason,
      retryable: snap.eligibilityStatus === 'unknown',
    },
    wells: snap.wells,
    fetchedAt: Date.now(),
  };
}

export function parseBootstrapEnvelope(raw: unknown): WbmBootstrapEnvelope | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== WBM_BOOTSTRAP_SCHEMA) return null;
  if (typeof o.driverId !== 'string' || !o.driverId) return null;
  if (typeof o.companyId !== 'string') return null;
  if (typeof o.assignmentRevision !== 'number' || !Number.isFinite(o.assignmentRevision)) return null;
  if (typeof o.assignmentDigest !== 'string' || !o.assignmentDigest) return null;
  if (typeof o.fetchedAt !== 'number') return null;
  const elig = o.eligibility as EligibilityVerdict | undefined;
  if (!elig || (elig.status !== 'eligible' && elig.status !== 'ineligible' && elig.status !== 'unknown')) {
    return null;
  }
  if (!o.wells || typeof o.wells !== 'object' || Array.isArray(o.wells)) return null;
  return {
    schemaVersion: WBM_BOOTSTRAP_SCHEMA,
    driverId: o.driverId,
    companyId: o.companyId,
    assignmentRevision: o.assignmentRevision,
    assignmentDigest: o.assignmentDigest,
    eligibility: elig,
    wells: o.wells as WellConfigMap,
    fetchedAt: o.fetchedAt,
  };
}

export function envelopeMatchesSession(
  env: WbmBootstrapEnvelope | null,
  driverId: string | null,
  companyId: string | null,
): boolean {
  if (!env || !driverId) return false;
  return env.driverId === driverId && env.companyId === (companyId || '');
}

export function envelopeMatchesRevision(
  env: WbmBootstrapEnvelope | null,
  revision: number,
  digest: string,
): boolean {
  if (!env) return false;
  return env.assignmentRevision === revision && env.assignmentDigest === digest;
}

/** Exact identity + digest + write-instance match for conditional durable cleanup. */
export function envelopeExactMatch(
  a: WbmBootstrapEnvelope | null,
  b: WbmBootstrapEnvelope | null,
): boolean {
  if (!a || !b) return false;
  return a.schemaVersion === b.schemaVersion
    && a.driverId === b.driverId
    && a.companyId === b.companyId
    && a.assignmentRevision === b.assignmentRevision
    && a.assignmentDigest === b.assignmentDigest
    && a.fetchedAt === b.fetchedAt;
}
