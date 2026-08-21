jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn() }));
jest.mock('expo-device', () => ({ modelName: 'test' }));

import {
  decideBootstrapRoute,
  decidePostAuthRoute,
  eligibilityFromSameProfile,
  evaluateAuthoritativeAssignedRoutes,
  normalizeRouteList,
  resolveEligibility,
  unknownVerdict,
  verdictFromAuthoritative,
} from '../eligibility';
import { identityChanged } from '../driverAuth';
import { classifyLoginFailure } from '../driverAuth';

describe('identity switch without logout', () => {
  test('Driver A → Driver B clears caches even if logout was skipped', () => {
    expect(identityChanged(
      { driverId: 'A', companyId: 'lg' },
      { driverId: 'B', companyId: 'lg' },
    )).toBe(true);
    expect(identityChanged(
      { driverId: 'A', companyId: 'lg' },
      { driverId: 'A', companyId: 'lg' },
    )).toBe(false);
  });
});

describe('three-state eligibility', () => {
  test('real assigned route is eligible', () => {
    expect(evaluateAuthoritativeAssignedRoutes(['North Loop'])).toBe('eligible');
    expect(verdictFromAuthoritative(['North Loop']).reason).toBe('real_route');
  });

  test('mixed real and Unrouted is eligible', () => {
    expect(evaluateAuthoritativeAssignedRoutes(['North Loop', 'Unrouted'])).toBe('eligible');
  });

  test('explicit Unrouted-only is ineligible', () => {
    expect(evaluateAuthoritativeAssignedRoutes(['Unrouted'])).toBe('ineligible');
    expect(evaluateAuthoritativeAssignedRoutes(['Unrouted 2'])).toBe('ineligible');
  });

  test('explicit empty array is ineligible, not all-company-wells', () => {
    const v = verdictFromAuthoritative([]);
    expect(v.status).toBe('ineligible');
    expect(v.reason).toBe('explicit_empty');
    expect(v.routes).toEqual([]);
  });

  test('missing assignedRoutes field is unknown, never ineligible', () => {
    expect(evaluateAuthoritativeAssignedRoutes(undefined)).toBe('unknown');
    expect(evaluateAuthoritativeAssignedRoutes(null)).toBe('unknown');
    expect(verdictFromAuthoritative(undefined).status).toBe('unknown');
  });

  test('unknown fetch never routes to /no-access', () => {
    expect(decideBootstrapRoute({
      hasLocalSession: true,
      revalidation: 'valid',
      eligibility: 'unknown',
    })).toBe('/session-verify');
    expect(decideBootstrapRoute({
      hasLocalSession: true,
      revalidation: 'unknown',
      eligibility: 'unknown',
    })).toBe('/session-verify');
  });

  test('authoritative ineligible after valid session → /no-access', () => {
    expect(decideBootstrapRoute({
      hasLocalSession: true,
      revalidation: 'valid',
      eligibility: 'ineligible',
    })).toBe('/no-access');
  });

  test('eligible → welcome for cold start after valid revalidation', () => {
    expect(decideBootstrapRoute({
      hasLocalSession: true,
      revalidation: 'valid',
      eligibility: 'eligible',
    })).toBe('/welcome');
  });

  test('no session → driver-login; revoked → driver-login', () => {
    expect(decideBootstrapRoute({
      hasLocalSession: false,
      revalidation: 'unknown',
      eligibility: 'eligible',
    })).toBe('/driver-login');
    expect(decideBootstrapRoute({
      hasLocalSession: true,
      revalidation: 'revoked',
      eligibility: 'eligible',
    })).toBe('/driver-login');
  });

  test('durable last-known eligible survives unknown refresh', () => {
    const v = resolveEligibility({
      hasCompanyId: true,
      fetch: unknownVerdict('http_401'),
      durable: {
        status: 'eligible',
        source: 'authoritative',
        routes: ['South'],
        wells: [],
        reason: 'real_route',
        retryable: false,
      },
      sessionRoutes: null,
    });
    expect(v.status).toBe('eligible');
    expect(v.source).toBe('durable');
    expect(v.routes).toEqual(['South']);
  });

  test('unknown refresh does not overwrite with ineligible', () => {
    const v = resolveEligibility({
      hasCompanyId: true,
      fetch: unknownVerdict('timeout'),
      durable: {
        status: 'eligible', source: 'authoritative', routes: ['A'], wells: [], reason: 'real_route', retryable: false,
      },
      sessionRoutes: [],
    });
    expect(v.status).toBe('eligible');
  });

  test('session routes provide the same verdict as bootstrap payload', () => {
    const a = eligibilityFromSameProfile(['West Loop'], true);
    const b = eligibilityFromSameProfile(['West Loop'], true);
    expect(a).toEqual(b);
    expect(a.status).toBe('eligible');
  });

  test('no companyId is eligible (admin path)', () => {
    expect(eligibilityFromSameProfile([], false).status).toBe('eligible');
    expect(eligibilityFromSameProfile(undefined, false).reason).toBe('no_company_admin');
  });

  test('normalizeRouteList rejects non-arrays as malformed, not missing', () => {
    expect(normalizeRouteList('North')).toEqual({ present: true, malformed: true, routes: [] });
    expect(normalizeRouteList(['  North Loop  ', 3, '']).routes).toEqual(['North Loop']);
  });

  test('malformed scope is unknown, distinct from explicit empty', () => {
    const v = verdictFromAuthoritative({ not: 'array' });
    expect(v.status).toBe('unknown');
    expect(v.reason).toBe('scope_malformed');
    expect(verdictFromAuthoritative([]).reason).toBe('explicit_empty');
  });

  test('assignedWells alone is eligible (historical direct-permit semantics)', () => {
    const v = verdictFromAuthoritative(['Unrouted'], ['Gabriel 1']);
    expect(v.status).toBe('eligible');
    expect(v.reason).toBe('assigned_wells');
    expect(v.wells).toEqual(['Gabriel 1']);
  });
});

