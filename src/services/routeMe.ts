/**
 * Route Me client contract (WB-M Phase 1 — visual-only pilot).
 *
 * Route Me is a SHARED, server-driven surface: WB-M (and, later, WB-T) render the
 * SAME authenticated-driver-scoped result computed by ONE Cloud Functions routing
 * core. WB-M supplies NO client-authoritative driverId/companyId — the server derives
 * canonical driver/company/route/well scope from the authenticated session. WB-M does
 * NOT copy any routing/ranking math and does NOT read a global well pool.
 *
 * The self-scoped endpoint `getDriverRouteMe` does not exist yet (see the contract
 * report). Until it ships, fetchRouteMe FAILS CLOSED: canViewRouteMe=false, wells=[],
 * with an honest reason — never a global fetch, never a copied estimate.
 *
 * Entitlement + user authority are SERVER-returned (never inferred from which app is
 * installed, never a trusted client boolean).
 */

/** Assignment/muting state — mirrors the governed Dashboard Well Queue exactly. */
export type RouteMeAssignmentState =
  | 'unassigned'          // authorized + selectable
  | 'assigned_self'       // already this driver's / in DDJD → already loaded
  | 'assigned_other'      // another driver → visible, muted, not selectable
  | 'in_ddjd';            // already in the driver's DDJD → already loaded

export interface RouteMeWell {
  wellName: string;
  companyId: string;
  wellId: string;                 // canonical
  levelDisplay: string;           // shared vc58 estimate (server), e.g. "7'6\""
  timeTillPull: string;
  priorityState: 'pull-now' | 'approaching' | 'verify' | 'down' | 'no-gain';
  predictedReadyAtMs: number | null;  // shared ordering key (never recomputed here)
  pullsPerDay?: number;
  assignmentState: RouteMeAssignmentState;
  assignee?: string;
  muted: boolean;
  recommendedDisposal: string;    // eligible+valid choice, or "No verified drop-off"
}

export interface RouteMeCapabilities {
  canViewRouteMe: boolean;        // entitlement (server; not install-inferred)
  canCreateWbmPull: boolean;      // may record a manual WB-M pull
  canCreateDdjd: boolean;         // Phase 2; the client ALSO hard-disables in Phase 1
  ddjdUnavailableReason: string;  // honest copy for the disabled DDJD control
}

export interface RouteMeResult {
  ok: boolean;
  capabilities: RouteMeCapabilities;
  wells: RouteMeWell[];
  asOfMs: number | null;
  /** Present when fail-closed (endpoint absent/denied/offline). */
  unavailableReason?: string;
}

export const DEFAULT_DDJD_PILOT_REASON = 'WB-T assignment not enabled yet';

/** Fail-closed result — no entitlement, no wells, honest reason. Never fabricates. */
export function deniedRouteMe(reason: string): RouteMeResult {
  return {
    ok: false,
    capabilities: {
      canViewRouteMe: false,
      canCreateWbmPull: false,
      canCreateDdjd: false,
      ddjdUnavailableReason: DEFAULT_DDJD_PILOT_REASON,
    },
    wells: [],
    asOfMs: null,
    unavailableReason: reason,
  };
}

/**
 * Fetch the driver-scoped Route Me result from the shared routing core, self mode
 * (no client identity). Fail-closed on any error (endpoint not yet deployed, denied,
 * offline). NEVER falls back to a global pool or a copied local ranking.
 */
export async function fetchRouteMe(): Promise<RouteMeResult> {
  try {
    const { authorizedCallable } = await import('./firebaseAuthSession');
    const res = await authorizedCallable<RouteMeResult>('getDriverRouteMe', {});
    if (!res || res.capabilities?.canViewRouteMe !== true) {
      return deniedRouteMe(res?.unavailableReason || 'Route Me is not enabled for your account.');
    }
    return res;
  } catch (err) {
    const reason = (err as { callableStatus?: string })?.callableStatus === 'not-found'
      ? 'Route Me is being enabled — the routing service is not available yet.'
      : 'Route Me is temporarily unavailable. This is a read failure, not an empty route.';
    return deniedRouteMe(reason);
  }
}

/**
 * Phase 1 hard rule: the DDJD assignment control is VISIBLE but DISABLED regardless of
 * server capability — Phase 1 is visual-only and performs NO dispatch/DDJD write. The
 * server's reason (or the pilot copy) is surfaced honestly.
 */
