import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { AppState } from 'react-native';
import { getFirebaseAuth, subscribeAuthReady } from './firebaseAuthSession';
import { getSessionGeneration } from './wbmSessionFence';
import { onConnectivityChange } from './packetQueue';

export type TankConfig = Record<string, string | number | undefined>;
export type TankInfo = { ok: true; wellName: string; config: TankConfig; canEdit: boolean;
  canAssignPrimary: boolean; primaryDrivers: { id: string; name: string; allRoutes: boolean }[] };
export type TankEdit = { id: string; wellName: string; revision: number; patch: TankConfig;
  state: 'pending' | 'blocked' | 'superseded'; error?: string };
type Scope = { key: string; generation: number; user: NonNullable<ReturnType<typeof getFirebaseAuth>['currentUser']> };
let tail: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn); tail = run.catch(() => {}); return run;
}
async function scope(): Promise<Scope> {
  const generation = getSessionGeneration(), user = getFirebaseAuth().currentUser;
  const [driver, company, uid] = await Promise.all(['driverId', 'companyId', 'wb_auth_uid'].map(k => SecureStore.getItemAsync(k)));
  if (!user || !driver || uid !== user.uid || generation !== getSessionGeneration()
    || getFirebaseAuth().currentUser !== user) throw Error('tank_info_session_changed');
  return { user, generation, key: JSON.stringify([uid, company || '', driver]) };
}
function current(s: Scope) { return s.generation === getSessionGeneration() && getFirebaseAuth().currentUser === s.user; }
function assertCurrent(s: Scope) { if (!current(s)) throw Error('tank_info_session_changed'); }
const queueKey = (s: Scope) => '@wbm_tank_edits_v1:' + s.key;
const cacheKey = (s: Scope, well: string) => '@wbm_tank_info_v1:' + s.key + ':' + well;
async function queue(s: Scope): Promise<TankEdit[]> {
  const raw = await AsyncStorage.getItem(queueKey(s));
  const value = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(value)) throw Error('tank_info_queue_unreadable');
  return value;
}
async function call<T>(s: Scope, name: string, data: Record<string, unknown>): Promise<T> {
  assertCurrent(s);
  const token = await s.user.getIdToken(); assertCurrent(s);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://us-central1-wellbuilt-sync.cloudfunctions.net/' + name, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ data }),
    });
    const body = await response.json(); assertCurrent(s);
    if (!response.ok || body.error) {
      const error = Object.assign(Error(body.error?.message || 'tank_info_unavailable'), { status: body.error?.status });
      throw error;
    }
    return body.result;
  } finally { clearTimeout(timer); }
}
function validInfo(value: TankInfo, well: string): boolean {
  return value?.ok === true && value.wellName === well && !!value.config
    && typeof value.canEdit === 'boolean' && typeof value.canAssignPrimary === 'boolean'
    && Array.isArray(value.primaryDrivers);
}
export async function readTankInfo(well: string): Promise<TankInfo | null> {
  const s = await scope();
  const raw = await AsyncStorage.getItem(cacheKey(s, well)); assertCurrent(s);
  let info: TankInfo | null;
  try { info = raw ? JSON.parse(raw) : null; } catch { return null; }
  return info && validInfo(info, well) ? info : null;
}
export async function refreshTankInfo(well: string): Promise<TankInfo> {
  const s = await scope();
  const info = await call<TankInfo>(s, 'getWbmTankInfo', { wellName: well });
  if (!validInfo(info, well)) throw Error('tank_info_invalid_response');
  assertCurrent(s); await AsyncStorage.setItem(cacheKey(s, well), JSON.stringify(info)); assertCurrent(s);
  return info;
}
export async function pendingTankInfo(well: string): Promise<TankEdit | undefined> {
  const s = await scope(); const rows = await serial(() => queue(s)); assertCurrent(s);
  return rows.find(row => row.wellName === well && row.state !== 'superseded');
}
export async function saveTankInfo(well: string, revision: number, patch: TankConfig, replacesBlockedId?: string): Promise<void> {
  const s = await scope();
  await serial(async () => {
    assertCurrent(s);
    const rows = await queue(s); assertCurrent(s);
    const existing = rows.find(row => row.wellName === well && row.state !== 'superseded');
    if (existing) {
      if (existing.state !== 'blocked' || existing.id !== replacesBlockedId) throw Error('tank_info_already_pending');
      existing.state = 'superseded'; // Explicitly reviewed server refusal; retain its payload for audit.
    }
    rows.push({ id: Crypto.randomUUID(), wellName: well, revision, patch, state: 'pending' });
    await AsyncStorage.setItem(queueKey(s), JSON.stringify(rows)); assertCurrent(s);
  });
  await flushTankInfo();
}
const flights = new Map<string, Promise<void>>();
export async function flushTankInfo(): Promise<void> {
  let s: Scope; try { s = await scope(); } catch { return; }
  const key = s.key + ':' + s.generation;
  const pending = flights.get(key); if (pending) return pending;
  const flight = (async () => {
    const rows = await serial(() => queue(s));
    for (const row of rows) {
      if (!current(s)) return;
      if (row.state !== 'pending') continue;
      try {
        const result = await call<TankInfo & { operationId: string }>(s, 'saveWbmTankInfo', {
          wellName: row.wellName, operationId: row.id, expectedRevision: row.revision, patch: row.patch,
        });
        if (!validInfo(result, row.wellName) || result.operationId !== row.id
          || Number(result.config.tankInfoRevision) <= row.revision) throw Error('tank_info_missing_ack');
        await serial(async () => {
          assertCurrent(s);
          await AsyncStorage.setItem(cacheKey(s, row.wellName), JSON.stringify(result)); assertCurrent(s);
          const latest = await queue(s); assertCurrent(s);
          await AsyncStorage.setItem(queueKey(s), JSON.stringify(latest.filter(op => op.id !== row.id)));
        });
      } catch (error) {
        if (!current(s)) return;
        const e = error as Error & { status?: string };
        if (['PERMISSION_DENIED', 'INVALID_ARGUMENT', 'ABORTED', 'NOT_FOUND', 'FAILED_PRECONDITION'].includes(e.status || '')) {
          await serial(async () => {
            const latest = await queue(s); assertCurrent(s);
            const op = latest.find(op => op.id === row.id);
            if (op) { op.state = 'blocked'; op.error = e.status; }
            await AsyncStorage.setItem(queueKey(s), JSON.stringify(latest));
          });
        }
        // All failures, including lost acknowledgement, preserve the same operation.
      }
    }
  })();
  flights.set(key, flight);
  try { await flight; } finally { if (flights.get(key) === flight) flights.delete(key); }
}
export function startTankInfoDelivery(): () => void {
  const kick = () => { void flushTankInfo().catch(() => {}); };
  const offNetwork = onConnectivityChange(online => { if (online) kick(); });
  const offAuth = subscribeAuthReady(kick);
  const app = AppState.addEventListener('change', state => { if (state === 'active') kick(); });
  const timer = setInterval(() => { if (AppState.currentState === 'active') kick(); }, 30_000);
  kick();
  return () => { offNetwork(); offAuth(); app.remove(); clearInterval(timer); };
}
