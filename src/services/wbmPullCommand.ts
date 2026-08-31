/**
 * Pure projection of a WB-M governed CREATE (pull) command — the exact packet
 * ingestWbmPull expects. Extracted from uploadTankPacket so it is testable and
 * so the cross-repo contract fixture is generated from the REAL builder. The
 * driver identity is NOT part of the client packet (the server stamps it).
 *
 * wellDown is sent as an EXPLICIT boolean with wellDownIsAuthoritative:true — a
 * WB-M pull is an authoritative statement of the well's down/up state (the same
 * reason the Thor 1 edit fix asserts authority). Explicit false brings a well
 * online; explicit true marks it down; the value is never dropped.
 */
export type WbmPullCommandInput = {
  packetId: string;
  wellName: string;
  dateTime: string;
  dateTimeUTC: string;
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown: boolean;
  timezone: string;
  predictedLevelInches?: number;
};

export function buildWbmPullCommand(input: WbmPullCommandInput): Record<string, unknown> {
  const packet: Record<string, unknown> = {
    packetId: input.packetId,
    idempotencyKey: input.packetId, // governed pull contract: idempotencyKey === packetId
    requestType: 'pull',
    wellName: input.wellName,
    dateTimeUTC: input.dateTimeUTC,
    dateTime: input.dateTime,
    timezone: input.timezone,
    tankLevelFeet: input.tankLevelFeet,
    bblsTaken: input.bblsTaken,
    wellDown: input.wellDown === true, // explicit final-state boolean, never omitted
    wellDownIsAuthoritative: true,     // a WB-M pull is an authoritative well-status assertion
  };
  if (input.predictedLevelInches !== undefined) packet.predictedLevelInches = input.predictedLevelInches;
  return packet;
}
