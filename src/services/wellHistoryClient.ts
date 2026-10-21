import { getValidIdToken } from './firebaseAuthSession';
import type { WellHistoryRead } from './wellHistoryRead';

const ENDPOINT = 'https://us-central1-wellbuilt-sync.cloudfunctions.net/getDriverWellHistory';

/** The server derives company/driver/assignment from SDK claims. Keep every
 * original packet key and field: chronology/edit derivation happens unchanged. */
export async function fetchWellHistoryPackets(wellName: string, read: WellHistoryRead): Promise<Record<string, any>> {
  const token = await read.wait(() => getValidIdToken());
  const response = await read.wait(() => fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: { wellName } }),
    signal: read.signal,
  }));
  const body = await read.wait(() => response.json().catch(() => ({})));
  if (!response.ok || body?.error) {
    const error = new Error(body?.error?.message || `Well history request failed (${response.status})`);
    (error as Error & { callableStatus?: string }).callableStatus = typeof body?.error?.status === 'string' ? body.error.status : undefined;
    (error as Error & { httpStatus?: number }).httpStatus = response.status;
    throw error;
  }
  const result = body?.result;
  const packets = result?.packets;
  if (result?.ok !== true || result.wellName !== wellName || !packets || typeof packets !== 'object' || Array.isArray(packets)
    || Object.values(packets).some(packet => !packet || typeof packet !== 'object' || Array.isArray(packet) || (packet as any).wellName !== wellName)) {
    throw new Error('Well history response could not be verified. Refresh to retry.');
  }
  return packets;
}
