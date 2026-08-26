import { readFileSync } from 'fs';
import { join } from 'path';

const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

describe('Performance route/data contract', () => {
  const firebase = src('src/services/firebase.ts');
  const detail = src('app/performance-detail.tsx');
  const list = src('app/performance.tsx');
  const index = src('app/(tabs)/index.tsx');
  const history = src('app/history.tsx');
  const summary = src('app/summary.tsx');

  it('double-tap Gabriel 1 opens Gabriel 1 Performance', () => {
    expect(index).toMatch(/pathname: '\/performance-detail'/);
    expect(index).toMatch(/params: \{ wellName: currentWell \}/);
  });

  it('no placeholder update-required route remains production-reachable', () => {
    expect(list).not.toMatch(/PERFORMANCE_READS_AVAILABLE/);
    expect(detail).not.toMatch(/PERFORMANCE_READS_AVAILABLE/);
    expect(list).not.toMatch(/updateRequired/);
    expect(detail).not.toMatch(/updateRequired/);
  });

  it('reads performance from the authenticated RTDB path, not the undeployed callable', () => {
    // Restored 2026-08-25: the double-tap read uses the existing authenticated
    // RTDB path performance/{wellKey} (last-good), not the undeployed
    // getDriverWellPerformance callable which left the screen erroring.
    expect(firebase).toMatch(/firebaseGet\(`performance\/\$\{wellKey\}`\)/);
    expect(firebase).not.toMatch(/authorizedCallable<[^>]*>\(\s*[`'"]getDriverWellPerformance/);
  });

  it('performance data exists → getWellPerformance still computes metrics', () => {
    expect(firebase).toMatch(/calculateStats/);
    expect(firebase).toMatch(/filterRowsByDate/);
    expect(detail).toMatch(/getWellPerformance\(currentWellName/);
  });

  it('selected well changes keep the well identity', () => {
    expect(detail).toMatch(/currentWellName/);
    expect(detail).toMatch(/handleWellSelect/);
  });

  it('History and Summary navigation files are not rewritten onto Performance', () => {
    expect(history).toMatch(/history/);
    expect(summary).toMatch(/summary/);
    expect(history).not.toMatch(/PERFORMANCE_READS_AVAILABLE/);
    expect(summary).not.toMatch(/PERFORMANCE_READS_AVAILABLE/);
  });
});
