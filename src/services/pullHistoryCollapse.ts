// Pure logical-pull collapse for WB-M pull history (RN/Firebase-free → unit-testable).
//
// A single physical WB-T pull produces TWO processed packets: a Depart fast-path
// `idem_<pullId>` and a bare Close finalize `<pullId>`. Both live in
// packets/processed (kept for audit — NEVER deleted). For DISPLAY they must
// collapse to one logical pull; when both exist the bare Close record wins (its
// final gauge + barrel values). A Depart-only pull (no Close yet) is retained.
// Genuinely distinct pulls (different base ids) stay separate.

export interface LogicalPullLike {
  packetId?: string;
  id?: string;
}

const IDEM_PREFIX = 'idem_';

/** True when this record is a Depart fast-path packet (idem_ prefixed). */
export function isDepartPacketId(rawId: string | undefined | null): boolean {
  return typeof rawId === 'string' && rawId.startsWith(IDEM_PREFIX);
}

/** The logical pull id — the bare id shared by the Depart (idem_<id>) and the
 *  Close (<id>). Only the transient idem_ prefix is stripped. */
export function logicalPullKey(entry: LogicalPullLike): string {
  const raw = entry.packetId || entry.id || '';
  return raw.startsWith(IDEM_PREFIX) ? raw.slice(IDEM_PREFIX.length) : raw;
}

/**
 * Collapse idem_<id> + <id> into one display entry per logical pull, preferring
 * the bare Close record. Order of first appearance is preserved (callers pass a
 * newest-first list, so the Close — later sentAt — is normally seen first).
 * Returns a NEW array; inputs are never mutated (cache stays intact for audit +
 * per-packetId sync tracking).
 */
export function collapseLogicalPulls<T extends LogicalPullLike>(entries: T[]): T[] {
  const byLogical = new Map<string, T>();
  const order: string[] = [];
  for (const e of entries) {
    const key = logicalPullKey(e);
    const existing = byLogical.get(key);
    if (!existing) {
      byLogical.set(key, e);
      order.push(key);
      continue;
    }
    // Both a Depart and a Close (or a dup) map to this pull. Keep the bare Close.
    const existingIsDepart = isDepartPacketId(existing.packetId || existing.id);
    const incomingIsDepart = isDepartPacketId(e.packetId || e.id);
    if (existingIsDepart && !incomingIsDepart) {
      byLogical.set(key, e); // replace Depart with the authoritative Close
    }
    // existing Close + incoming Depart  → keep Close (no-op)
    // same kind (true duplicate)        → keep the first seen (no-op)
  }
  return order.map((k) => byLogical.get(k) as T);
}