export const ROUTE_ME_PHASE = 1 as const;

export function ddjdButtonState(
  caps: RouteMeCapabilities,
  checkedCount: number,
): { disabled: true; label: string; reason: string } {
  // Always disabled in Phase 1. (Phase 2 will enable when canCreateDdjd && authority.)
  return {
    disabled: true,
    label: `Load DDJD (${checkedCount})`,
    reason: caps.ddjdUnavailableReason || DEFAULT_DDJD_PILOT_REASON,
  };
}

/** Only unassigned+authorized wells are selectable for DDJD membership (UX preview). */
export function isSelectableForDdjd(well: RouteMeWell): boolean {
  return well.assignmentState === 'unassigned' && !well.muted;
}

// ── Day Planning Surface (Summary Candidate Well View + Governed DDJD Dispatch) ──

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  summaryCurrentLevel,
  summaryReadyLevel,
  summaryBblsAvailable,
  formatFeetInches,
  formatReadyTimeDisplay,
  type SummaryLevelInput,
} from './summaryWellLevel';
import { startingLevelFromSnapshot } from './downSnapshot';

export const STORAGE_KEY_DRIVER_DISPATCHES = '@wellbuilt_driver_dispatches';

export interface RouteMePlannedJob {
  id: string;
  kind: 'active_job' | 'paused_dispatch' | 'pending_dispatch' | 'candidate_well';
  wellName: string;
  operator?: string;
  jobType: 'pw' | 'sw';
  disposal?: string;
  status: 'active' | 'paused' | 'pending' | 'unbuilt';
  isCardBuilt: boolean;
  syncStatus?: 'confirmed' | 'queued_offline';
  syncLabel?: string;
  currentLevelFeet?: number;
  currentLevelDisplay?: string;
  readyLevelFeet?: number;
  readyLevelDisplay?: string;
  readyTimeDisplay?: string;
  readySubText?: string;
  isReady?: boolean;
  bblsAvailable?: number;
  splitGroupId?: string;
  splitSequence?: number;
  splitTotal?: number;
  dispatchId?: string;
  invoiceDocId?: string;
}

/** Check if a job card for this well is already built and not terminal */
export function isCardAlreadyBuilt(
  wellName: string,
  dispatches: Array<{ wellName?: string; status?: string }>,
): boolean {
  if (!wellName) return false;
  const norm = wellName.trim().toUpperCase();
  for (const d of dispatches || []) {
    const st = d?.status;
    if (st !== 'completed' && st !== 'cancelled' && st !== 'closed' && st !== 'declined') {
      const dName = (d?.wellName || '').trim().toUpperCase();
      if (dName === norm) return true;
    }
  }
  return false;
}

/**
 * Builds the complete Route Me Day Plan using Summary calculations:
 * 1. Pinned active or paused jobs at top.
 * 2. Pending DDJD dispatches (SW and PW coexistence).
 * 3. Candidate authorized wells with level, bbls available, and ready time.
 * 4. Distinguishes already-built DDJD cards from unbuilt wells.
 */
