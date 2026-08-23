/**
 * Client projection of a WB-M edit command. Empty operational time is
 * omitted so processEditRequest preserves the original pull time.
 * Never substitutes retry/queue/device "now".
 */

export type WbmEditCommandInput = {
  originalPacketTimestamp: string;
  originalPacketId: string;
  wellName: string;
  dateTime: string;
  dateTimeUTC: string;
  tankLevelFeet: number;
  bblsTaken: number;
  wellDown: boolean;
  timezone?: string;
};

export function wbmEditIdempotencyKey(originalPacketTimestamp: string, wellName: string): string {
  const ts = originalPacketTimestamp.slice(0, 15);
  return `edit_${ts}_${wellName.replace(/\s+/g, '')}`;
}

export function buildWbmEditCommand(input: WbmEditCommandInput): Record<string, unknown> {
  const packet: Record<string, unknown> = {
    requestType: 'edit',
    wellName: input.wellName,
    originalPacketId: input.originalPacketId,
    packetId: input.originalPacketId,
    tankLevelFeet: input.tankLevelFeet,
    bblsTaken: input.bblsTaken,
    wellDown: input.wellDown === true,
    idempotencyKey: wbmEditIdempotencyKey(input.originalPacketTimestamp, input.wellName),
  };
  const dateTimeUTC = (input.dateTimeUTC || '').trim();
  const dateTime = (input.dateTime || '').trim();
  if (dateTimeUTC) packet.dateTimeUTC = dateTimeUTC;
  if (dateTime) packet.dateTime = dateTime;
  if (input.timezone) packet.timezone = input.timezone;
  return packet;
}

export function commandOmitsOperationalTime(packet: Record<string, unknown>): boolean {
  return packet.dateTimeUTC === undefined && packet.dateTime === undefined;
}
