/**
 * Three-state WB-M eligibility. Empty route arrays are NOT a denial and
 * are NOT "all company wells". Only an authoritative successful profile
 * that explicitly has assignedRoutes (including [] or Unrouted-only)
 * may produce ineligible.
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

export function normalizeRouteList(raw: unknown): { present: boolean; malformed: boolean; routes: string[] } {
  if (raw === undefined || raw === null) return { present: false, malformed: false, routes: [] };
  if (!Array.isArray(raw)) return { present: true, malformed: true, routes: [] };
  const routes = raw
    .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    .map((r) => r.trim());
  return { present: true, malformed: false, routes };
}

export function isRealRouteName(route: string): boolean {
  return !route.startsWith('Unrouted');
}

/**
 * Evaluate a SUCCESSFUL profile's assignedRoutes field.
 * Missing/malformed field → unknown. Never call this on a failed fetch.
 */
export function evaluateAuthoritativeAssignedRoutes(raw: unknown): EligibilityStatus {
  const { present, malformed, routes } = normalizeRouteList(raw);
  if (malformed) return 'unknown';
  if (!present) return 'unknown';
  if (routes.length === 0) return 'ineligible';
  if (routes.some(isRealRouteName)) return 'eligible';
  return 'ineligible';
}

export function verdictFromAuthoritative(rawRoutes: unknown, rawWells: unknown = null): EligibilityVerdict {
  const routesNorm = normalizeRouteList(rawRoutes);
  const wellsNorm = normalizeRouteList(rawWells);
  if (routesNorm.malformed || wellsNorm.malformed) {
    return {
      status: 'unknown',
      source: 'authoritative',
      routes: null,
      wells: null,
      reason: 'scope_malformed',
      retryable: true,
    };
  }
  if (!routesNorm.present && !wellsNorm.present) {
    return {
      status: 'unknown',
      source: 'authoritative',
      routes: null,
      wells: null,
      reason: 'assigned_routes_missing',
      retryable: true,
    };
  }
  const routeList = routesNorm.present ? routesNorm.routes : [];
  const wellList = wellsNorm.present ? wellsNorm.routes : [];
  if (routeList.length === 0 && wellList.length === 0) {
    return {
      status: 'ineligible',
      source: 'authoritative',
      routes: [],
      wells: [],
      reason: 'explicit_empty',
      retryable: false,
    };
  }
  if (!routeList.some(isRealRouteName) && wellList.length === 0) {
    return {
      status: 'ineligible',
      source: 'authoritative',
      routes: routeList,
      wells: wellList,
      reason: 'unrouted_only',
      retryable: false,
    };
  }
  return {
    status: 'eligible',
    source: 'authoritative',
    routes: routeList,
    wells: wellList,
    reason: routeList.some(isRealRouteName) ? 'real_route' : 'assigned_wells',
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
export function eligibilityFromSameProfile(rawAssignedRoutes: unknown, hasCompanyId: boolean): EligibilityVerdict {
  if (!hasCompanyId) {
    return resolveEligibility({
      hasCompanyId: false,
      fetch: unknownVerdict('unused'),
      durable: null,
      sessionRoutes: null,
    });
  }
  return verdictFromAuthoritative(rawAssignedRoutes);
}