export function buildRouteMeDayPlanFromSummary(input: {
  wellConfig: Record<string, any>;
  snapshots: Map<string, any>;
  existingDispatches?: any[];
  pullBbls?: number;
  now?: number;
}): {
  pinnedJobs: RouteMePlannedJob[];
  pendingJobs: RouteMePlannedJob[];
  candidateWells: RouteMePlannedJob[];
} {
  const now = input.now || Date.now();
  const pullBbls = input.pullBbls || 140;
  const pinnedJobs: RouteMePlannedJob[] = [];
  const pendingJobs: RouteMePlannedJob[] = [];
  const candidateWells: RouteMePlannedJob[] = [];

  const dispatches = input.existingDispatches || [];

  // Categorize existing dispatches
  for (const d of dispatches) {
    if (d?.status === 'completed' || d?.status === 'cancelled' || d?.status === 'closed' || d?.status === 'declined') {
      continue;
    }
    const well = d.wellName || '';
    const cfg = input.wellConfig[well] || {};
    const snap = input.snapshots.get(well);
    const lvlInput: SummaryLevelInput = {
      levelFeet: snap ? startingLevelFromSnapshot(snap) : (cfg.levelFeet || 0),
      flowRateMinutes: snap?.flowRateMinutes || cfg.avgFlowRateMinutes || 0,
      snapshotTimestamp: snap?.timestamp || now,
      isDown: snap?.isDown ?? cfg.isDown ?? false,
    };
    const readyInfo = formatReadyTimeDisplay(
      { ...lvlInput, allowedBottom: cfg.allowedBottom, numTanks: cfg.numTanks || 1 },
      pullBbls,
      now,
    );

    const isJobActive = d.status === 'active' || d.status === 'in_progress';
    const isJobPaused = d.status === 'paused';

    const item: RouteMePlannedJob = {
      id: d.id || `disp_${d.dispatchId || well}`,
      kind: isJobActive ? 'active_job' : (isJobPaused ? 'paused_dispatch' : 'pending_dispatch'),
      wellName: well,
      operator: d.operator || cfg.operator || '',
      jobType: d.jobType || (d.commodityType === 'service' ? 'sw' : 'pw'),
      disposal: d.disposal || d.hauledTo || '',
      status: isJobActive ? 'active' : (isJobPaused ? 'paused' : 'pending'),
      isCardBuilt: true,
      syncStatus: d.syncStatus || 'confirmed',
      syncLabel: d.syncLabel,
      currentLevelFeet: summaryCurrentLevel(lvlInput, now),
      currentLevelDisplay: formatFeetInches(summaryCurrentLevel(lvlInput, now)),
      readyTimeDisplay: readyInfo.time,
      readySubText: readyInfo.subText,
      isReady: readyInfo.isReady,
      bblsAvailable: summaryBblsAvailable({ ...lvlInput, loadLine: cfg.loadLine, numTanks: cfg.numTanks || 1 }, now),
      splitGroupId: d.splitGroupId,
      splitSequence: d.splitSequence,
      splitTotal: d.splitTotal,
      dispatchId: d.id || d.dispatchId,
    };

    if (isJobActive || isJobPaused) {
      pinnedJobs.push(item);
    } else {
      pendingJobs.push(item);
    }
  }

  // Candidate wells
  for (const [wellName, cfg] of Object.entries(input.wellConfig)) {
    const snap = input.snapshots.get(wellName);
    const cardBuilt = isCardAlreadyBuilt(wellName, dispatches);
    const lvlInput: SummaryLevelInput = {
      levelFeet: snap ? startingLevelFromSnapshot(snap) : 0,
      flowRateMinutes: snap?.flowRateMinutes || cfg.avgFlowRateMinutes || 0,
      snapshotTimestamp: snap?.timestamp || now,
      isDown: snap?.isDown ?? cfg.isDown ?? false,
    };
    const readyLevel = summaryReadyLevel(
      { allowedBottom: cfg.allowedBottom, numTanks: cfg.numTanks || 1 },
      pullBbls,
    );
    const readyInfo = formatReadyTimeDisplay(
      { ...lvlInput, allowedBottom: cfg.allowedBottom, numTanks: cfg.numTanks || 1 },
      pullBbls,
      now,
    );

    candidateWells.push({
      id: `cand_${wellName}`,
      kind: 'candidate_well',
      wellName,
      operator: cfg.operator || '',
      jobType: 'pw',
      status: cardBuilt ? 'pending' : 'unbuilt',
      isCardBuilt: cardBuilt,
      currentLevelFeet: summaryCurrentLevel(lvlInput, now),
      currentLevelDisplay: formatFeetInches(summaryCurrentLevel(lvlInput, now)),
      readyLevelFeet: readyLevel,
      readyLevelDisplay: formatFeetInches(readyLevel),
      readyTimeDisplay: readyInfo.time,
      readySubText: readyInfo.subText,
      isReady: readyInfo.isReady,
      bblsAvailable: summaryBblsAvailable({ ...lvlInput, loadLine: cfg.loadLine, numTanks: cfg.numTanks || 1 }, now),
    });
  }

  return { pinnedJobs, pendingJobs, candidateWells };
}

/**
 * Validates and applies reordering of remaining planned jobs.
 * Enforces the split-ticket sequencing invariant:
 * Earlier split leg must close before next begins; monotonic sequence within splitGroupId.
 */
