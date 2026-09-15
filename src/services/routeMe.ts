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
