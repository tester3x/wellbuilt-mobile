/**
 * Three-state WB-M eligibility against the canonical profile:
 *   drivers/profiles/{driverId}.assignedRoutes
 *   drivers/profiles/{driverId}.assignedWells
 *
 * Real route or explicit assigned well → eligible.
 * Explicit [] / Unrouted-only / no wells → ineligible.
 * Missing fields → unknown. Missing must not grant all company wells.
 */

export type EligibilityStatus = 'eligible' | 'ineligible' | 'unknown';

export type EligibleDestination = '/welcome' | '/(tabs)';
export type BootstrapRoute = EligibleDestination | '/no-access' | '/driver-login' | '/session-verify';

export interface EligibilityVerdict {
  status: EligibilityStatus;
  /** Where the routes came from. */
  source: 'authoritative' | 'durable' | 'session' | 'none';
  routes: string[] | null;
  wells: string[] | null;
  /** Machine reason — never a secret. */
  reason: string;
  retryable: boolean;
}

export function normalizeRouteList(raw: unknown): { present: boolean; routes: string[] } {
  if (raw === undefined || raw === null) return { present: false, routes: [] };
  if (!Array.isArray(raw)) return { present: false, routes: [] };
  const routes = raw
    .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    .map((r) => r.trim());
  return { present: true, routes };
}

export function isRealRouteName(route: string): boolean {
  return !route.startsWith('Unrouted');
}

/**
 * Evaluate a SUCCESSFUL profile's assignedRoutes field.
 * Missing/malformed field → unknown. Never call this on a failed fetch.
 * Prefer evaluateAuthoritativeAssignment when wells may also be present.
 */
export function evaluateAuthoritativeAssignedRoutes(raw: unknown): EligibilityStatus {
  return evaluateAuthoritativeAssignment(raw, undefined);
}

export function evaluateAuthoritativeAssignment(rawRoutes: unknown, rawWells: unknown): EligibilityStatus {
  return verdictFromAuthoritative(rawRoutes, rawWells).status;
}

export function verdictFromAuthoritative(rawRoutes: unknown, rawWells: unknown = undefined): EligibilityVerdict {
  const routesNorm = normalizeRouteList(rawRoutes);
  const wellsNorm = normalizeRouteList(rawWells);
  if (!routesNorm.present && !wellsNorm.present) {
    return {
      status: 'unknown',
      source: 'authoritative',
      routes: null,
      wells: null,
      reason: 'assignment_unavailable',
      retryable: true,
    };
  }
  const hasRealRoute = routesNorm.present && routesNorm.routes.some(isRealRouteName);
  const hasWell = wellsNorm.present && wellsNorm.routes.length > 0;
  if (hasRealRoute || hasWell) {
    return {
      status: 'eligible',
      source: 'authoritative',
      routes: routesNorm.present ? routesNorm.routes : null,
      wells: wellsNorm.present ? wellsNorm.routes : null,
      reason: hasRealRoute ? 'real_route' : 'assigned_wells',
      retryable: false,
    };
  }
  const reason =
    routesNorm.present && routesNorm.routes.length > 0 && !hasRealRoute && !hasWell
      ? 'unrouted_only'
      : 'explicit_empty';
  return {
    status: 'ineligible',
    source: 'authoritative',
    routes: routesNorm.present ? routesNorm.routes : null,
    wells: wellsNorm.present ? wellsNorm.routes : null,
    reason,
    retryable: false,
  };
}

export function unknownVerdict(reason: string, retryable = true): EligibilityVerdict {
  return {
    status: 'unknown',
    source: 'none',
    routes: null,
    wells: null,
    reason,
    retryable,
  };
}

/**
 * Merge a fresh lookup with durable last-known eligibility.
 * Unknown never overwrites known eligibility with ineligible.
 * /no-access is only justified by an authoritative ineligible verdict.
 */
export function resolveEligibility(opts: {
  hasCompanyId: boolean;
  fetch: EligibilityVerdict;
  durable: EligibilityVerdict | null;
  sessionRoutes: unknown;
}): EligibilityVerdict {
  if (!opts.hasCompanyId) {
    return {
      status: 'eligible',
      source: 'authoritative',
      routes: [],
      wells: [],
      reason: 'no_company_admin',
      retryable: false,
    };
  }
  if (opts.fetch.status === 'eligible' || opts.fetch.status === 'ineligible') {
    return opts.fetch;
  }
  if (opts.durable && opts.durable.status === 'eligible' && opts.durable.routes) {
    return {
      ...opts.durable,
      source: 'durable',
      reason: `durable_eligible:${opts.fetch.reason}`,
      retryable: true,
    };
  }
  const session = normalizeRouteList(opts.sessionRoutes);
  if (session.present) {
    const fromSession = evaluateAuthoritativeAssignedRoutes(opts.sessionRoutes);
    if (fromSession === 'eligible') {
      return {
        status: 'eligible',
        source: 'session',
        routes: session.routes,
        wells: null,
        reason: `session_eligible:${opts.fetch.reason}`,
        retryable: true,
      };
    }
  }
  return opts.fetch.status === 'unknown' ? opts.fetch : unknownVerdict(opts.fetch.reason);
}

/**
 * Shared post-auth authorization. Manual, SSO, and cold start MUST use this.
 * Eligible destinations may differ (welcome vs tabs); ineligible/unknown
 * handling is identical. Never send unknown/ineligible to welcome or tabs.
 */
export function decidePostAuthRoute(opts: {
  hasLocalSession: boolean;
  revalidation: 'valid' | 'revoked' | 'unknown';
  eligibility: EligibilityStatus;
  eligibleDestination?: EligibleDestination;
}): BootstrapRoute {
  const intended = opts.eligibleDestination ?? '/welcome';
  if (!opts.hasLocalSession) return '/driver-login';
  if (opts.revalidation === 'revoked') return '/driver-login';
  if (opts.eligibility === 'ineligible' && opts.revalidation === 'valid') return '/no-access';
  if (opts.eligibility === 'eligible') return intended;
  return '/session-verify';
}

/** Cold-start helper — same verdict as post-auth with welcome as eligible dest. */
export function decideBootstrapRoute(opts: {
  hasLocalSession: boolean;
  revalidation: 'valid' | 'revoked' | 'unknown';
  eligibility: EligibilityStatus;
}): BootstrapRoute {
  return decidePostAuthRoute({ ...opts, eligibleDestination: '/welcome' });
}

/** Same data → same verdict regardless of login method. */
export function eligibilityFromSameProfile(
  rawAssignedRoutes: unknown,
  hasCompanyId: boolean,
  rawAssignedWells: unknown = undefined,
): EligibilityVerdict {
  if (!hasCompanyId) {
    return resolveEligibility({
      hasCompanyId: false,
      fetch: unknownVerdict('unused'),
      durable: null,
      sessionRoutes: null,
    });
  }
  return verdictFromAuthoritative(rawAssignedRoutes, rawAssignedWells);
}