export function reorderPlannedJobs(
  jobs: RouteMePlannedJob[],
  fromIndex: number,
  toIndex: number,
): { ok: boolean; reordered: RouteMePlannedJob[]; error?: string } {
  if (fromIndex < 0 || fromIndex >= jobs.length || toIndex < 0 || toIndex >= jobs.length) {
    return { ok: false, reordered: jobs, error: 'invalid_index' };
  }
  if (fromIndex === toIndex) {
    return { ok: true, reordered: jobs };
  }

  const next = [...jobs];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);

  // Validate split-ticket sequencing invariant:
  const seenSequences = new Map<string, number>();
  for (const item of next) {
    if (item.splitGroupId && typeof item.splitSequence === 'number') {
      const prevSeq = seenSequences.get(item.splitGroupId);
      if (prevSeq !== undefined && item.splitSequence < prevSeq) {
        return {
          ok: false,
          reordered: jobs,
          error: 'split_ticket_sequence_violation: earlier split leg must close before next begins',
        };
      }
      seenSequences.set(item.splitGroupId, item.splitSequence);
    }
  }

  return { ok: true, reordered: next };
}

let cachedGovernedRevision: number | null = null;

export function setGovernedRevisionForTests(rev: number | null): void {
  cachedGovernedRevision = rev;
}

export async function resolveWbmPacketRevision(packageId = 'water-hauling'): Promise<number | null> {
  if (cachedGovernedRevision && cachedGovernedRevision > 0) {
    return cachedGovernedRevision;
  }
  try {
    const { authorizedCallable } = await import('./firebaseAuthSession');
    const bundle = await authorizedCallable<{
      ok?: boolean;
      governedPackageProfiles?: Array<{ packageId: string; packetRevision: number }>;
    }>('getDriverReferenceBundle', {});
    if (bundle && Array.isArray(bundle.governedPackageProfiles)) {
      const match = bundle.governedPackageProfiles.find(
        (p) => p.packageId === packageId && typeof p.packetRevision === 'number' && p.packetRevision > 0,
      );
      if (match) {
        cachedGovernedRevision = match.packetRevision;
        return match.packetRevision;
      }
    }
  } catch (err) {
    console.warn('[RouteMe] Unable to resolve packet revision from reference bundle:', err);
  }
  return null;
}

export function isPermanentWbmAuthorityRejection(err: unknown): boolean {
  const msg = String(
    (err as any)?.message ||
    (err as any)?.details ||
    (err as any)?.code ||
    (err as any)?.callableStatus ||
    err || ''
  ).toLowerCase();
  return (
    msg.includes('packet_revision_unresolved') ||
    msg.includes('unauthenticated') ||
    msg.includes('permission-denied') ||
    msg.includes('permission_denied') ||
    msg.includes('failed-precondition') ||
    msg.includes('caller_package_id_not_authority') ||
    msg.includes('unauthorized') ||
    msg.includes('unexpected field') ||
    msg.includes('unknown_job_type') ||
    msg.includes('invalid-argument') ||
    msg.includes('not-found') ||
    msg.includes('unscoped_driver') ||
    msg.includes('revision_not_found') ||
    msg.includes('disposal_not_eligible') ||
    msg.includes('disposal_required') ||
    msg.includes('conflict')
  );
}

export function isWbmDefiniteOfflineError(err: unknown): boolean {
  const msg = String(
    (err as any)?.message ||
    (err as any)?.details ||
    (err as any)?.code ||
    (err as any)?.callableStatus ||
    err || ''
  ).toLowerCase();
  return (
    msg.includes('offline') ||
    msg.includes('not connected') ||
    msg.includes('enetunreach') ||
    msg.includes('econnrefused')
  );
}

export function isWbmTimeoutOrAmbiguousNetworkError(err: unknown): boolean {
  const msg = String(
    (err as any)?.message ||
    (err as any)?.details ||
    (err as any)?.code ||
    (err as any)?.callableStatus ||
    err || ''
  ).toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('deadline-exceeded') ||
    msg.includes('deadline_exceeded') ||
    msg.includes('network request failed') ||
    msg.includes('network') ||
    msg.includes('unavailable') ||
    msg.includes('failed to fetch') ||
    msg.includes('response dropped') ||
    msg.includes('econnreset')
  );
}

export const STORAGE_KEY_PENDING_DISPATCH_ATTEMPTS = '@wbm_pending_dispatch_attempts';

let testDriverIdentity: { driverId: string; companyId: string } | null = null;

