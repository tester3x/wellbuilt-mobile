import { collapseLogicalPulls, logicalPullKey, isDepartPacketId } from '../pullHistoryCollapse';

type E = { packetId?: string; id?: string; bblsTaken: number; tankLevelFeet: number; wellName: string; sentAt: number };
const mk = (packetId: string, bbls: number, lvl: number, well = 'Gabriel 5', sentAt = 0): E =>
  ({ packetId, id: packetId, bblsTaken: bbls, tankLevelFeet: lvl, wellName: well, sentAt });

const G5 = '20260924_085547_Gabriel5_y4url0';
const G6 = '20260924_120022_Gabriel6_231ouc';
const G1 = '20260924_090410_Gab1_pxaoxk';

describe('logicalPullKey / isDepartPacketId', () => {
  it('strips only idem_', () => {
    expect(logicalPullKey({ packetId: `idem_${G5}` })).toBe(G5);
    expect(logicalPullKey({ packetId: G5 })).toBe(G5);
    expect(isDepartPacketId(`idem_${G5}`)).toBe(true);
    expect(isDepartPacketId(G5)).toBe(false);
  });
});

describe('collapseLogicalPulls', () => {
  it('Gabriel 5 & 6 paired records collapse to one, keeping the bare Close values', () => {
    // newest-first: Close (later) before Depart (earlier)
    const out = collapseLogicalPulls([
      mk(G5, 140, 12.42, 'Gabriel 5', 200),          // Close (final)
      mk(`idem_${G5}`, 130, 12.0, 'Gabriel 5', 100), // Depart (pre-edit)
      mk(G6, 140, 12.0, 'Gabriel 6', 400),           // Close
      mk(`idem_${G6}`, 140, 12.0, 'Gabriel 6', 300), // Depart
    ]);
    expect(out.length).toBe(2);
    const g5 = out.find(e => e.wellName === 'Gabriel 5')!;
    expect(g5.packetId).toBe(G5);       // bare Close wins
    expect(g5.bblsTaken).toBe(140);     // final Close value, not the 130 Depart
  });

  it('Gab 1 single (Close only) record is retained', () => {
    const out = collapseLogicalPulls([mk(G1, 300, 17, 'Gab 1', 500)]);
    expect(out.length).toBe(1);
    expect(out[0].packetId).toBe(G1);
    expect(out[0].bblsTaken).toBe(300);
  });

  it('Depart-only pull (no Close yet) is retained', () => {
    const out = collapseLogicalPulls([mk(`idem_${G5}`, 140, 12.42, 'Gabriel 5', 100)]);
    expect(out.length).toBe(1);
    expect(logicalPullKey(out[0])).toBe(G5);
    expect(out[0].bblsTaken).toBe(140);
  });

  it('replay order: Depart first then Close still collapses to the Close', () => {
    const out = collapseLogicalPulls([
      mk(`idem_${G5}`, 130, 12.0, 'Gabriel 5', 100), // Depart seen first
      mk(G5, 140, 12.42, 'Gabriel 5', 200),          // Close later
    ]);
    expect(out.length).toBe(1);
    expect(out[0].packetId).toBe(G5);
    expect(out[0].bblsTaken).toBe(140);
  });

  it('two genuinely distinct pulls on one well (different base ids) stay separate', () => {
    const A = '20260924_080000_Gabriel5_aaaaaa';
    const B = '20260924_140000_Gabriel5_bbbbbb';
    const out = collapseLogicalPulls([
      mk(B, 150, 13, 'Gabriel 5', 900), mk(`idem_${B}`, 150, 13, 'Gabriel 5', 800),
      mk(A, 120, 11, 'Gabriel 5', 200), mk(`idem_${A}`, 120, 11, 'Gabriel 5', 100),
    ]);
    expect(out.length).toBe(2);
    expect(out.map(e => e.packetId).sort()).toEqual([A, B].sort());
  });
});
