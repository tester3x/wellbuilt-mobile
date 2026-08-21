/**
 * Single post-auth authorization used by manual login, SSO, and cold start.
 * Callers must router.replace() ONLY decision.route — never welcome/tabs
 * before this verdict.
 */
import {
  decidePostAuthRoute,
  unknownVerdict,
  type BootstrapRoute,
  type EligibleDestination,
  type EligibilityVerdict,
} from './eligibility';
import { resolveCurrentEligibility } from './wellConfig';

export interface PostAuthDecision {
  route: BootstrapRoute;
  eligibility: EligibilityVerdict;
}

export async function authorizeEstablishedSession(opts: {
  eligibleDestination: EligibleDestination;
  revalidation: 'valid' | 'revoked' | 'unknown';
}): Promise<PostAuthDecision> {
  if (opts.revalidation === 'revoked') {
    return {
      route: '/driver-login',
      eligibility: unknownVerdict('session_revoked', false),
    };
  }
  const eligibility = await resolveCurrentEligibility();
  return {
    route: decidePostAuthRoute({
      hasLocalSession: true,
      revalidation: opts.revalidation,
      eligibility: eligibility.status,
      eligibleDestination: opts.eligibleDestination,
    }),
    eligibility,
  };
}
