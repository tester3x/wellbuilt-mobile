/** Fresh-water tank deliveries have their own durable queue and never enter PW pull history. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authorizedCallable } from './firebaseAuthSession';
import { getDriverSession } from './driverAuth';

const QUEUE_KEY = '@wellbuilt_fresh_water_deliveries_v1';
export type FreshWaterDeliveryDraft = {
  deliveryId: string;
  groupId?: string;
  wellName?: string; // Older queued entries are retained for review, never silently reassigned.
  deliveredAtUTC: string;
  deliveredBbl: number;
  measuredBeforeFeet?: number;
  driverId: string;
  companyId: string;
  error?: string;
};
export type FreshWaterSupply = {
  ok: true;
  groupId: string;
  routeName: string;
  name: string;
  wellNames: string[];
  config: { enabled: true; tankCount: number; tankHeightFeet: number; bblPerFootPerTank: number;
    equalization: 'single-tank' | 'verified-equalized' | 'unverified'; dailyUseBbl: number | null };
  status: null | { levelFeet: number; projectedFeet: number | null; asOfUTC: string; dailyUseBbl: number | null;
    lastMeasuredFeet: number | null; lastMeasuredAtUTC: string | null };
};
export type FreshWaterTankGroup = { groupId: string; routeName: string; name: string; wellNames: string[];
  config: FreshWaterSupply['config'] };

let queueOperation: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const task = queueOperation.then(fn, fn);
  queueOperation = task.catch(() => undefined);
  return task;
}
async function readQueue(): Promise<FreshWaterDeliveryDraft[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Fresh water queue needs recovery');
  return parsed;
}
async function writeQueue(queue: FreshWaterDeliveryDraft[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function listFreshWaterTankGroups() {
  return authorizedCallable<{ ok: true; groups: FreshWaterTankGroup[] }>('getWbmFreshWaterTankGroups', {});
}
export async function getFreshWaterSupply(groupId: string) {
  return authorizedCallable<FreshWaterSupply>('getWbmFreshWaterTankGroups', { groupId });
}

export async function pendingFreshWaterDeliveries(): Promise<FreshWaterDeliveryDraft[]> {
  const session = await getDriverSession();
  if (!session?.driverId || !session.companyId) return [];
  return (await readQueue()).filter(x => x.driverId === session.driverId && x.companyId === session.companyId);
}

export async function queueFreshWaterDelivery(input: {
  groupId: string; deliveredBbl: number; measuredBeforeFeet?: number;
}): Promise<FreshWaterDeliveryDraft> {
  const session = await getDriverSession();
  if (!session?.driverId || !session.companyId || session.isViewer) throw new Error('Driver session required');
  const entry: FreshWaterDeliveryDraft = {
    deliveryId: `fw_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
    groupId: input.groupId,
    deliveredAtUTC: new Date().toISOString(),
    deliveredBbl: input.deliveredBbl,
    ...(input.measuredBeforeFeet === undefined ? {} : { measuredBeforeFeet: input.measuredBeforeFeet }),
    driverId: session.driverId,
    companyId: session.companyId,
  };
  await serialized(async () => {
    const queue = await readQueue();
    queue.push(entry);
    await writeQueue(queue);
  });
  return entry;
}

/** Retries preserve the original delivery ID. Wrong-account or refused loads stay visible for review. */
export async function flushFreshWaterDeliveries(): Promise<{ sent: number; pending: number }> {
  return serialized(async () => {
    const session = await getDriverSession();
    const queue = await readQueue();
    if (!session?.driverId || !session.companyId) return { sent: 0, pending: queue.length };
    let sent = 0;
    const kept: FreshWaterDeliveryDraft[] = [];
    for (const entry of queue) {
      if (entry.driverId !== session.driverId || entry.companyId !== session.companyId || entry.error) {
        kept.push(entry);
        continue;
      }
      if (!entry.groupId) {
        kept.push({ ...entry, error: 'Older delivery needs review: no tank group was recorded.' });
        continue;
      }
      try {
        const { ok } = await authorizedCallable<{ ok: boolean }>('ingestWbmFreshWaterGroupDelivery', {
          groupId: entry.groupId,
          deliveryId: entry.deliveryId,
          deliveredAtUTC: entry.deliveredAtUTC,
          deliveredBbl: entry.deliveredBbl,
          ...(entry.measuredBeforeFeet === undefined ? {} : { measuredBeforeFeet: entry.measuredBeforeFeet }),
        });
        if (!ok) throw new Error('Delivery not confirmed');
        sent++;
      } catch (error) {
        const status = (error as { callableStatus?: string }).callableStatus?.toUpperCase();
        const permanent = status === 'INVALID_ARGUMENT' || status === 'FAILED_PRECONDITION' || status === 'PERMISSION_DENIED';
        kept.push({ ...entry, ...(permanent ? { error: error instanceof Error ? error.message : String(error) } : {}) });
      }
    }
    await writeQueue(kept);
    return { sent, pending: kept.filter(x => x.driverId === session.driverId && x.companyId === session.companyId).length };
  });
}