export function setDriverIdentityForTests(identity: { driverId: string; companyId?: string } | null): void {
  if (!identity) {
    testDriverIdentity = null;
  } else {
    testDriverIdentity = {
      driverId: identity.driverId.trim(),
      companyId: (identity.companyId || '').trim(),
    };
  }
}

export async function resolveCurrentDriverIdentity(
  explicitDriverId?: string,
  explicitCompanyId?: string,
): Promise<{ driverId: string; companyId: string }> {
  if (explicitDriverId && explicitDriverId.trim()) {
    return {
      driverId: explicitDriverId.trim(),
      companyId: (explicitCompanyId || '').trim(),
    };
  }
  if (testDriverIdentity) {
    return testDriverIdentity;
  }
  try {
    const { getDriverId, getDriverSession } = await import('./driverAuth');
    const dId = await getDriverId();
    if (dId && dId.trim()) {
      const sess = await getDriverSession().catch(() => null);
      return {
        driverId: dId.trim(),
        companyId: (sess?.companyId || '').trim(),
      };
    }
  } catch {
    // fall through
  }
  try {
    const SecureStore = await import('expo-secure-store');
    const dId = await SecureStore.getItemAsync('driverId');
    const cId = await SecureStore.getItemAsync('companyId');
    if (dId && dId.trim()) {
      return {
        driverId: dId.trim(),
        companyId: (cId || '').trim(),
      };
    }
  } catch {
    // fall through
  }
  return {
    driverId: 'default_driver',
    companyId: '',
  };
}

export interface WbmDispatchIntent {
  driverId: string;
  companyId?: string;
  wellName: string;
  jobType: 'pw' | 'service';
  jobTypeId: string;
  disposal: string;
  packetRevision: number;
  packageId: string;
}

export interface PendingDispatchAttempt {
  dispatchId: string;
  intent: WbmDispatchIntent;
  createdAt: number;
}

export function buildAttemptKey(
  driverId: string,
  companyId: string | undefined,
  wellName: string,
): string {
  const normDriver = (driverId || 'default_driver').trim().toLowerCase();
  const normCompany = (companyId || '').trim().toLowerCase();
  const normWell = (wellName || '').trim().toLowerCase();
  return `${normDriver}:${normCompany}:${normWell}`;
}

export function isSameDispatchIntent(a: WbmDispatchIntent, b: WbmDispatchIntent): boolean {
  if (!a || !b) return false;
  return (
    (a.driverId || '').trim().toLowerCase() === (b.driverId || '').trim().toLowerCase() &&
    (a.companyId || '').trim().toLowerCase() === (b.companyId || '').trim().toLowerCase() &&
    (a.wellName || '').trim().toLowerCase() === (b.wellName || '').trim().toLowerCase() &&
    (a.jobType || '') === (b.jobType || '') &&
    (a.jobTypeId || '') === (b.jobTypeId || '') &&
    (a.disposal || '').trim().toLowerCase() === (b.disposal || '').trim().toLowerCase() &&
    a.packetRevision === b.packetRevision &&
    (a.packageId || '').trim().toLowerCase() === (b.packageId || '').trim().toLowerCase()
  );
}

export async function getPendingDispatchAttempt(
  attemptKey: string,
): Promise<PendingDispatchAttempt | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_PENDING_DISPATCH_ATTEMPTS);
    if (!raw) return null;
    const map = JSON.parse(raw);
    const entry = map[attemptKey];
    if (!entry) return null;
    if (typeof entry === 'string') {
      // Legacy format backwards compatibility
      return {
        dispatchId: entry,
        intent: {} as any,
        createdAt: Date.now(),
      };
    }
    return entry as PendingDispatchAttempt;
  } catch {
    return null;
  }
}

export async function getPendingDispatchAttemptId(
  wellName: string,
  driverId?: string,
  companyId?: string,
): Promise<string | null> {
  try {
    const ident = await resolveCurrentDriverIdentity(driverId, companyId);
    const key = buildAttemptKey(ident.driverId, ident.companyId, wellName);
    const attempt = await getPendingDispatchAttempt(key);
    return attempt?.dispatchId || null;
  } catch {
    return null;
  }
}

