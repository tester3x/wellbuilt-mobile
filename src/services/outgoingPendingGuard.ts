/**
 * Exact packet-identity guard for outgoing responses vs a pending pull.
 * Date/well/BBL fuzzy matching is intentionally not used.
 */

export type PendingPullIdentity = {
  wellName?: string;
  packetId?: string;
};

export type OutgoingResponseIdentity = {
  wellName?: string;
  lastPullPacketId?: string;
};

export function shouldApplyOutgoingResponse(
  pending: PendingPullIdentity | null | undefined,
  packet: OutgoingResponseIdentity | null | undefined,
): boolean {
  if (!pending) return true;
  const pendingId = typeof pending.packetId === 'string' ? pending.packetId : '';
  const responseId = typeof packet?.lastPullPacketId === 'string' ? packet.lastPullPacketId : '';
  if (!pendingId || !responseId) return false;
  return pendingId === responseId;
}
