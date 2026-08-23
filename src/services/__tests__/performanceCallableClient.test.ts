import { readFileSync } from 'fs';
import { join } from 'path';

const src = (rel: string) => readFileSync(join(__dirname, '../../..', rel), 'utf8');

describe('WB-M Performance callable client', () => {
  const firebase = src('src/services/firebase.ts');
  const detail = src('app/performance-detail.tsx');
  const list = src('app/performance.tsx');
  const index = src('app/(tabs)/index.tsx');

  it('client contains no production direct read of performance/', () => {
    expect(firebase).not.toMatch(/firebaseGet\([`'"]performance/);
    expect(firebase).toMatch(/authorizedCallable<DriverWellPerformanceFetch>\(\s*'getDriverWellPerformance'/);
    expect(list).not.toMatch(/updateRequired/);
    expect(detail).not.toMatch(/updateRequired/);
  });

  it('double-tap still routes to /performance-detail with the current well', () => {
    expect(index).toMatch(/pathname: '\/performance-detail'/);
    expect(index).toMatch(/params: \{ wellName: currentWell \}/);
    expect(index).toMatch(/handleTankDoubleTap/);
  });

  it('30D/90D/1Y/All/custom filtering still works', () => {
    expect(detail).toMatch(/"30d"/);
    expect(detail).toMatch(/"90d"/);
    expect(detail).toMatch(/"1y"/);
    expect(detail).toMatch(/"all"/);
    expect(detail).toMatch(/"custom"/);
    expect(firebase).toMatch(/export const filterRowsByDate/);
    expect(detail).toMatch(/getFromDate\(dateRangeOption\)/);
  });

  it('empty authorized well shows no pull data, not update required', () => {
    expect(detail).toMatch(/performance\.noPullData/);
    expect(detail).not.toMatch(/updateRequiredBody/);
    expect(firebase).toMatch(/emptyWellPerformance/);
  });

  it('well picker stays on the authorized WB-M catalog', () => {
    expect(detail).toMatch(/getWellNameList\(\)/);
    expect(list).toMatch(/getWellNameList\(\)/);
  });
});
