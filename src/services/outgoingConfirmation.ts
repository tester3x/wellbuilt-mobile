/**
 * Bounded, nonblocking confirmation of an accepted pull against
 * getDriverOutgoingStatus. Stops on exact lastPullPacketId match.
 *
 * Delays: 1s, 2s, 4s, 8s, then one final attempt. Never polls indefinitely.
 */
import { shouldApplyOutgoingResponse } from './outgoingPendingGuard';

export const OUTGOING_CONFIRMATION_DELAYS_MS = [1000, 2000, 4000, 8000] as const;

export type ConfirmationResult = 'confirmed' | 'timed_out';

export type OutgoingStatusLike = {
  responses: Array<{ wellName: string; lastPullPacketId?: string } & Record<string, unknown>>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function confirmOutgoingForPacket(opts: {
  wellName: string;
  packetId: string;
  delaysMs?: readonly number[];
  fetchStatus?: () => Promise<OutgoingStatusLike | null>;
  sleep?: (ms: number) => Promise<void>;
  applyResponse?: (packet: OutgoingStatusLike['responses'][number]) => Promise<void>;
}): Promise<ConfirmationResult> {
  const wellName = opts.wellName;
  const packetId = opts.packetId;
  if (!wellName || !packetId) return 'timed_out';

  const delays = opts.delaysMs ?? OUTGOING_CONFIRMATION_DELAYS_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const fetchStatus = opts.fetchStatus ?? (async () => {
    const { fetchDriverOutgoingStatus } = await import('./firebase');
    return fetchDriverOutgoingStatus();
  });
  const applyResponse = opts.applyResponse ?? (async (packet) => {
    const { processResponsePacket } = await import('./backgroundSync');
    await processResponsePacket(packet as Parameters<typeof processResponsePacket>[0]);
  });

  const tryOnce = async (): Promise<boolean> => {
    const status = await fetchStatus();
    if (!status || !Array.isArray(status.responses)) return false;
    const match = status.responses.find((row) => row && row.wellName === wellName);
    if (!match) return false;
    if (!shouldApplyOutgoingResponse({ packetId, wellName }, match)) return false;
    await applyResponse(match);
    return true;
  };

  for (const delay of delays) {
    await sleep(delay);
    if (await tryOnce()) return 'confirmed';
  }
  if (await tryOnce()) return 'confirmed';
  return 'timed_out';
}

/** Fire-and-forget wrapper for the record/queue success path. */
export function startOutgoingConfirmation(wellName: string, packetId: string): void {
  if (!wellName || !packetId) return;
  void confirmOutgoingForPacket({ wellName, packetId }).catch((err) => {
    console.log('[OutgoingConfirmation] bounded loop ended without confirm', wellName, packetId, err);
  });
}
