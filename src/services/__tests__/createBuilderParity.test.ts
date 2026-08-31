// CREATE-builder refactor parity (Thor 1 requirement 3). Extracting
// buildWbmPullCommand out of uploadTankPacket is a LIVE production-path change,
// not just fixture tooling. This test pins a field-by-field MATERIAL diff of the
// CREATE packet between the pre-refactor inline builder (parent d3fa509) and the
// current pure builder, proving the ONLY intentional change is the added
// idempotencyKey (=== packetId) and that nothing else was removed, retyped,
// re-defaulted, or altered — across every wellDown state and predicted-level
// presence. If the builder drifts, this fails.
import { buildWbmPullCommand, WbmPullCommandInput } from '../wbmPullCommand';

// The EXACT pre-refactor packet body, transcribed verbatim from
// git d3fa509:src/services/firebase.ts (uploadTankPacket). Nothing added.
function preRefactorCreatePacket(p: WbmPullCommandInput): Record<string, unknown> {
  return {
    packetId: p.packetId,
    requestType: 'pull',
    wellName: p.wellName,
    dateTimeUTC: p.dateTimeUTC,
    dateTime: p.dateTime,
    timezone: p.timezone,
    tankLevelFeet: p.tankLevelFeet,
    bblsTaken: p.bblsTaken,
    wellDown: (p.wellDown as boolean) || false,      // pre: `wellDown || false`
    wellDownIsAuthoritative: true,
    predictedLevelInches: p.predictedLevelInches ?? undefined,
  };
}

// Representative inputs covering every wellDown state and predicted presence.
const base = { packetId: '20260830_200000_Thor1_crt001', wellName: 'Thor 1', dateTime: '8/30/2026 3PM', dateTimeUTC: '2026-08-30T20:00:00.000Z', timezone: 'America/Chicago', tankLevelFeet: 136 / 12, bblsTaken: 140 };
const CASES: WbmPullCommandInput[] = [
  { ...base, wellDown: false },
  { ...base, wellDown: true },
  { ...base, wellDown: undefined as unknown as boolean },   // omitted at the call site
  { ...base, wellDown: false, predictedLevelInches: 52 },
];

// JSON-normalize (Firebase/RTDB drops `undefined` on the wire, so an
// `undefined`-valued key and an absent key are materially identical).
const wire = (o: Record<string, unknown>) => JSON.parse(JSON.stringify(o));

describe('CREATE builder parity (pre-refactor inline ↔ current pure builder)', () => {
  it.each(CASES)('is materially identical except the added idempotencyKey (%#)', (input) => {
    const before = preRefactorCreatePacket(input);
    const after = buildWbmPullCommand(input);

    // 1. The ONE intentional addition: idempotencyKey, equal to packetId.
    expect(after.idempotencyKey).toBe(input.packetId);
    expect(before).not.toHaveProperty('idempotencyKey');

    // 2. Every other field is byte/material identical on the wire.
    const { idempotencyKey, ...afterRest } = after as Record<string, unknown>;
    void idempotencyKey;
    expect(wire(afterRest)).toEqual(wire(before));

    // 3. No field REMOVED (every pre-refactor key still present on the wire).
    for (const k of Object.keys(wire(before))) expect(wire(after)).toHaveProperty(k);

    // 4. No TYPE changed on the shared fields.
    for (const k of Object.keys(wire(before))) {
      expect(typeof (wire(after) as any)[k]).toBe(typeof (wire(before) as any)[k]);
    }
  });

  it('wellDown is materially unchanged for every state (no authority/default change)', () => {
    for (const input of CASES) {
      const before = preRefactorCreatePacket(input);
      const after = buildWbmPullCommand(input);
      expect(after.wellDown).toBe(before.wellDown);              // identical boolean
      expect(after.wellDownIsAuthoritative).toBe(true);          // authority preserved
      expect(before.wellDownIsAuthoritative).toBe(true);
    }
  });

  it('preserves packetId, identity-free body, and requestType (no identity/type change)', () => {
    const after = buildWbmPullCommand(CASES[0]);
    expect(after.packetId).toBe(CASES[0].packetId);              // packetId unchanged
    expect(after.requestType).toBe('pull');                      // request type unchanged
    // driver/company/well identity is NOT part of the client CREATE body (server
    // stamps driver/company); the well name is the only identity and is verbatim.
    expect(after.wellName).toBe('Thor 1');
    expect(after).not.toHaveProperty('driverId');
    expect(after).not.toHaveProperty('companyId');
    // dateTime precision preserved verbatim (no reformatting).
    expect(after.dateTimeUTC).toBe(CASES[0].dateTimeUTC);
    expect(after.dateTime).toBe(CASES[0].dateTime);
  });
});
