// Phase-7 pins:
//  1. An empty performance state NEVER blocks the individual-well pull list —
//     getWellPerformance returns the honest empty shape (not null, no throw),
//     and the detail screen's data branch renders whenever wellData is truthy,
//     so the pull-history table (with its own noPullData empty text) stays
//     reachable from the tank double-tap.
//  2. Foreground resume loads BOTH applied revision tokens (legacy + v2)
//     before the coalesced status sync.
//  3. A cross-date EDIT reorders by its NEW event time under the canonical
//     comparator — same logical id, new chronological position.
import { readFileSync } from 'fs';
import { join } from 'path';
import { compareWellHistoryRowsCanonical } from '../../utils/chronoOrder';

const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

describe('empty performance never blocks the pull list', () => {
  test('service contract: zero rows → empty WellPerformance shape, never null', () => {
    const fb = src('src/services/firebase.ts');
    // The zero-row branch returns the empty shape...
    expect(fb).toMatch(/if \(filteredRows\.length === 0\) \{\s*return emptyWellPerformance\(wellName, rawWell\.updated\);/);
    // ...whose rows are an empty ARRAY (SectionList renders its noPullData
    // empty component instead of vanishing).
    expect(fb).toMatch(/const emptyWellPerformance = \(wellName: string, updated\?: string\): WellPerformance => \(\{[\s\S]*?rows: \[\],/);
  });

  test('screen contract: the data branch gates on wellData (truthy for empty data), and stats derives from wellData', () => {
    const screen = src('app/performance-detail.tsx');
    expect(screen).toMatch(/\{!loading && !error && wellData && stats && \(/);
    expect(screen).toMatch(/const stats = wellData \? \{/); // empty data still yields a stats object
    expect(screen).toMatch(/performance\.noPullData/);       // honest empty state INSIDE the list
  });
});

describe('foreground resume', () => {
  test('syncOnForeground loads legacy AND v2 applied tokens before the coalesced sync', () => {
    const bg = src('src/services/backgroundSync.ts');
    const fn = bg.slice(bg.indexOf('export async function syncOnForeground'), bg.indexOf('function scheduleVersionCompletionRetry'));
    expect(fn).toContain('await loadAppliedIncomingVersion();');
    expect(fn).toContain('await loadAppliedRevisionV2();');
    expect(fn).toContain('return runOutgoingStatusSync();');
  });
});

describe('cross-date edit reorders by event time', () => {
  test('an edited pull moved to another date sorts at its NEW position, same logical id', () => {
    const rows = [
      { packetId: 'a', dateTimeUTC: '2026-08-26T20:00:00.000Z' },
      { packetId: 'b', dateTimeUTC: '2026-08-27T12:00:00.000Z' },
      { packetId: 'c', dateTimeUTC: '2026-08-28T09:00:00.000Z' },
    ];
    // EDIT moves 'c' back across the date boundary to 08-26 06:00.
    const edited = rows.map(r => r.packetId === 'c' ? { ...r, dateTimeUTC: '2026-08-26T06:00:00.000Z' } : r);
    const asc = [...edited].sort(compareWellHistoryRowsCanonical);
    expect(asc.map(r => r.packetId)).toEqual(['c', 'a', 'b']); // new position, identity retained
  });
});
