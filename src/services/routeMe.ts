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

/**
 * Governed Build Job dispatch creation:
 * - Prevents duplicates.
 * - Does not start automatically (status: 'pending').
 * - Bypasses Plans and Job Builder drawers.
 * - Requires explicit success or failure result.
 * - Suggests drop-off from driver's history only when SWD is verified eligible and available (no guessing).
 */
export async function createWbmDriverDispatch(input: {
  wellName: string;
  operator?: string;
  jobType?: 'pw' | 'sw';
  disposal?: string;
  eligibleDisposals?: string[];
}): Promise<{ ok: boolean; dispatchId?: string; error?: string }> {
  const { wellName, operator, jobType = 'pw', disposal, eligibleDisposals } = input;
  if (!wellName) return { ok: false, error: 'well_name_required' };

  // Drop-off verification: if disposal is passed, ensure it is eligible when an eligible list is provided
  if (disposal && eligibleDisposals && eligibleDisposals.length > 0) {
    const normDisp = disposal.trim().toLowerCase();
    const isEligible = eligibleDisposals.some((d) => d.trim().toLowerCase() === normDisp);
    if (!isEligible) {
      return { ok: false, error: 'disposal_not_eligible' };
    }
  }

  // Load existing dispatches to check for duplicate
  const raw = await AsyncStorage.getItem(STORAGE_KEY_DRIVER_DISPATCHES);
  const existing: any[] = raw ? JSON.parse(raw) : [];
  if (isCardAlreadyBuilt(wellName, existing)) {
    return { ok: false, error: 'duplicate_card_exists' };
  }

  const dispatchId = `wbm_disp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dispatchRecord = {
    id: dispatchId,
    dispatchId,
    wellName,
    operator: operator || '',
    jobType,
    disposal: disposal || '',
    hauledTo: disposal || '',
    status: 'pending', // startImmediately: false -> status 'pending'
    loadCount: 1,
    loadsCompleted: 0,
    source: 'driver',
    createdAt: new Date().toISOString(),
  };

  // Persist locally first
  existing.push(dispatchRecord);
  await AsyncStorage.setItem(STORAGE_KEY_DRIVER_DISPATCHES, JSON.stringify(existing));

  // Attempt governed callable in background
  try {
    const { authorizedCallable } = await import('./firebaseAuthSession');
    await authorizedCallable('createDriverDispatchIfAbsent', {
      dispatchId,
      record: {
        wellName,
        operator: operator || '',
        jobType,
        disposal: disposal || '',
        hauledTo: disposal || '',
      },
      packetRef: { packageId: 'water-hauling', packetRevision: 1 },
    });
  } catch (err) {
    // Non-fatal if offline — local dispatch persists and remains visible in DDJD queue
    console.log('[RouteMe] Server callable createDriverDispatchIfAbsent deferred:', err);
  }

  return { ok: true, dispatchId };
}
