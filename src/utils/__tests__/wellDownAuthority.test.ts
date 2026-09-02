// Authoritative Well Down resolution + backend-parity proofs.
//
// Required Record Load semantics for the "Well Down -> Online" (and reverse)
// status transition:
//   - explicit down->online sends wellDown:false + authoritative:true
//   - explicit online->down sends wellDown:true + authoritative:true
//   - an UNTOUCHED box sends wellDownIsAuthoritative:false — the seeded value is
//     display only; the server PRESERVES its current canonical status, even if
//     that status changed while the form was open (concurrency safety)
//   - an explicit toggle wins over canonical (stale-state / reset ordering)
//   - a missing/non-boolean wellDown fails CLOSED at the server even when
//     authoritative is true
//   - status resolution is independent of any numeric (level / bbl) parsing
import {
  resolveWellDownForSubmit,
  backendNextIsDown,
} from '../wellDownAuthority';
import { buildWbmPullCommand } from '../../services/wbmPullCommand';

const PID = '20260830_200000_Thor1_crt001';
const buildPacket = (wellDown: boolean, wellDownIsAuthoritative?: boolean) =>
  buildWbmPullCommand({
    packetId: PID,
    wellName: 'Thor 1',
    dateTime: '8/30/2026 3PM',
    dateTimeUTC: '2026-08-30T20:00:00.000Z',
    timezone: 'America/Chicago',
    tankLevelFeet: 136 / 12,
    bblsTaken: 140,
    wellDown,
    wellDownIsAuthoritative,
  });

describe('resolveWellDownForSubmit — explicit transitions', () => {
  test('down -> online (driver unchecks a down well) sends wellDown:false + authoritative:true', () => {
    const r = resolveWellDownForSubmit({ canonicalIsDown: true, checkboxWellDown: false, touched: true });
    expect(r.wellDown).toBe(false);
    expect(r.wellDownIsAuthoritative).toBe(true);
    const packet = buildPacket(r.wellDown, r.wellDownIsAuthoritative);
    expect(packet.wellDown).toBe(false);
    expect(packet.wellDownIsAuthoritative).toBe(true);
    expect(backendNextIsDown({ existingIsDown: true, packetWellDown: packet.wellDown, packetWellDownIsAuthoritative: packet.wellDownIsAuthoritative })).toBe(false); // now online
  });

  test('online -> down (driver checks an online well) sends wellDown:true + authoritative:true', () => {
    const r = resolveWellDownForSubmit({ canonicalIsDown: false, checkboxWellDown: true, touched: true });
    expect(r.wellDown).toBe(true);
    expect(r.wellDownIsAuthoritative).toBe(true);
    const packet = buildPacket(r.wellDown, r.wellDownIsAuthoritative);
    expect(backendNextIsDown({ existingIsDown: false, packetWellDown: packet.wellDown, packetWellDownIsAuthoritative: packet.wellDownIsAuthoritative })).toBe(true); // now down
  });
});

describe('resolveWellDownForSubmit — untouched asserts NO authority (server preserves canonical)', () => {
  test('untouched box → wellDownIsAuthoritative:false', () => {
    expect(resolveWellDownForSubmit({ canonicalIsDown: true, checkboxWellDown: true, touched: false }).wellDownIsAuthoritative).toBe(false);
    expect(resolveWellDownForSubmit({ canonicalIsDown: false, checkboxWellDown: false, touched: false }).wellDownIsAuthoritative).toBe(false);
  });

  test('untouched submit ignores a not-yet-seeded checkbox (async-seed race) and asserts no authority', () => {
    // Canonical is down, but the async snapshot seed has NOT flipped the checkbox.
    const r = resolveWellDownForSubmit({ canonicalIsDown: true, checkboxWellDown: false, touched: false });
    expect(r.wellDownIsAuthoritative).toBe(false); // never asserts a racy value
    // Server keeps whatever it currently holds — no manufactured transition.
    expect(backendNextIsDown({ existingIsDown: true, packetWellDown: r.wellDown, packetWellDownIsAuthoritative: r.wellDownIsAuthoritative })).toBe(true);
  });
});

