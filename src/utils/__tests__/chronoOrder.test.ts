// Canonical client pull-order comparator — regression pins for the repaired
// history rendering. Ordering must follow event time (dateTimeUTC), then packetId,
// exactly like the server, so backdated pulls land in position and equal-time pulls
// are deterministic. (Sorting by the display-formatted dateTime string is wrong.)
import { compareWellHistoryRowsCanonical, rowEventTimeMs, type ChronoOrderRow } from '../chronoOrder';

const row = (over: Partial<ChronoOrderRow>): ChronoOrderRow => ({ packetId: 'p', ...over });

describe('compareWellHistoryRowsCanonical', () => {
  test('orders by dateTimeUTC (event time), NOT the display dateTime string', () => {
    // Display strings are intentionally misleading vs the true UTC instants.
    const a = row({ packetId: 'a', dateTimeUTC: '2026-08-27T06:00:00.000Z', dateTime: '12/31/2099 11:59 PM' });
    const b = row({ packetId: 'b', dateTimeUTC: '2026-08-27T18:00:00.000Z', dateTime: '1/1/2000 12:00 AM' });
    // a is earlier by UTC despite its far-future display string.
    expect(compareWellHistoryRowsCanonical(a, b)).toBeLessThan(0);
    const desc = [b, a].sort((x, y) => compareWellHistoryRowsCanonical(y, x)); // newest first
    expect(desc.map((r) => r.packetId)).toEqual(['b', 'a']);
  });

  test('a backdated (older) pull sorts BETWEEN the correct existing rows', () => {
    const early = row({ packetId: 'early', dateTimeUTC: '2026-08-27T06:00:00.000Z' });
    const mid = row({ packetId: 'mid', dateTimeUTC: '2026-08-27T12:00:00.000Z' });   // inserted backdated
    const late = row({ packetId: 'late', dateTimeUTC: '2026-08-27T18:00:00.000Z' });
    const asc = [late, early, mid].sort((x, y) => compareWellHistoryRowsCanonical(x, y));
    expect(asc.map((r) => r.packetId)).toEqual(['early', 'mid', 'late']); // mid lands in the middle
  });

  test('equal-time rows order deterministically by packetId', () => {
    const t = '2026-08-27T18:00:00.000Z';
    const a = row({ packetId: 'pkt_AAAA', dateTimeUTC: t });
    const z = row({ packetId: 'pkt_ZZZZ', dateTimeUTC: t });
    expect(compareWellHistoryRowsCanonical(a, z)).toBeLessThan(0); // AAAA before ZZZZ
    expect(compareWellHistoryRowsCanonical(z, a)).toBeGreaterThan(0);
    // Stable regardless of input order.
    const asc1 = [a, z].sort((x, y) => compareWellHistoryRowsCanonical(x, y));
    const asc2 = [z, a].sort((x, y) => compareWellHistoryRowsCanonical(x, y));
    expect(asc1.map((r) => r.packetId)).toEqual(['pkt_AAAA', 'pkt_ZZZZ']);
    expect(asc2.map((r) => r.packetId)).toEqual(['pkt_AAAA', 'pkt_ZZZZ']);
  });

  test('packetId IS available to the comparator (identity preserved through sort)', () => {
    const t = '2026-08-27T18:00:00.000Z';
    const rows = [
      row({ packetId: 'p3', dateTimeUTC: t }),
      row({ packetId: 'p1', dateTimeUTC: t }),
      row({ packetId: 'p2', dateTimeUTC: t }),
    ];
    const sorted = [...rows].sort((x, y) => compareWellHistoryRowsCanonical(x, y));
    expect(sorted.map((r) => r.packetId)).toEqual(['p1', 'p2', 'p3']); // deterministic by id
  });

  test('falls back to the display-string parser only when dateTimeUTC is absent', () => {
    const parse = (s: string) => (s === 'NOON' ? 1200 : 0);
    expect(rowEventTimeMs({ dateTime: 'NOON' }, parse)).toBe(1200);
    // dateTimeUTC wins when present.
    expect(rowEventTimeMs({ dateTimeUTC: '2026-08-27T00:00:00.000Z', dateTime: 'NOON' }, parse))
      .toBe(new Date('2026-08-27T00:00:00.000Z').getTime());
  });

  test('current-production rows (no review fields, maybe no packetId) still order safely', () => {
    // Legacy/prod rows may lack packetId — comparator must not throw and stays stable.
    const a: ChronoOrderRow = { dateTimeUTC: '2026-08-27T06:00:00.000Z' };
    const b: ChronoOrderRow = { dateTimeUTC: '2026-08-27T18:00:00.000Z' };
    expect(compareWellHistoryRowsCanonical(a, b)).toBeLessThan(0);
    expect(compareWellHistoryRowsCanonical({}, {})).toBe(0);
  });
});