export async function recordPendingDispatchAttempt(
  attemptKey: string,
  attempt: PendingDispatchAttempt,
): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY_PENDING_DISPATCH_ATTEMPTS);
  const map = raw ? JSON.parse(raw) : {};
  map[attemptKey] = attempt;
  await AsyncStorage.setItem(STORAGE_KEY_PENDING_DISPATCH_ATTEMPTS, JSON.stringify(map));
}

export async function clearPendingDispatchAttempt(attemptKey: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_PENDING_DISPATCH_ATTEMPTS);
    if (!raw) return;
    const map = JSON.parse(raw);
    delete map[attemptKey];
    await AsyncStorage.setItem(STORAGE_KEY_PENDING_DISPATCH_ATTEMPTS, JSON.stringify(map));
  } catch (err) {
    console.warn('[RouteMe] Failed to clear pending dispatch attempt:', err);
  }
}

const inFlightDispatches = new Map<string, Promise<WbmDriverDispatchResult>>();

export function getInFlightDispatchCountForTests(): number {
  return inFlightDispatches.size;
}

export function clearInFlightDispatchesForTests(): void {
  inFlightDispatches.clear();
}

export type WbmDriverDispatchResult = {
  ok: boolean;
  status?: 'created' | 'already_exists' | 'unknown';
  dispatchId?: string;
  error?: string;
};

/**
 * Governed Build Job dispatch creation:
 * - Prevents duplicates.
 * - Does not start automatically (status: 'pending').
 * - Bypasses Plans and Job Builder drawers.
 * - Sourced disposal validation: for PW, requires verified eligible & available drop-off (rejects if absent/ineligible).
 * - For SW, does not assume destination is an SWD (drop-off is optional / non-SWD).
 * - Requires published packet revision (never hardcodes revision 1).
 * - Uses canonical authorized jobTypeId ('pw' for PW, 'service-work' for SW).
 * - Preserves/reuses a stable, identity-scoped dispatchId across attempts until reconciled.
 * - Deduplicates concurrent calls for the same intent using in-flight promise sharing.
 * - Persists durable intent to storage before calling the server (aborts if persistence fails).
 * - Calls server callable createDriverDispatchIfAbsent FIRST.
 * - If server rejects (authority, validation, not-found, etc.), fails visibly and NEVER creates a phantom card.
 * - If definite offline failure, fails closed honestly reporting offline_unavailable (NEVER creates a phantom card).
 * - If ambiguous network outcome / timeout / dropped response, models outcome as unknown (NEVER creates a phantom card),
 *   preserving the stable request ID for idempotent retry.
 * - Validates server result shape before local confirmed persistence.
 * - On server confirmation ('created' or 'already_exists'), persists locally FIRST with syncStatus 'confirmed',
 *   and ONLY clears the pending attempt after local persistence succeeds.
 */
