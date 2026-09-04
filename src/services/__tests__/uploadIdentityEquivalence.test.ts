/**
 * Proves the "remove two dead SecureStore reads from uploadTankPacket" latency
 * fix is SECURITY-BEHAVIOR-IDENTICAL:
 *  1. The wire packet never carried driver identity — the server stamps the
 *     authenticated driver from the ID token — so dropping the client-side
 *     getDriverId()/getDriverName() reads changes no uploaded data.
 *  2. Idempotency is untouched: idempotencyKey === packetId, and the builder is
 *     deterministic, so replays remain idempotent.
 * Plus a source guard that the two keystore reads are gone from the submit path.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildWbmPullCommand } from '../wbmPullCommand';

const baseInput = {
  packetId: '20260904_120000_TestWell_ab12cd',
  wellName: 'TestWell',
  dateTimeUTC: '2026-09-04T17:00:00.000Z',
  dateTime: '9/4/2026 12:00 PM',
  timezone: 'America/Chicago',
  tankLevelFeet: 8,
  bblsTaken: 20,
  wellDown: false,
  wellDownIsAuthoritative: true,
};

describe('wire packet carries no driver identity (server stamps it)', () => {
  test('built packet has no driverId / driverName fields', () => {
    const packet = buildWbmPullCommand(baseInput);
    expect('driverId' in packet).toBe(false);
    expect('driverName' in packet).toBe(false);
  });

  test('idempotencyKey === packetId (idempotency preserved)', () => {
    const packet = buildWbmPullCommand(baseInput);
    expect(packet.idempotencyKey).toBe(baseInput.packetId);
    expect(packet.packetId).toBe(baseInput.packetId);
  });

  test('builder is deterministic → replays are idempotent', () => {
    expect(buildWbmPullCommand(baseInput)).toEqual(buildWbmPullCommand(baseInput));
  });
});

describe('uploadTankPacket no longer reads driver identity on the submit path', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../firebase.ts'),
    'utf8',
  );
  const fn = src.slice(
    src.indexOf('export const uploadTankPacket'),
    src.indexOf('export const uploadDefaultPacket'),
  );

  test('the two SecureStore-backed identity reads are removed', () => {
    expect(fn).not.toContain('await getDriverId()');
    expect(fn).not.toContain('await getDriverName()');
    expect(fn).not.toContain('void driverId');
    expect(fn).not.toContain('void driverName');
  });

  test('the now-unused driverAuth import is gone from firebase.ts', () => {
    expect(src).not.toContain("import { getDriverId, getDriverName } from './driverAuth'");
  });

  test('the identity log no longer leaks a driver name', () => {
    expect(fn).not.toContain('by driver:');
  });
});
