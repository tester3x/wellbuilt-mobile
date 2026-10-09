import { estimatedSnapshotLevel } from '../downSnapshot';
const now = Date.parse('2026-10-05T22:00:00Z');
describe('snapshot projection across navigation and refresh', () => {
  it.each([
    [6 + 5 / 12, '2026-09-26T00:52:51Z', 213.1],
    [7.5, '2026-09-28T03:33:01Z', 440.37],
  ])('caps old active snapshots at full on first render and refresh', (bottom, time, rate) => {
    const snapshot = { lastPullBottomLevelFeet: bottom, timestamp: Date.parse(time as string), flowRateMinutes: rate as number };
    expect(estimatedSnapshotLevel(snapshot, 0, now)).toBe(20);
    expect(estimatedSnapshotLevel(snapshot, 0, now + 30000)).toBe(20);
  });
  it('continues projecting a slow well beyond seven days without forcing full', () => {
    expect(estimatedSnapshotLevel({ levelFeet: 3, timestamp: now - 8 * 86400000, flowRateMinutes: 1440 }, 0, now)).toBe(11);
  });
  it('freezes down wells at their last bottom', () => {
    expect(estimatedSnapshotLevel({ levelFeet: 10, lastPullBottomLevelFeet: 4, timestamp: now - 10 * 86400000, flowRateMinutes: 60, isDown: true }, 0, now)).toBe(4);
  });
  it.each([NaN, 0, now + 60000])('does not grow invalid or future timestamps', timestamp => {
    expect(estimatedSnapshotLevel({ levelFeet: 4, timestamp, flowRateMinutes: 60 }, 0, now)).toBe(4);
  });
  it('requires a valid rate and accepts the configured fallback', () => {
    const snapshot = { levelFeet: 4, timestamp: now - 120 * 60000 };
    expect(estimatedSnapshotLevel(snapshot, 0, now)).toBe(4);
    expect(estimatedSnapshotLevel(snapshot, 60, now)).toBe(6);
  });
});
