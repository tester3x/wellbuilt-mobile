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
  /** Server-authoritative forced-passcode-change flag for the established session. */
  mustChangePasscode?: boolean;
}): Promise<BootstrapRoute> {
  if (opts.revalidation === 'revoked') return '/driver-login';
  // Enforce forced change before doing any eligibility work; a temporary
  // passcode must never reach welcome/tabs regardless of route eligibility.
  if (opts.mustChangePasscode === true) return '/passcode-change';
  const eligibility = await resolveCurrentEligibility();
  return decidePostAuthRoute({
    hasLocalSession: true,
    revalidation: opts.revalidation,
    eligibility: eligibility.status,
    eligibleDestination: opts.eligibleDestination,
    mustChangePasscode: opts.mustChangePasscode,
  });
}
