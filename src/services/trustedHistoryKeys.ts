/**
 * Trusted historical-pull matching. New pulls use the canonical UUID.
 * Historical pulls keyed by the server-controlled bound approved key remain
 * visible. Clients never supply an extra alias.
 */

export function normalizeTrustedHistoryIds(
  canonicalDriverId: string | null | undefined,
  serverIds?: unknown,
): string[] {
  const ids: string[] = [];
  if (typeof canonicalDriverId === 'string' && canonicalDriverId) ids.push(canonicalDriverId);
  if (Array.isArray(serverIds)) {
    for (const id of serverIds) {
      if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * Packet belongs to this driver when its driverId is in the trusted set.
 * Packets with no driverId may match driverName (pre-id legacy only).
 * Never include another driver's id. Never accept client-supplied extras.
 */
export function pullBelongsToDriver(
  packet: { driverId?: unknown; driverName?: unknown },
  trustedIds: string[],
  driverName?: string | null,
): boolean {
  const id = typeof packet.driverId === 'string' ? packet.driverId : '';
  if (id) return trustedIds.includes(id);
  const name = typeof packet.driverName === 'string' ? packet.driverName : '';
  if (driverName && name && name === driverName) return true;
  return false;
}
