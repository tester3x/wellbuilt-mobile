import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirebaseAuth } from './firebaseAuthSession';
import { loadWellPresentation } from './wellPresentation';
import { getSessionGeneration } from './wbmSessionFence';
import { requestWellHistory, type WellHistoryResponse } from './firebase';

type HistoryView = {
  response: WellHistoryResponse | null;
  source: 'saved' | 'server';
  refresh: Promise<WellHistoryResponse | null> | null;
  isCurrent(): boolean;
};
const flights = new Map<string, { user: NonNullable<ReturnType<typeof getFirebaseAuth>['currentUser']>; promise: Promise<WellHistoryResponse | null> }>();
const refreshedAt = new Map<string, number>();
const MAX_CACHE_AGE_MS = 30 * 86400000;
function validResponse(value: unknown, wellName: string): value is WellHistoryResponse {
  const r = value as WellHistoryResponse | null;
  return !!r && r.status === 'success' && r.wellName === wellName && Array.isArray(r.rows) && r.rows.length <= 50
    && r.rows.every(row => !!row && typeof row === 'object'
      && typeof row.dateTime === 'string' && typeof row.topLevel === 'string' && typeof row.bbls === 'string')
    && Number.isInteger(r.rowCount) && r.rowCount >= 0 && Number.isInteger(r.totalRows) && r.totalRows >= 0
    && typeof r.timestamp === 'string' && typeof r.timestampUTC === 'string';
}
/** A cache of an exact authenticated read, never generated rows or write authority.
 * Assignment revision, owner and literal well identity all participate in its key. */
export async function loadWellHistoryPresentation(wellName: string, forceRefresh = false): Promise<HistoryView | null> {
  const view = await loadWellPresentation();
  const user = getFirebaseAuth().currentUser;
  if (!view || !user || !view.isCurrent()) return null;
  const { driverId, companyId, assignmentRevision, assignmentDigest } = view.envelope;
  const owner = [user.uid, driverId, companyId, assignmentRevision, assignmentDigest, wellName, 50];
  const key = '@wbm/well-history-view/v1/' + encodeURIComponent(JSON.stringify(owner));
  const flightKey = JSON.stringify([getSessionGeneration(), key]);
  const current = () => view.isCurrent() && getFirebaseAuth().currentUser === user;
  let cached: WellHistoryResponse | null = null;
  try {
    const saved = JSON.parse(await AsyncStorage.getItem(key) || 'null');
    if (saved?.version === 1 && JSON.stringify(saved.owner) === JSON.stringify(owner)
      && Number.isFinite(saved.savedAtMs) && saved.savedAtMs <= Date.now() && Date.now() - saved.savedAtMs <= MAX_CACHE_AGE_MS
      && validResponse(saved.response, wellName)) cached = saved.response;
  } catch { /* A missing/corrupt presentation falls back to the authenticated read. */ }
  if (!current()) return null;
  const fetch = (): Promise<WellHistoryResponse | null> => {
    const pending = flights.get(flightKey);
    if (pending?.user === user) return pending.promise;
    const flight = { user, promise: Promise.resolve<WellHistoryResponse | null>(null) };
    flight.promise = (async () => {
      try {
        if (!current()) return null;
        const response = await requestWellHistory(wellName, 50);
        if (!current() || response?.status === 'success' && !validResponse(response, wellName)) return null;
        if (validResponse(response, wellName)) {
          const raw = JSON.stringify({ version: 1, owner, savedAtMs: Date.now(), response });
          if (raw.length <= 400_000) {
            try { await AsyncStorage.setItem(key, raw); } catch { /* Fresh data may display even if its cache cannot save. */ }
          }
        }
        return current() ? response : null;
      } finally {
        if (flights.get(flightKey) === flight) flights.delete(flightKey);
      }
    })();
    flights.set(flightKey, flight); refreshedAt.set(key, Date.now());
    return flight.promise;
  };
  if (!forceRefresh && cached) {
    const last = refreshedAt.get(key), now = Date.now();
    const pending = flights.get(flightKey);
    const refresh = last === undefined || now < last || now - last >= 30_000
      ? fetch() : pending?.user === user ? pending.promise : null;
    // An unmounted screen may ignore refresh; its failure is still handled.
    if (refresh) void refresh.catch(() => {});
    return { response: cached, source: 'saved', refresh, isCurrent: current };
  }
  const response = await fetch();
  return current() ? { response, source: 'server', refresh: null, isCurrent: current } : null;
}