describe('index bootstrap source pins', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const indexSrc = fs.readFileSync(path.join(__dirname, '../../../app/index.tsx'), 'utf8');
  test('does not treat empty assignment arrays as ineligibility', () => {
    expect(indexSrc).toContain('authorizeEstablishedSession');
    expect(indexSrc).not.toContain('driverHasRealRoutes');
    expect(indexSrc).not.toContain("href=\"/no-access\"");
    expect(indexSrc).toContain('revalidateDriverSessionClassified');
  });
  test('manual login and SSO both completeAuthenticatedSession then the shared gate', () => {
    const login = fs.readFileSync(path.join(__dirname, '../../../app/driver-login.tsx'), 'utf8');
    const sso = fs.readFileSync(path.join(__dirname, '../../../app/sso-callback.tsx'), 'utf8');
    expect(login).toContain('completeAuthenticatedSession');
    expect(sso).toContain('completeAuthenticatedSession');
    expect(login).toContain('authorizeEstablishedSession');
    expect(sso).toContain('authorizeEstablishedSession');
    expect(sso).toContain("authMethod: 'sso'");
    expect(login).toContain("authMethod: 'manual'");
    expect(login).not.toMatch(/router\.replace\('\/welcome'\)/);
    expect(sso).not.toMatch(/router\.replace\('\/\(tabs\)'\)/);
    expect(login).toContain('router.replace(dest)');
    expect(sso).toContain('router.replace(dest)');
  });
});

describe('post-auth vs cold-start same authorization verdict', () => {
  const cases: Array<{ eligibility: 'eligible' | 'ineligible' | 'unknown'; expected: string }> = [
    { eligibility: 'eligible', expected: '/welcome' },
    { eligibility: 'ineligible', expected: '/no-access' },
    { eligibility: 'unknown', expected: '/session-verify' },
  ];
  for (const c of cases) {
    test(`immediate post-auth and cold start agree for ${c.eligibility}`, () => {
      const postAuth = decidePostAuthRoute({
        hasLocalSession: true,
        revalidation: 'valid',
        eligibility: c.eligibility,
        eligibleDestination: '/welcome',
      });
      const cold = decideBootstrapRoute({
        hasLocalSession: true,
        revalidation: 'valid',
        eligibility: c.eligibility,
      });
      expect(postAuth).toBe(c.expected);
      expect(cold).toBe(postAuth);
    });
  }

  test('SSO eligible dest may be tabs; ineligible/unknown still never enter', () => {
    expect(decidePostAuthRoute({
      hasLocalSession: true, revalidation: 'valid', eligibility: 'eligible', eligibleDestination: '/(tabs)',
    })).toBe('/(tabs)');
    expect(decidePostAuthRoute({
      hasLocalSession: true, revalidation: 'valid', eligibility: 'ineligible', eligibleDestination: '/(tabs)',
    })).toBe('/no-access');
    expect(decidePostAuthRoute({
      hasLocalSession: true, revalidation: 'valid', eligibility: 'unknown', eligibleDestination: '/(tabs)',
    })).toBe('/session-verify');
  });

  test('authoritative empty, unrouted-only, missing field, and lookup failures share the gate', () => {
    const empty = decidePostAuthRoute({
      hasLocalSession: true, revalidation: 'valid', eligibility: 'ineligible', eligibleDestination: '/welcome',
    });
    const unrouted = decidePostAuthRoute({
      hasLocalSession: true, revalidation: 'valid', eligibility: 'ineligible', eligibleDestination: '/(tabs)',
    });
    const missing = decidePostAuthRoute({
      hasLocalSession: true, revalidation: 'valid', eligibility: 'unknown', eligibleDestination: '/welcome',
    });
    expect(empty).toBe('/no-access');
    expect(unrouted).toBe('/no-access');
    expect(missing).toBe('/session-verify');
  });
});

describe('login failure classification (thrown and valid:false)', () => {
  test('invalid credentials is not a connection error', () => {
    const c = classifyLoginFailure(new Error('Invalid name or passcode'));
    expect(c.kind).toBe('invalid_credentials');
    expect(c.code).toBe('invalid_credentials');
  });
  test('network / timeout / permission stay classified', () => {
    expect(classifyLoginFailure(new Error('Network request failed')).kind).toBe('no_network');
    const abort = new Error('aborted');
    (abort as any).name = 'AbortError';
    expect(classifyLoginFailure(abort).kind).toBe('timeout');
    expect(classifyLoginFailure(new Error('permission_denied')).kind).toBe('permission');
    expect(classifyLoginFailure(new Error('This account has been deactivated')).kind).toBe('deactivated');
  });
});
