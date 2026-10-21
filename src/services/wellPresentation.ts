import * as SecureStore from 'expo-secure-store';
import { getFirebaseAuth } from './firebaseAuthSession';
import { getSessionGeneration } from './wbmSessionFence';
import { loadWellConfig, readFencedDurableEnvelope } from './wellConfig';
import type { WbmBootstrapEnvelope } from './wbmBootstrapCache';

/** Display data only. Operations continue to use the existing server-authorized
 * bootstrap/dispatch APIs. No unscoped legacy catalog or empty assignment grants access. */
export interface WellPresentation {
  envelope: WbmBootstrapEnvelope;
  isCurrent(): boolean;
}
type Scope = {
  driverId: string; companyId: string; uid: string; generation: number;
  user: NonNullable<ReturnType<typeof getFirebaseAuth>['currentUser']>;
};
const flights = new Map<string, { user: Scope['user']; promise: Promise<WellPresentation | null> }>();
const refreshedAt = new Map<string, number>();
const REFRESH_INTERVAL_MS = 60_000;
function current(scope: Scope): boolean {
  return getSessionGeneration() === scope.generation && getFirebaseAuth().currentUser === scope.user;
}
function key(scope: Scope): string { return JSON.stringify([scope.generation, scope.uid, scope.driverId, scope.companyId]); }
async function capture(): Promise<Scope | null> {
  const generation = getSessionGeneration(), user = getFirebaseAuth().currentUser;
  if (!user) return null;
  const [driverId, companyId, uid] = await Promise.all([
    SecureStore.getItemAsync('driverId'), SecureStore.getItemAsync('companyId'), SecureStore.getItemAsync('authUid'),
  ]);
  if (!driverId || companyId === null || uid !== user.uid) return null;
  const scope = { driverId, companyId, uid, generation, user };
  return current(scope) ? scope : null;
}
async function read(scope: Scope): Promise<WellPresentation | null> {
  const envelope = await readFencedDurableEnvelope();
  if (!current(scope) || !envelope || envelope.driverId !== scope.driverId || envelope.companyId !== scope.companyId
    || envelope.eligibility.status === 'unknown') return null;
  return { envelope, isCurrent: () => current(scope) };
}
function refresh(scope: Scope): Promise<WellPresentation | null> {
  const id = key(scope), pending = flights.get(id);
  if (pending?.user === scope.user) return pending.promise;
  const flight = { user: scope.user, promise: Promise.resolve<WellPresentation | null>(null) };
  flight.promise = (async () => {
    try {
      if (!current(scope)) return null;
      // Server-first behavior is retained for explicit refresh and cold cache.
      await loadWellConfig(true);
      return await read(scope);
    } finally {
      if (flights.get(id) === flight) flights.delete(id);
    }
  })();
  flights.set(id, flight);
  return flight.promise;
}
export async function loadWellPresentation(forceRefresh = false): Promise<WellPresentation | null> {
  const scope = await capture();
  if (!scope) return null;
  if (!forceRefresh) {
    const cached = await read(scope);
    if (cached) {
      const id = key(scope), now = Date.now(), last = refreshedAt.get(id);
      if (last === undefined || now < last || now - last >= REFRESH_INTERVAL_MS) {
        refreshedAt.set(id, now);
        void refresh(scope).catch(() => {});
      }
      return current(scope) ? cached : null;
    }
  }
  return refresh(scope);
}
