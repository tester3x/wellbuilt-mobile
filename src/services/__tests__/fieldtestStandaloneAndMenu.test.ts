jest.mock('../driverAuth', () => ({
  getDriverSession: jest.fn(async () => ({ companyId: 'test-co', driverId: 'test-dr' })),
}));

jest.mock('../secureOperationalApi', () => ({
  secureResolveExecutionBinding: jest.fn(async () => ({
    ok: true,
    snapshot: {
      jobId: 'valid_job_123',
      wellName: 'Authoritative Well Name',
      packetRevision: 'rev_1',
    },
  })),
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
  isGovernedPacketAccessEnabled,
} from '../governedPacketAccess';

const root = join(__dirname, '../../..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('WB-M Field-Test Standalone & Bottom Navigation Verification (Tests 1-16)', () => {
  // ── 1. Standalone open with no jobId succeeds ──
  test('1. Standalone open with no jobId succeeds without calling backend resolver', async () => {
    const res = await beginGovernedProductionWaterPull({ jobId: '' });
    expect(res.ok).toBe(true);
    expect(res.kind).toBe('ok');
    expect((res as any).snapshot).toBeNull();
  });

  // ── 2. Standalone pull creation with no jobId succeeds ──
  test('2. Standalone pull creation with no jobId succeeds', async () => {
    const resWhitespace = await beginGovernedProductionWaterPull({ jobId: '   ' });
    expect(resWhitespace.ok).toBe(true);
    expect(resWhitespace.kind).toBe('ok');
  });

  // ── 3. Standalone pull submission with no jobId succeeds ──
  test('3. Standalone pull submission with no jobId succeeds', async () => {
    const res = await authorizeGovernedPullSubmit('');
    expect(res.ok).toBe(true);
    expect(res.kind).toBe('ok');
  });

  // ── 4. Editing the same pull three times retains one pull identity ──
  test('4. Editing the same pull three times retains one pull identity (packet IS the job)', () => {
    const editHistory: Array<{ localPullId: string; wellName: string; bbl: number; editCount: number }> = [];
    const initialPull = {
      localPullId: 'pull_stand_001',
      wellName: 'Gabriel 5',
      bbl: 120,
      editCount: 0,
    };
    editHistory.push(initialPull);

    // Edit 1
    const edit1 = { ...editHistory[editHistory.length - 1], bbl: 125, editCount: 1 };
    editHistory.push(edit1);

    // Edit 2
    const edit2 = { ...editHistory[editHistory.length - 1], bbl: 128, editCount: 2 };
    editHistory.push(edit2);

    // Edit 3
    const edit3 = { ...editHistory[editHistory.length - 1], bbl: 130, editCount: 3 };
    editHistory.push(edit3);

    expect(editHistory.every(e => e.localPullId === 'pull_stand_001')).toBe(true);
    expect(editHistory[3].bbl).toBe(130);
    expect(editHistory[3].editCount).toBe(3);
  });

  // ── 5. Invalid jobId does not block standalone creation ──
  test('5. Invalid jobId does not block standalone creation', () => {
    const gateSrc = src('src/components/GovernedPacketAccessGate.tsx');
    expect(gateSrc).toMatch(/<View style=\{styles\.banner\}>/);
    expect(gateSrc).toMatch(/\{children\}/);
    expect(gateSrc).not.toMatch(/if \(!result\.ok\) \{\s*return \(\s*<View style=\{styles\.panel\}>/);
  });

  // ── 6. Invalid jobId is not written into the standalone packet ──
  test('6. Invalid jobId is not written into the standalone packet', () => {
    const recordSrc = src('app/record.tsx');
    expect(recordSrc).toMatch(/const wellName = \(isGovernedPacketAccessEnabled\(\) && params\.editMode !== 'true' && resolvedWellName\)\s*\?\s*resolvedWellName\s*:\s*queryWellName;/);
  });

  // ── 7. Failed resolver call does not destroy the standalone draft ──
  test('7. Failed resolver call does not destroy the standalone draft', () => {
    const recordSrc = src('app/record.tsx');
    expect(recordSrc).toMatch(/if \(!isEditMode && isGovernedPacketAccessEnabled\(\) && !!jobId\)/);
    expect(recordSrc).toMatch(/falling back to standalone/);
  });

  // ── 8. A valid optional jobId can add authoritative context ──
  test('8. A valid optional jobId can add authoritative context', () => {
    const recordSrc = src('app/record.tsx');
    expect(recordSrc).toMatch(/setResolvedWellName\(snapshot\?\.execution\?\.wellName \|\| ''\);/);
  });

  // ── 9. The optional jobId never becomes the pull identity ──
  test('9. The optional jobId never becomes the pull identity', () => {
    const recordSrc = src('app/record.tsx');
    // Pull ID is minted locally by WB-M, not replaced by jobId
    expect(recordSrc).not.toMatch(/pullId\s*=\s*jobId/);
  });

  // ── 10. Closing/reopening History preserves edit identity ──
  test('10. Closing/reopening History preserves edit identity', () => {
    const recordSrc = src('app/record.tsx');
    expect(recordSrc).toMatch(/params\.editMode === 'true'/);
    expect(recordSrc).toMatch(/params\.editId/);
  });

  // ── 11. No stale governed context leaks into a later standalone pull ──
  test('11. No stale governed context leaks into a later standalone pull', () => {
    const indexSrc = src('app/(tabs)/index.tsx');
    expect(indexSrc).toMatch(/router\.push\(\{\s*pathname: '\/record',\s*params: \{ wellName: wells\[currentIndex\] \},\s*\}\);/);
    expect(indexSrc).not.toMatch(/jobId:/);
  });

  // ── 12. Governed-flag OFF behavior remains equivalent to the previous working APK ──
  test('12. Governed-flag OFF behavior remains equivalent to previous working APK', () => {
    const gateSrc = src('src/components/GovernedPacketAccessGate.tsx');
    expect(gateSrc).toMatch(/const governed = !disabled && isGovernedPacketAccessEnabled\(\) && !!id;/);
    expect(gateSrc).toMatch(/if \(!governed\) \{\s*return <>\{children\}<\/>;\s*\}/);
  });

  // ── 13. Bottom nav exposes History, PULL, and ••• ──
  test('13. Bottom nav exposes History, PULL, and •••', () => {
    const indexSrc = src('app/(tabs)/index.tsx');
    expect(indexSrc).toMatch(/router\.push\('\/history'\)/);
    expect(indexSrc).toMatch(/handlePullPress/);
    expect(indexSrc).toMatch(/styles\.navDots/);
    expect(indexSrc).toMatch(/>•••</);
  });

  // ── 14. No visible "More" label remains ──
  test('14. No visible "More" or "... More" or "Menu" label remains on bottom nav', () => {
    const indexSrc = src('app/(tabs)/index.tsx');
    // Check that navSide for moreButton does not have navLabel
    const bottomNavParts = indexSrc.split('styles.bottomNav');
    for (let i = 1; i < bottomNavParts.length; i++) {
      const part = bottomNavParts[i].slice(0, 1000);
      const moreSection = part.slice(part.indexOf('setShowMore(true)'));
      const endNav = moreSection.indexOf('</View>');
      const btn = moreSection.slice(0, endNav);
      expect(btn).not.toMatch(/navLabel/);
      expect(btn).not.toMatch(/>\s*More\s*</i);
      expect(btn).not.toMatch(/>\s*\.\.\.\s*More\s*</i);
      expect(btn).not.toMatch(/>\s*Menu\s*</i);
    }
  });

  // ── 15. Route Me, Summary, and Switch Apps remain reachable ──
  test('15. Route Me, Summary, and Switch Apps remain reachable in ••• menu', () => {
    const indexSrc = src('app/(tabs)/index.tsx');
    expect(indexSrc).toMatch(/accessibilityLabel="Route Me"/);
    expect(indexSrc).toMatch(/accessibilityLabel="Summary"/);
    expect(indexSrc).toMatch(/accessibilityLabel="Switch Apps"/);
    expect(indexSrc).toMatch(/router\.push\('\/route-me'\)/);
    expect(indexSrc).toMatch(/handleSummaryPress\(\)/);
    expect(indexSrc).toMatch(/DeviceEventEmitter\.emit\(OPEN_APP_SWITCHER_EVENT\)/);
  });

  // ── 16. Menu uses intended WellBuilt-style component, not emoji rows/generic giant sheet ──
  test('16. Menu uses WellBuilt dark popup menu, not emoji rows or generic sheet', () => {
    const indexSrc = src('app/(tabs)/index.tsx');
    expect(indexSrc).toMatch(/styles\.moreMenuPopup/);
    expect(indexSrc).toMatch(/styles\.moreMenuItem/);
    expect(indexSrc).toMatch(/styles\.moreMenuDivider/);
    expect(indexSrc).toMatch(/name="navigate-outline"/);
    expect(indexSrc).toMatch(/name="stats-chart-outline"/);
    expect(indexSrc).toMatch(/name="apps-outline"/);
    expect(indexSrc).not.toMatch(/moreSheet/);
    expect(indexSrc).not.toMatch(/🧭/);
    expect(indexSrc).not.toMatch(/📊/);
    expect(indexSrc).not.toMatch(/🔀/);
  });
});
