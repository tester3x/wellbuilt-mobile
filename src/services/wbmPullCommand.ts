/**
 * Pure projection of a WB-M governed CREATE (pull) command — the exact packet
 * ingestWbmPull expects. Extracted from uploadTankPacket so it is testable and
 * so the cross-repo contract fixture is generated from the REAL builder. The
 * driver identity is NOT part of the client packet (the server stamps it).
 *
 * wellDown is sent as an EXPLICIT boolean. `wellDownIsAuthoritative` says whether
 * THIS pull asserts the well's down/up state:
 *   • true  — the driver explicitly set the checkbox (or a caller asserts status).
 *             The server flips wells/{name}/status/isDown to `wellDown`.
 *   • false — the checkbox was never touched (seeded display state only). The
 *             server PRESERVES its current canonical status regardless of the
 *             seeded `wellDown` carried for display — so a status change made
 *             while the form was open is never overwritten by a stale seed.
 * Defaults to true for back-compat (an unspecified caller is asserting status).
 * The server accepts the flag as an optional boolean (wbmPullAuthorize) and
 * changes status ONLY when it is true AND wellDown is an explicit boolean.
 */
export type WbmPullCommandInput = {
  packetId: string;
  wellName: string;
  dateTime: string;
  dateTimeUTC: string;
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown: boolean;
  /** Whether this pull asserts well-status authority. Omitted ⇒ true. An
   *  untouched Record-Load checkbox passes false so the seeded value is display
   *  only and the server preserves canonical status. */
  wellDownIsAuthoritative?: boolean;
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
    // Explicit authority: true unless the caller passes false (untouched box).
    // Never truthiness — false is a load-bearing explicit value.
    wellDownIsAuthoritative: input.wellDownIsAuthoritative !== false,
  };
  if (input.predictedLevelInches !== undefined) packet.predictedLevelInches = input.predictedLevelInches;
  return packet;
}
