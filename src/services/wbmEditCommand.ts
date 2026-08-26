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
  /** This correction's unique event identity. It is REQUIRED: it is sent as the
   *  literal `editEventId` field the governed backend (36d37e5) demands, and is
   *  also the command's idempotencyKey. There is no legacy-key fallback — a
   *  correction without a valid editEventId fails closed. */
  editEventId?: string;
};

/**
 * Historical deterministic key. RETAINED only so genuinely-legacy stored
 * operations can still correlate their old receipts; it is NEVER used to build
 * a new governed command (which requires a literal editEventId).
 */
export function wbmEditIdempotencyKey(originalPacketTimestamp: string, wellName: string): string {
  const ts = originalPacketTimestamp.slice(0, 15);
  return `edit_${ts}_${wellName.replace(/\s+/g, '')}`;
}

/** Governed backends (36d37e5) require an 8–128 char, firebase-key-safe id. */
const KEY_UNSAFE = /[.#$\[\]/]/;
export function isValidEditEventId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 8 && id.length <= 128 && !KEY_UNSAFE.test(id);
}

/**
 * Build the exact governed edit command for backend 36d37e5. Emits ONLY
 * allowlisted fields: requestType, wellName, originalPacketId, packetId,
 * editEventId, idempotencyKey, tankLevelFeet, bblsTaken, wellDown, and the
 * optional dateTimeUTC / dateTime / timezone. No schemaVersion, editedFields or
 * correctionCreatedAtUTC (those belong to a rejected parallel engine).
 */
export function buildWbmEditCommand(input: WbmEditCommandInput): Record<string, unknown> {
  // Fail closed: a governed correction MUST carry its literal editEventId. No
  // legacy-identity fallback — a malformed correction is rejected, not guessed.
  if (!isValidEditEventId(input.editEventId)) {
    throw new Error('edit_event_id_required');
  }
  if (input.editEventId === input.originalPacketId) {
    throw new Error('edit_event_id_collides_with_original');
  }
  const editEventId = input.editEventId;
  const packet: Record<string, unknown> = {
    requestType: 'edit',
    wellName: input.wellName,
    originalPacketId: input.originalPacketId,
    packetId: input.originalPacketId,
    editEventId,                 // literal identity field the backend requires
    idempotencyKey: editEventId, // idempotencyKey === editEventId
    tankLevelFeet: input.tankLevelFeet,
    bblsTaken: input.bblsTaken,
    wellDown: input.wellDown === true,
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
