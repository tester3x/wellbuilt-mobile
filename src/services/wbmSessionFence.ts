/**
 * In-memory generation fence so a delayed Driver A bootstrap cannot land
 * after Driver B (or logout) has taken the session.
 *
 * Session sign-in and sign-out/cleanup serialize on one transition gate.
 * Envelope durable cache ops serialize on a separate cache-operation gate.
 */
export type BootstrapTicket = {
  generation: number;
  driverId: string | null;
  companyId: string;
};

export type BootstrapIdentity = {
  driverId: string | null;
  companyId: string | null;
};

export type SessionLogoutPermit = {
  generation: number;
  driverId: string;
  companyId: string;
  authMethod: string;
  driverVerifiedAt: string;
  authUid: string;
};

let generation = 0;
let catalogClear: (() => void) | null = null;
let sessionTail: Promise<void> = Promise.resolve();
let envelopeTail: Promise<void> = Promise.resolve();
let envelopeRemovePause: (() => Promise<void>) | null = null;

export function getSessionGeneration(): number {
  return generation;
}

export function bumpSessionGeneration(): number {
  generation += 1;
  return generation;
}

export function registerWbmCatalogClear(fn: () => void): void {
  catalogClear = fn;
}

/** Claim the session: bump generation and drop in-memory wells/eligibility. */
export function claimSessionGeneration(): number {
  generation += 1;
  catalogClear?.();
  return generation;
}

export function resetSessionGenerationForTests(): void {
  generation = 0;
  sessionTail = Promise.resolve();
  envelopeTail = Promise.resolve();
  envelopeRemovePause = null;
}

export function setEnvelopeRemovePauseForTests(fn: (() => Promise<void>) | null): void {
  envelopeRemovePause = fn;
}

export async function runEnvelopeRemovePauseForTests(): Promise<void> {
  if (envelopeRemovePause) await envelopeRemovePause();
}

export function runSessionTransition<T>(fn: () => Promise<T>): Promise<T> {
  const run = sessionTail.then(fn, fn);
  sessionTail = run.then(() => undefined, () => undefined);
  return run;
}

export function runEnvelopeOp<T>(fn: () => Promise<T>): Promise<T> {
  const run = envelopeTail.then(fn, fn);
  envelopeTail = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Login must claim generation BEFORE signInWithCustomToken mutates Firebase Auth.
 */
export async function beginLoginTransition<T>(op: () => Promise<T>): Promise<T> {
  return runSessionTransition(async () => {
    claimSessionGeneration();
    return op();
  });
}

export function captureBootstrapTicket(identity: BootstrapIdentity): BootstrapTicket {
  return {
    generation,
    driverId: identity.driverId,
    companyId: identity.companyId || '',
  };
}

export function sessionFenceHolds(input: {
  ticket: BootstrapTicket;
  current: BootstrapIdentity;
  hasAuthSession: boolean;
  snapshot?: { driverId: string; companyId: string };
}): boolean {
  if (!input.hasAuthSession) return false;
  if (input.ticket.generation !== generation) return false;
  if (!input.current.driverId) return false;
  if (input.ticket.driverId !== input.current.driverId) return false;
  if (input.ticket.companyId !== (input.current.companyId || '')) return false;
  if (input.snapshot) {
    if (input.snapshot.driverId !== input.current.driverId) return false;
    if (input.snapshot.companyId !== (input.current.companyId || '')) return false;
  }
  return true;
}

export function bootstrapResponseAdmissible(input: {
  ticket: BootstrapTicket;
  snapshot: { driverId: string; companyId: string };
  current: BootstrapIdentity;
  hasAuthSession: boolean;
}): boolean {
  return sessionFenceHolds({
    ticket: input.ticket,
    current: input.current,
    hasAuthSession: input.hasAuthSession,
    snapshot: input.snapshot,
  });
}

export function permitGenerationCurrent(permit: SessionLogoutPermit): boolean {
  return permit.generation === generation
    && !!permit.driverId
    && !!permit.authUid
    && !!permit.driverVerifiedAt;
}