export async function createWbmDriverDispatch(input: {
  wellName: string;
  operator?: string;
  jobType?: 'pw' | 'sw';
  disposal?: string;
  eligibleDisposals?: string[];
  packetRevision?: number;
  packageId?: string;
  dispatchId?: string;
  driverId?: string;
  companyId?: string;
}): Promise<WbmDriverDispatchResult> {
  const { wellName, operator, jobType = 'pw', disposal, eligibleDisposals, packageId = 'water-hauling' } = input;
  if (!wellName || !wellName.trim()) {
    return { ok: false, error: 'well_name_required' };
  }

  const isPw = (jobType || 'pw').toLowerCase() === 'pw';

  // 1. Sourced disposal validation:
  if (isPw) {
    if (!disposal || !disposal.trim() || disposal.trim() === 'No verified drop-off') {
      return { ok: false, error: 'disposal_required: verified eligible drop-off required for produced water' };
    }
    if (eligibleDisposals && eligibleDisposals.length > 0) {
      const normDisp = disposal.trim().toLowerCase();
      const isEligible = eligibleDisposals.some((d) => d.trim().toLowerCase() === normDisp);
      if (!isEligible) {
        return { ok: false, error: 'disposal_not_eligible' };
      }
    }
  }

  // 2. Read-only pre-check: duplicate card in local dispatches
  const raw = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
  const existing: any[] = raw ? JSON.parse(raw) : [];
  if (isCardAlreadyBuilt(wellName, existing)) {
    return { ok: false, error: 'duplicate_card_exists' };
  }

  // 3. Resolve published packet revision
  const resolvedRevision =
    typeof input.packetRevision === 'number' && Number.isInteger(input.packetRevision) && input.packetRevision > 0
      ? input.packetRevision
      : await resolveWbmPacketRevision(packageId);

  if (!resolvedRevision || !Number.isInteger(resolvedRevision) || resolvedRevision < 1) {
    return { ok: false, error: 'packet_revision_unresolved: governed packetRevision is required before dispatch creation' };
  }

  // 4. Resolve driver/company identity and build scoped attempt key
  const identity = await resolveCurrentDriverIdentity(input.driverId, input.companyId);
  const canonicalJobTypeId = isPw ? 'pw' : 'service-work';
  const currentIntent: WbmDispatchIntent = {
    driverId: identity.driverId,
    companyId: identity.companyId,
    wellName: wellName.trim(),
    jobType: isPw ? 'pw' : 'service',
    jobTypeId: canonicalJobTypeId,
    disposal: disposal?.trim() || '',
    packetRevision: resolvedRevision,
    packageId,
  };
  const attemptKey = buildAttemptKey(identity.driverId, identity.companyId, wellName);

  // 5. In-flight concurrency deduplication / mutex:
  // Simultaneous calls for the same driver/company/well share the active in-flight promise
  const existingInFlight = inFlightDispatches.get(attemptKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const dispatchPromise = (async () => {
    try {
      return await executeCreateWbmDriverDispatch({
        input,
        wellName: wellName.trim(),
        operator: operator?.trim() || '',
        isPw,
        canonicalJobTypeId,
        disposal: disposal?.trim() || '',
        packageId,
        resolvedRevision,
        identity,
        currentIntent,
        attemptKey,
      });
    } finally {
      inFlightDispatches.delete(attemptKey);
    }
  })();

  inFlightDispatches.set(attemptKey, dispatchPromise);
  return dispatchPromise;
}

async function executeCreateWbmDriverDispatch(params: {
  input: {
    wellName: string;
    operator?: string;
    jobType?: 'pw' | 'sw';
    disposal?: string;
    eligibleDisposals?: string[];
    packetRevision?: number;
    packageId?: string;
    dispatchId?: string;
    driverId?: string;
    companyId?: string;
  };
  wellName: string;
  operator: string;
  isPw: boolean;
  canonicalJobTypeId: string;
  disposal: string;
  packageId: string;
  resolvedRevision: number;
  identity: { driverId: string; companyId: string };
  currentIntent: WbmDispatchIntent;
  attemptKey: string;
}): Promise<WbmDriverDispatchResult> {
  const {
    input,
    wellName,
    operator,
    isPw,
    canonicalJobTypeId,
    disposal,
    packageId,
    resolvedRevision,
    currentIntent,
    attemptKey,
  } = params;

  // Determine dispatchId:
  // Check if an un-reconciled attempt exists for this driver + well
  let dispatchId = input.dispatchId;
  if (!dispatchId) {
    const existingAttempt = await getPendingDispatchAttempt(attemptKey);
    if (existingAttempt && existingAttempt.dispatchId) {
      if (existingAttempt.intent && isSameDispatchIntent(existingAttempt.intent, currentIntent)) {
        // Same unresolved request: reuse original ID and payload
        dispatchId = existingAttempt.dispatchId;
      } else if (!existingAttempt.intent || !existingAttempt.intent.wellName) {
        // Legacy attempt record without intent payload: reuse ID
        dispatchId = existingAttempt.dispatchId;
      } else {
        // Changed request! Allocate a new ID for the new details
        dispatchId = `wbm_disp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      }
    } else {
      dispatchId = `wbm_disp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  // Durable intent persistence:
  // Must persist attempt to storage BEFORE calling server.
  // If write fails, ABORT before calling the server!
  try {
    await recordPendingDispatchAttempt(attemptKey, {
      dispatchId,
      intent: currentIntent,
      createdAt: Date.now(),
    });
  } catch (err: any) {
    console.error('[RouteMe] Storage failure recording pending dispatch attempt:', err);
    return {
      ok: false,
      error: `storage_failure: Failed to persist durable dispatch attempt: ${err?.message || err}`,
    };
  }

  const record: Record<string, unknown> = {
    wellName,
    operator,
    jobType: isPw ? 'pw' : 'service',
    jobTypeId: canonicalJobTypeId,
    disposal,
    hauledTo: disposal,
  };

  // Call server callable FIRST — never write a local card before server confirmation
  let serverResult: { ok: boolean; result?: 'created' | 'already_exists'; dispatchId?: string } | null = null;

  try {
    const { authorizedCallable } = await import('./firebaseAuthSession');
    serverResult = await authorizedCallable('createDriverDispatchIfAbsent', {
      dispatchId,
      record,
      packetRef: { packageId, revision: resolvedRevision },
    });
  } catch (err: any) {
    if (isPermanentWbmAuthorityRejection(err)) {
      // Governed authority or validation rejection: fail visibly, clear attempt, NEVER create local card
      console.warn('[RouteMe] Server rejected dispatch creation:', err);
      await clearPendingDispatchAttempt(attemptKey);
      return { ok: false, error: err?.message || 'governed_authority_rejection' };
    }

    if (isWbmDefiniteOfflineError(err)) {
      // Definite disconnected-before-send failure: network interface down / offline
      console.warn('[RouteMe] Definite offline error during dispatch creation (no phantom card):', err);
      return {
        ok: false,
        error: 'offline_unavailable: Network connection required to create governed DDJD cards. Please connect to a network and try again.',
      };
    }

    if (isWbmTimeoutOrAmbiguousNetworkError(err)) {
      // Ambiguous network outcome / lost response after send:
      // Keep the stable dispatchId in pending attempts for idempotent retry reconciliation.
      console.warn('[RouteMe] Network timeout or response dropped during dispatch creation, modeling as unknown outcome:', err);
      return {
        ok: false,
        status: 'unknown',
        dispatchId,
        error: 'unknown_outcome: Network request timed out or response was lost. The server may have created the dispatch. Retrying will reconcile using the same request ID.',
      };
    }

    // Unknown server error: fail visibly, do NOT save phantom card
    console.error('[RouteMe] createDriverDispatchIfAbsent unexpected error:', err);
    return { ok: false, error: err?.message || 'server_dispatch_failed' };
  }

  // Check server result shape
  if (!serverResult || serverResult.ok !== true || (serverResult.result !== 'created' && serverResult.result !== 'already_exists')) {
    console.error('[RouteMe] createDriverDispatchIfAbsent invalid result shape:', serverResult);
    return { ok: false, error: 'invalid_server_result_shape' };
  }

  const confirmedDispatchId = serverResult.dispatchId || dispatchId;
  const dispatchRecord = {
    id: confirmedDispatchId,
    dispatchId: confirmedDispatchId,
    wellName,
    operator,
    jobType: isPw ? 'pw' : 'sw',
    jobTypeId: canonicalJobTypeId,
    disposal,
    hauledTo: disposal,
    status: 'pending', // startImmediately: false -> status 'pending'
    syncStatus: 'confirmed',
    packetRevision: resolvedRevision,
    packageId,
    loadCount: 1,
    loadsCompleted: 0,
    source: 'driver',
    createdAt: new Date().toISOString(),
  };

  // Local confirmed persistence FIRST before clearing the pending attempt
  try {
    const freshRaw = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
    const currentDispatches: any[] = freshRaw ? JSON.parse(freshRaw) : [];
    const existingIdx = currentDispatches.findIndex(
      (d: any) => (d.id || d.dispatchId) === confirmedDispatchId || d.wellName === wellName,
    );
    if (existingIdx >= 0) {
      currentDispatches[existingIdx] = { ...currentDispatches[existingIdx], ...dispatchRecord };
    } else {
      currentDispatches.push(dispatchRecord);
    }
    await AsyncStorage.setItem(STORAGE_KEY_DRIVER_DISPATCHES, JSON.stringify(currentDispatches));
  } catch (err: any) {
    console.error('[RouteMe] Failed to persist confirmed dispatch locally:', err);
    // Note: Pending attempt is NOT cleared, allowing recoverable retry
    return {
      ok: false,
      status: 'unknown',
      dispatchId: confirmedDispatchId,
      error: `local_persistence_failed: Server confirmed dispatch, but failed to save card locally: ${err?.message || err}. Retrying will recover card.`,
    };
  }

  // Confirmed persistence succeeded: now safe to clear pending attempt
  await clearPendingDispatchAttempt(attemptKey);

  return {
    ok: true,
    status: serverResult.result,
    dispatchId: confirmedDispatchId,
  };
}
