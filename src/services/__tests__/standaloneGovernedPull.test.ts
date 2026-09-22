jest.mock('../driverAuth', () => ({
  getDriverSession: jest.fn(async () => ({ companyId: 'test-co', driverId: 'test-dr' })),
}));

jest.mock('../secureOperationalApi', () => ({
  secureResolveExecutionBinding: jest.fn(async () => ({})),
}));

jest.mock('../governedPacketAccessStore', () => ({
  loadPersistedExecutionBinding: jest.fn(async () => ({ ok: false })),
  persistExecutionBinding: jest.fn(async () => {}),
  invalidatePersistedExecutionBinding: jest.fn(async () => {}),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));

jest.mock('@react-native-community/netinfo', () => ({
  fetch: jest.fn(async () => ({ isConnected: true })),
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  beginGovernedProductionWaterPull,
  authorizeGovernedPullSubmit,
} from '../governedPacketAccess';

const root = join(__dirname, '../../..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('WB-M standalone architecture verification', () => {
  test('1. beginGovernedProductionWaterPull with empty jobId returns ok for standalone mode', async () => {
    const res1 = await beginGovernedProductionWaterPull({ jobId: '' });
    expect(res1.ok).toBe(true);
    expect(res1.kind).toBe('ok');

    const res2 = await beginGovernedProductionWaterPull({ jobId: '   ' });
    expect(res2.ok).toBe(true);
    expect(res2.kind).toBe('ok');
  });

  test('2. authorizeGovernedPullSubmit with empty jobId returns ok for standalone mode', async () => {
    const res1 = await authorizeGovernedPullSubmit('');
    expect(res1.ok).toBe(true);
    expect(res1.kind).toBe('ok');

    const res2 = await authorizeGovernedPullSubmit('   ');
    expect(res2.ok).toBe(true);
    expect(res2.kind).toBe('ok');
  });

  test('3. GovernedPacketAccessGate only activates governed mode when jobId is non-empty', () => {
    const gateSrc = src('src/components/GovernedPacketAccessGate.tsx');
    expect(gateSrc).toMatch(/const id = typeof jobId === 'string' \? jobId\.trim\(\) : '';/);
    expect(gateSrc).toMatch(/const governed = !disabled && isGovernedPacketAccessEnabled\(\) && !!id;/);
    expect(gateSrc).toMatch(/if \(!governed\) \{\s*return <>\{children\}<\/>;/s);
  });

  test('4. GovernedPacketAccessGate unverified fallback renders children with non-blocking banner', () => {
    const gateSrc = src('src/components/GovernedPacketAccessGate.tsx');
    expect(gateSrc).toMatch(/<View style=\{styles\.banner\}>[\s\S]*?<\/View>\s*\{children\}/);
    expect(gateSrc).not.toMatch(/if \(!result\.ok\) \{\s*return \(\s*<View style=\{styles\.panel\}>/);
  });

  test('5. record.tsx wellName falls back to queryWellName when resolvedWellName is not present', () => {
    const recordSrc = src('app/record.tsx');
    expect(recordSrc).toMatch(
      /const wellName = \(isGovernedPacketAccessEnabled\(\) && params\.editMode !== 'true' && resolvedWellName\)\s*\?\s*resolvedWellName\s*:\s*queryWellName;/
    );
  });

  test('6. record.tsx authorizeGovernedPullSubmit is guarded by !!jobId and falls back on error', () => {
    const recordSrc = src('app/record.tsx');
    expect(recordSrc).toMatch(/if \(!isEditMode && isGovernedPacketAccessEnabled\(\) && !!jobId\)/);
    expect(recordSrc).toMatch(/falling back to standalone/);
  });

  test('7. index.tsx direct well selection navigates directly to /record without blocking modal', () => {
    const indexSrc = src('app/(tabs)/index.tsx');
    expect(indexSrc).toMatch(/router\.push\(\{\s*pathname: '\/record',\s*params: \{ wellName: wells\[currentIndex\] \},\s*\}\);/);
    expect(indexSrc).not.toMatch(/const jobId = ''/);
    expect(indexSrc).not.toMatch(/beginGovernedProductionWaterPull/);
  });
});
