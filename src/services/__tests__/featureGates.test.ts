import { readFileSync } from 'fs';
import { join } from 'path';

const src = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

describe('P0-3 new secure-edit confirmation contract', () => {
  const markers = src('../editMarkers.ts');
  const delivery = src('../editDelivery.ts');

  it('confirmNewSecureEdit is the only confirmation predicate in editDelivery', () => {
    expect(delivery).toMatch(/confirmNewSecureEdit/);
    expect(delivery).not.toMatch(/processedOrig\.editedAt \|\| processedOrig\.wasEdited \|\| processedOrig\.editedByPacketId/);
  });

  it('accepts callable committed, receipt status, and editCommitted+receiptKey only', () => {
    expect(markers).toMatch(/p\.committed === true/);
    expect(markers).toMatch(/p\.status === 'committed'/);
    expect(markers).toMatch(/p\.editCommitted === true/);
    expect(markers).toMatch(/editCommittedReceiptKey/);
  });
});

describe('P0-8 incompatible paths are gated, not outages', () => {
  const manager = src('../../../app/manager.tsx');
  const status = src('../firebaseStatus.ts');
  const systemLog = src('../systemLog.ts');
  const debugLog = src('../debugLog.ts');
  const driverAuth = src('../driverAuth.ts');
  const firebase = src('../firebase.ts');
  const performance = src('../../../app/performance.tsx');
  const perfDetail = src('../../../app/performance-detail.tsx');

  it('manager does not attach the API key as RTDB auth', () => {
    expect(manager).not.toMatch(/auth=\$\{FIREBASE_API_KEY\}/);
    expect(manager).toMatch(/MANAGER_AVAILABLE/);
    expect(manager).toMatch(/updateRequired/);
    expect(manager).toMatch(/update_required/);
  });

  it('firebaseStatus does not throw-as-offline', () => {
    expect(status).not.toMatch(/throw new Error\('firebaseStatus_rtdb_api_key_disabled/);
    expect(status).toMatch(/\.info\/connected/);
    expect(status).toMatch(/getValidIdToken/);
  });

  it('systemLog and debugLog use a governed disable, not dead API-key writes', () => {
    expect(systemLog).toMatch(/SYSTEM_LOG_REMOTE_AVAILABLE/);
    expect(systemLog).toMatch(/remote unavailable/);
    expect(systemLog).not.toMatch(/throw new Error\('systemLog_rtdb_api_key_disabled/);
    expect(systemLog).not.toMatch(/auth=\$\{FIREBASE_API_KEY\}/);
    expect(debugLog).toMatch(/DEBUG_LOG_REMOTE_AVAILABLE/);
    expect(debugLog).not.toMatch(/throw new Error\('debugLog_rtdb_api_key_disabled/);
    expect(debugLog).not.toMatch(/auth=\$\{FIREBASE_API_KEY\}/);
  });

  it('driverAuth awaits buildFirebaseUrl and gates device management', () => {
    expect(driverAuth).toMatch(/DEVICE_MANAGEMENT_AVAILABLE/);
    expect(driverAuth).toMatch(/const url = await buildFirebaseUrl\(`devices\/company\/\$\{deviceId\}`\)/);
    expect(driverAuth).not.toMatch(/const url = buildFirebaseUrl\(`devices\/company/);
  });

  it('well history uses the scoped catalog, not a well_config child read', () => {
    expect(firebase).toMatch(/getWellConfig\(wellName\)/);
    expect(firebase).not.toMatch(/firebaseGet\(`well_config\/\$\{wellName\}`\)/);
  });

  it('performance reads go through getDriverWellPerformance, not a client RTDB path', () => {
    expect(firebase).toMatch(/getDriverWellPerformance/);
    expect(firebase).not.toMatch(/firebaseGet\([`'"]performance/);
    expect(firebase).not.toMatch(/PERFORMANCE_READS_AVAILABLE/);
    expect(performance).not.toMatch(/PERFORMANCE_READS_AVAILABLE/);
    expect(performance).not.toMatch(/updateRequired/);
    expect(perfDetail).not.toMatch(/PERFORMANCE_READS_AVAILABLE/);
    expect(perfDetail).not.toMatch(/updateRequired/);
    expect(perfDetail).toMatch(/getWellPerformance/);
  });
});