// ── Mike's required concurrency tests (server status changes while form is open) ──
describe('concurrency: an untouched submit never overwrites a status changed while the form was open', () => {
  test('1. form opens DOWN, server becomes ONLINE while open, untouched submit must NOT put it Down again', () => {
    // Checkbox seeded checked from canonical-at-open (down); driver never touches it.
    const r = resolveWellDownForSubmit({ canonicalIsDown: true, checkboxWellDown: true, touched: false });
    expect(r.wellDownIsAuthoritative).toBe(false);
    // Server status is now ONLINE (changed after the form opened).
    expect(backendNextIsDown({ existingIsDown: false, packetWellDown: r.wellDown, packetWellDownIsAuthoritative: r.wellDownIsAuthoritative })).toBe(false); // stays ONLINE
  });

  test('2. form opens ONLINE, server becomes DOWN while open, untouched submit must NOT put it Online again', () => {
    const r = resolveWellDownForSubmit({ canonicalIsDown: false, checkboxWellDown: false, touched: false });
    expect(r.wellDownIsAuthoritative).toBe(false);
    // Server status is now DOWN (changed after the form opened).
    expect(backendNextIsDown({ existingIsDown: true, packetWellDown: r.wellDown, packetWellDownIsAuthoritative: r.wellDownIsAuthoritative })).toBe(true); // stays DOWN
  });

  test('3. explicit Down→Online then custom-keypad Done still sends false + authoritative:true', () => {
    // record.tsx reads the live toggled value from a ref at Done/submit time.
    const liveRefWellDown = false; // driver unchecked before tapping Done
    const r = resolveWellDownForSubmit({ canonicalIsDown: true, checkboxWellDown: liveRefWellDown, touched: true });
    expect(r.wellDown).toBe(false);
    expect(r.wellDownIsAuthoritative).toBe(true);
    // Even if the server was concurrently re-marked DOWN, the EXPLICIT toggle wins.
    expect(backendNextIsDown({ existingIsDown: true, packetWellDown: r.wellDown, packetWellDownIsAuthoritative: r.wellDownIsAuthoritative })).toBe(false);
  });

  test('4. explicit Online→Down still sends true + authoritative:true', () => {
    const r = resolveWellDownForSubmit({ canonicalIsDown: false, checkboxWellDown: true, touched: true });
    expect(r.wellDown).toBe(true);
    expect(r.wellDownIsAuthoritative).toBe(true);
    expect(backendNextIsDown({ existingIsDown: false, packetWellDown: r.wellDown, packetWellDownIsAuthoritative: r.wellDownIsAuthoritative })).toBe(true);
  });
});

describe('explicit toggle wins over canonical (stale-state / reset ordering)', () => {
  test('touched false beats canonical down (the driver uncheck is never clobbered)', () => {
    expect(resolveWellDownForSubmit({ canonicalIsDown: true, checkboxWellDown: false, touched: true }).wellDown).toBe(false);
  });
  test('touched true beats canonical online', () => {
    expect(resolveWellDownForSubmit({ canonicalIsDown: false, checkboxWellDown: true, touched: true }).wellDown).toBe(true);
  });
});

describe('server fails CLOSED on a missing/non-boolean wellDown', () => {
  test('authoritative:true but wellDown undefined does NOT flip status', () => {
    expect(backendNextIsDown({ existingIsDown: true, packetWellDown: undefined, packetWellDownIsAuthoritative: true })).toBe(true);
    expect(backendNextIsDown({ existingIsDown: false, packetWellDown: undefined, packetWellDownIsAuthoritative: true })).toBe(false);
  });
  test('a stringified "false" is not a boolean and does not flip status', () => {
    expect(backendNextIsDown({ existingIsDown: true, packetWellDown: 'false', packetWellDownIsAuthoritative: true })).toBe(true);
  });
  test('the WB-M builder emits an explicit boolean and honors an explicit false authority flag', () => {
    expect(typeof buildPacket(false).wellDown).toBe('boolean');
    expect(buildPacket(false).wellDown).toBe(false);
    expect(buildPacket(true, false).wellDownIsAuthoritative).toBe(false); // untouched authority survives the builder
    expect(buildPacket(true).wellDownIsAuthoritative).toBe(true);         // default asserts authority
  });
});

describe('status resolution is independent of numeric parsing', () => {
  test('resolution is a pure function of the three status inputs (no level/bbl involvement)', () => {
    const a = resolveWellDownForSubmit({ canonicalIsDown: true, checkboxWellDown: false, touched: true });
    const b = resolveWellDownForSubmit({ canonicalIsDown: true, checkboxWellDown: false, touched: true });
    expect(a).toEqual(b);
    expect(a.wellDown).toBe(false);
  });
  test('level + bbls + wellDown ride ONE packet (status + level never split into partial success)', () => {
    const packet = buildPacket(false, true);
    expect(packet).toHaveProperty('wellDown', false);
    expect(packet).toHaveProperty('wellDownIsAuthoritative', true);
    expect(packet).toHaveProperty('tankLevelFeet');
    expect(packet).toHaveProperty('bblsTaken');
  });
});
