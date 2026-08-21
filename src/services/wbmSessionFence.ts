/**
 * In-memory generation fence so a delayed Driver A bootstrap cannot land
 * after Driver B (or logout) has taken the session.
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

let generation = 0;

export function getSessionGeneration(): number {
  return generation;
}

export function bumpSessionGeneration(): number {
  generation += 1;
  return generation;
}

export function resetSessionGenerationForTests(): void {
  generation = 0;
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
