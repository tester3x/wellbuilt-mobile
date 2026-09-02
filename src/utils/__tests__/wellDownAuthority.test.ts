// Authoritative Well Down resolution + backend-parity proofs.
//
// These lock the required Record Load semantics for the "Well Down -> Online"
// (and Online -> Down) authoritative status transition:
//   - explicit down->online sends wellDown:false + authoritative:true
//   - explicit online->down sends wellDown:true + authoritative:true
//   - an UNTOUCHED box preserves canonical status (no manufactured transition)
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
const buildPacket = (wellDown: boolean) =>
  buildWbmPullCommand({
    packetId: PID,
    wellName: 'Thor 1',
    dateTime: '8/30/2026 3PM',
    dateTimeUTC: '2026-08-30T20:00:00.000Z',
    timezone: 'America/Chicago',
    tankLevelFeet: 136 / 12,
    bblsTaken: 140,
    wellDown,
  });

describe('resolveWellDownForSubmit — explicit transitions', () => {
  test('down -> online (driver unchecks a down well) sends wellDown:false + authoritative:true', () => {
    const r = resolveWellDownForSubmit({
      canonicalIsDown: true,     // well began down
      checkboxWellDown: false,   // driver unchecked
      touched: true,             // explicit toggle
    });
    expect(r.wellDown).toBe(false);
    expect(r.wellDownIsAuthoritative).toBe(true);

    // And the packet the builder emits carries the explicit false + authority,
    // which the server turns into an ONLINE well (down -> online delivered).
    const packet = buildPacket(r.wellDown);
    expect(packet.wellDown).toBe(false);
    expect(packet.wellDownIsAuthoritative).toBe(true);
    expect(
      backendNextIsDown({
        existingIsDown: true,
        packetWellDown: packet.wellDown,
        packetWellDownIsAuthoritative: packet.wellDownIsAuthoritative,
      }),
    ).toBe(false); // now online
  });

  test('online -> down (driver checks an online well) sends wellDown:true + authoritative:true', () => {
    const r = resolveWellDownForSubmit({
      canonicalIsDown: false,
      checkboxWellDown: true,
      touched: true,
    });
    expect(r.wellDown).toBe(true);
    expect(r.wellDownIsAuthoritative).toBe(true);

    const packet = buildPacket(r.wellDown);
    expect(
      backendNextIsDown({
        existingIsDown: false,
        packetWellDown: packet.wellDown,
        packetWellDownIsAuthoritative: packet.wellDownIsAuthoritative,
      }),
    ).toBe(true); // now down
  });
});

describe('resolveWellDownForSubmit — untouched preserves canonical (no manufactured transition)', () => {
  test('untouched down well stays down at the server', () => {
    const r = resolveWellDownForSubmit({
      canonicalIsDown: true,
      checkboxWellDown: true, // seeded from canonical, never toggled
      touched: false,
    });
    expect(r.wellDown).toBe(true); // canonical value re-sent
    // Server sees existing=true, packet=true -> nextIsDown === existing (no change).
    expect(
      backendNextIsDown({
        existingIsDown: true,
        packetWellDown: r.wellDown,
        packetWellDownIsAuthoritative: r.wellDownIsAuthoritative,
      }),
    ).toBe(true);
  });

  test('untouched online well stays online at the server', () => {
    const r = resolveWellDownForSubmit({
      canonicalIsDown: false,
      checkboxWellDown: false,
      touched: false,
    });
    expect(r.wellDown).toBe(false);
    expect(
      backendNextIsDown({
        existingIsDown: false,
        packetWellDown: r.wellDown,
        packetWellDownIsAuthoritative: r.wellDownIsAuthoritative,
      }),
    ).toBe(false);
  });

  test('untouched submit ignores a not-yet-seeded checkbox (async-seed race): uses canonical', () => {
    // Well is down canonically, but the async snapshot seed has NOT yet flipped
    // the checkbox to checked. An untouched submit must still preserve DOWN.
    const r = resolveWellDownForSubmit({
      canonicalIsDown: true,
      checkboxWellDown: false, // checkbox not seeded yet
      touched: false,
    });
    expect(r.wellDown).toBe(true); // canonical wins, NOT the racy false
    expect(
      backendNextIsDown({
        existingIsDown: true,
        packetWellDown: r.wellDown,
        packetWellDownIsAuthoritative: r.wellDownIsAuthoritative,
      }),
    ).toBe(true); // no manufactured down->online
  });
});

describe('explicit toggle wins over canonical (stale-state / reset ordering)', () => {
  test('touched false beats canonical down (the driver uncheck is never clobbered)', () => {
    // Even if canonical still reads down (stale) and the checkbox seed would
    // re-check the box, an explicit uncheck must survive to the packet.
    const r = resolveWellDownForSubmit({
      canonicalIsDown: true,
      checkboxWellDown: false,
      touched: true,
    });
    expect(r.wellDown).toBe(false);
  });

  test('touched true beats canonical online', () => {
    const r = resolveWellDownForSubmit({
      canonicalIsDown: false,
      checkboxWellDown: true,
      touched: true,
    });
    expect(r.wellDown).toBe(true);
  });
});

describe('server fails CLOSED on a missing/non-boolean wellDown', () => {
  test('authoritative:true but wellDown undefined does NOT flip status', () => {
    expect(
      backendNextIsDown({
        existingIsDown: true,
        packetWellDown: undefined,
        packetWellDownIsAuthoritative: true,
      }),
    ).toBe(true); // preserved (a lost boolean can never manufacture a transition)
    expect(
      backendNextIsDown({
        existingIsDown: false,
        packetWellDown: undefined,
        packetWellDownIsAuthoritative: true,
      }),
    ).toBe(false);
  });

  test('a stringified "false" is not a boolean and does not flip status', () => {
    expect(
      backendNextIsDown({
        existingIsDown: true,
        packetWellDown: 'false',
        packetWellDownIsAuthoritative: true,
      }),
    ).toBe(true); // preserved — only a real boolean is authoritative
  });

  test('the WB-M builder always emits an explicit boolean (never undefined), so it never fails closed', () => {
    expect(typeof buildPacket(false).wellDown).toBe('boolean');
    expect(typeof buildPacket(true).wellDown).toBe('boolean');
    expect(buildPacket(false).wellDown).toBe(false); // explicit false preserved through construction
  });
});

describe('status resolution is independent of numeric parsing', () => {
  test('resolution is a pure function of the three status inputs (no level/bbl involvement)', () => {
    // The helper has no numeric parameter — a status-only transition cannot be
    // suppressed by an unparseable/zero level or bbl value.
    const a = resolveWellDownForSubmit({ canonicalIsDown: true, checkboxWellDown: false, touched: true });
    const b = resolveWellDownForSubmit({ canonicalIsDown: true, checkboxWellDown: false, touched: true });
    expect(a).toEqual(b);
    expect(a.wellDown).toBe(false);
  });

  test('level + bbls + wellDown ride ONE packet (status + level never split into partial success)', () => {
    const packet = buildPacket(false);
    // A single atomic command object carries all three; there is no separate
    // status-only vs level-only submission that could partially succeed.
    expect(packet).toHaveProperty('wellDown', false);
    expect(packet).toHaveProperty('wellDownIsAuthoritative', true);
    expect(packet).toHaveProperty('tankLevelFeet');
    expect(packet).toHaveProperty('bblsTaken');
  });
});
