// Cross-repository governed-contract fixture (Thor 1 requirement 2). The 7
// canonical CREATE/EDIT packets are GENERATED from the REAL WB-M builders
// (buildWbmPullCommand / buildWbmEditCommand) and pinned to a committed golden
// file with a sha256 digest. The server emulator consumes the SAME golden file
// verbatim through the real ingest→processing pipeline (see
// functions/emulator/governedContractFixture.mjs).
//
// THIS test detects BUILDER DRIFT within the CLIENT repo: if a builder changes
// without regenerating the golden, the recomputed digest stops matching and this
// fails loudly. It is NOT, on its own, a cross-repository divergence detector —
// it only sees the client copy. Client-vs-server VERSION DIVERGENCE is caught by
// two other mechanisms: the server harness's EXPECTED_CLIENT_CONTRACT pin, and
// the authoritative byte-compare `scripts/checkGovernedContractFixtureSync.mjs`.
//
// Regenerate + sync both repo copies (client is authoritative) with ONE command:
//   node scripts/syncGovernedContractFixture.mjs
// then bump the server EXPECTED_CLIENT_CONTRACT pin to the printed {version,digest}.
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { buildWbmPullCommand } from '../wbmPullCommand';
import { buildWbmEditCommand } from '../wbmEditCommand';

const FIXTURE_DIR = join(__dirname, '__fixtures__');
const GOLDEN = join(FIXTURE_DIR, 'wbm-governed-contract.json');
const FIXTURE_VERSION = 1;

// Thor-exact representative values.
const PID = '20260830_123821_Thor1_unozct';
const WELL = 'Thor 1';
const TOP = 136 / 12; // 11'4"
const BBL = 140;
const TZ = 'America/Chicago';
const CORR = '2026-08-30T19:09:00.000Z';
const EVID_A = 'editevt_00000000-0000-4000-8000-000000000001';
const EVID_B = 'editevt_00000000-0000-4000-8000-000000000002';

const editBase = { originalPacketTimestamp: PID.slice(0, 15), originalPacketId: PID, wellName: WELL, dateTime: '', dateTimeUTC: '', tankLevelFeet: TOP, bblsTaken: BBL };

function generate() {
  const createFalse = buildWbmPullCommand({ packetId: '20260830_200000_Thor1_crt001', wellName: WELL, dateTime: '8/30/2026 3PM', dateTimeUTC: '2026-08-30T20:00:00.000Z', tankLevelFeet: TOP, bblsTaken: BBL, wellDown: false, timezone: TZ });
  const createTrue = buildWbmPullCommand({ packetId: '20260830_210000_Thor1_crt002', wellName: WELL, dateTime: '8/30/2026 4PM', dateTimeUTC: '2026-08-30T21:00:00.000Z', tankLevelFeet: TOP, bblsTaken: BBL, wellDown: true, timezone: TZ });
  // Untouched checkbox: the seeded value is carried for display but NOT asserted
  // (wellDownIsAuthoritative:false) so the server preserves canonical status.
  const createUntouched = buildWbmPullCommand({ packetId: '20260830_220000_Thor1_crt003', wellName: WELL, dateTime: '8/30/2026 5PM', dateTimeUTC: '2026-08-30T22:00:00.000Z', tankLevelFeet: TOP, bblsTaken: BBL, wellDown: true, wellDownIsAuthoritative: false, timezone: TZ });
  const editFalse = buildWbmEditCommand({ ...editBase, wellDown: false, timezone: TZ, editEventId: EVID_A, correctionCreatedAtUTC: CORR });
  const editTrue = buildWbmEditCommand({ ...editBase, wellDown: true, timezone: TZ, editEventId: EVID_B, correctionCreatedAtUTC: CORR });
  // Retry of editFalse: identical editEventId + material → byte-identical command.
  const editRetry = buildWbmEditCommand({ ...editBase, wellDown: false, timezone: TZ, editEventId: EVID_A, correctionCreatedAtUTC: CORR });
  // Second deliberate correction: a DIFFERENT editEventId (distinct identity).
  const editSecond = buildWbmEditCommand({ ...editBase, wellDown: true, timezone: TZ, editEventId: EVID_B, correctionCreatedAtUTC: '2026-08-30T19:15:00.000Z' });
  // API-style edit with wellDown OMITTED from editedFields (a non-UI caller). The
  // WB-M builder always includes wellDown, so this is constructed directly.
  const editOmitted = { ...(editFalse as Record<string, unknown>), editedFields: ['tankLevelFeet', 'bblsTaken'], editEventId: 'editevt_00000000-0000-4000-8000-0000000000ff', idempotencyKey: 'editevt_00000000-0000-4000-8000-0000000000ff' };
  return { createFalse, createTrue, createUntouched, editFalse, editTrue, editRetry, editSecond, editOmitted };
}

const digestOf = (fixtures: unknown) => createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');

describe('governed CREATE/EDIT contract fixture (client ↔ server)', () => {
  const fixtures = generate();
  const digest = digestOf(fixtures);

  if (process.env.WB_WRITE_FIXTURE === '1') {
    it('writes the golden fixture', () => {
      mkdirSync(FIXTURE_DIR, { recursive: true });
      writeFileSync(GOLDEN, JSON.stringify({ version: FIXTURE_VERSION, digest, fixtures }, null, 2));
      expect(existsSync(GOLDEN)).toBe(true);
    });
    return;
  }

  it('the committed golden fixture is EXACTLY what the real WB-M builders emit (drift tripwire)', () => {
    expect(existsSync(GOLDEN)).toBe(true); // run WB_WRITE_FIXTURE=1 to (re)generate
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    expect(golden.version).toBe(FIXTURE_VERSION);
    expect(golden.fixtures).toEqual(fixtures);   // builder output === golden
    expect(golden.digest).toBe(digest);          // and its sha256 pins it
    expect(digestOf(golden.fixtures)).toBe(golden.digest); // self-consistent
  });

  it('CREATE asserts explicit wellDown + authority for both false and true', () => {
    expect(fixtures.createFalse.wellDown).toBe(false);
    expect(fixtures.createFalse.wellDownIsAuthoritative).toBe(true);
    expect(fixtures.createTrue.wellDown).toBe(true);
    expect(fixtures.createTrue.wellDownIsAuthoritative).toBe(true);
    // Untouched box carries the seeded value but does NOT assert authority.
    expect(fixtures.createUntouched.wellDown).toBe(true);
    expect(fixtures.createUntouched.wellDownIsAuthoritative).toBe(false);
  });

  it('EDIT is governed v2 with wellDown explicit in the mask; retry is byte-identical; second is distinct', () => {
    expect(fixtures.editFalse.schemaVersion).toBe(2);
    expect(fixtures.editFalse.editedFields).toContain('wellDown');
    expect(fixtures.editFalse.wellDown).toBe(false);
    expect(fixtures.editFalse.idempotencyKey).toBe(fixtures.editFalse.editEventId);
    expect(fixtures.editFalse.correctionCreatedAtUTC).toBe(CORR);
    expect(fixtures.editRetry).toEqual(fixtures.editFalse);              // retry idempotent at the builder
    expect(fixtures.editSecond.editEventId).not.toBe(fixtures.editFalse.editEventId); // distinct correction
    expect((fixtures.editOmitted.editedFields as string[])).not.toContain('wellDown'); // API omit
  });
});
