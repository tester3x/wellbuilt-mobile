// Client-side canonical pull order — mirrors the server's compareChronoKey so the
// history list and the server agree on ordering, especially for EQUAL-time pulls.
// Order key: event time (dateTimeUTC, the authority) first, then a deterministic
// packetId tie-break. Sorting by the display-formatted dateTime string (or by time
// alone) is insufficient: a backdated pull must sort into its true position, and
// two pulls sharing a timestamp must order deterministically by packetId.

export interface ChronoOrderRow {
  dateTimeUTC?: string;
  dateTime?: string;
  packetId?: string;
}

/** Canonical event time in ms: prefer ISO dateTimeUTC, then a caller-supplied
 *  display-string parser, then a native Date parse; 0 when nothing parses. */
export function rowEventTimeMs(row: ChronoOrderRow, fallbackParse?: (s: string) => number): number {
  if (row.dateTimeUTC) {
    const t = new Date(row.dateTimeUTC).getTime();
    if (!isNaN(t)) return t;
  }
  if (row.dateTime) {
    if (fallbackParse) {
      const t = fallbackParse(row.dateTime);
      if (t) return t;
    }
    const t = new Date(row.dateTime).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
}

/** <0 if a sorts before b, >0 after, 0 identical — by (event time, packetId). */
export function compareWellHistoryRowsCanonical(
  a: ChronoOrderRow,
  b: ChronoOrderRow,
  fallbackParse?: (s: string) => number,
): number {
  const ta = rowEventTimeMs(a, fallbackParse);
  const tb = rowEventTimeMs(b, fallbackParse);
  if (ta !== tb) return ta < tb ? -1 : 1;
  const pa = String(a.packetId || '');
  const pb = String(b.packetId || '');
  return pa < pb ? -1 : pa > pb ? 1 : 0;
}
