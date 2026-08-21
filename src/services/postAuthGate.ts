/**
 * Single post-auth authorization used by manual login, SSO, and cold start.
 * Callers must router.replace() ONLY the returned route — never welcome/tabs
 * before this verdict.
 */
import { decidePostAuthRoute, type BootstrapRoute, type EligibleDestination } from './eligibility';
import { resolveCurrentEligibility } from './wellConfig';

export async function authorizeEstablishedSession(opts: {
  eligibleDestination: EligibleDestination;
  revalidation: 'valid' | 'revoked' | 'unknown';
}): Promise<BootstrapRoute> {
  if (opts.revalidation === 'revoked') return '/driver-login';
  const eligibility = await resolveCurrentEligibility();
  return decidePostAuthRoute({
    hasLocalSession: true,
    revalidation: opts.revalidation,
    eligibility: eligibility.status,
    eligibleDestination: opts.eligibleDestination,
  });
}
