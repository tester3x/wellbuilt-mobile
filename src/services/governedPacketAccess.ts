/**
 * Central WB-M Production Water packet-access API on the current release line.
 * Flag OFF: no resolver, no spinner, existing 7d87f17 well-pull path.
 * Flag ON: Dashboard jobId only — never wellName substitution.
 */
import { getDriverSession } from './driverAuth';
import { isGovernedPacketAccessEnabled } from './governedPacketAccessFlag';
import {
  restoreGovernedExecutionBinding,
  runGovernedExecutionBinding,
  governedUiKind,
  type GovernedReadyResult,
} from './governedPacketAccessRuntime';
import {
  invalidatePersistedExecutionBinding,
  loadPersistedExecutionBinding,
  persistExecutionBinding,
} from './governedPacketAccessStore';
import { secureResolveExecutionBinding } from './secureOperationalApi';
import type { GovernedSurface } from './governedPacketAccessCore';

export type { GovernedReadyResult } from './governedPacketAccessRuntime';
export { governedUiKind, isGovernedPacketAccessEnabled };
export { GOVERNED_ACCESS_MAP } from './governedPacketAccessCore';
export { GOVERNED_PACKET_ACCESS } from './governedPacketAccessFlag';
export {
  governedRecordReceivingHref,
  readGovernedJobIdFromHref,
  readGovernedJobIdFromRecordParams,
} from './governedJobIdIngress';

async function readSessionIdentity(): Promise<{ companyId: string; driverId: string } | null> {
  const session = await getDriverSession();
  const driverId = session?.driverId ? String(session.driverId).trim() : '';
  const companyId = session?.companyId ? String(session.companyId).trim() : '';
  if (!driverId || !companyId) return null;
  return { companyId, driverId };
}

async function connectivityStatus(): Promise<string> {
  try {
    const NetInfo = require('@react-native-community/netinfo').default;
    const s = await NetInfo.fetch();
    if (s && s.isConnected === false) return 'offline';
    return 'reachable';
  } catch {
    return 'reachable';
  }
}

export async function ensureGovernedProductionWaterAccess(input: {
  jobId: string;
  surface: GovernedSurface;
  jobType?: unknown;
  connectivityStatus?: string;
  queryWellName?: string;
}): Promise<GovernedReadyResult> {
  const queryWellName = typeof input.queryWellName === 'string' ? input.queryWellName.trim() : '';
  return runGovernedExecutionBinding({
    governed: isGovernedPacketAccessEnabled(),
    jobId: input.jobId,
    session: await readSessionIdentity(),
    connectivityStatus: input.connectivityStatus || await connectivityStatus(),
    resolve: (request) => secureResolveExecutionBinding(request),
    loadCached: (id, session) => loadPersistedExecutionBinding({ jobId: id, session }),
    persist: persistExecutionBinding,
    invalidate: invalidatePersistedExecutionBinding,
    surface: input.surface,
    jobType: input.jobType,
    localIdentity: queryWellName ? { wellName: queryWellName } : undefined,
  });
}

export async function restoreGovernedProductionWaterAccess(input: {
  jobId: string;
  surface?: GovernedSurface;
}): Promise<GovernedReadyResult> {
  return restoreGovernedExecutionBinding({
    governed: isGovernedPacketAccessEnabled(),
    jobId: input.jobId,
    session: await readSessionIdentity(),
    loadCached: (id, session) => loadPersistedExecutionBinding({ jobId: id, session }),
    surface: input.surface,
  });
}

/** Tank-carousel Pull. Never treats wellName as jobId. */
export async function beginGovernedProductionWaterPull(input: {
  jobId: string;
}): Promise<GovernedReadyResult> {
  return ensureGovernedProductionWaterAccess({ jobId: input.jobId, surface: 'open' });
}

export async function authorizeGovernedPullSubmit(jobId: string): Promise<GovernedReadyResult> {
  return ensureGovernedProductionWaterAccess({ jobId, surface: 'pull' });
}
