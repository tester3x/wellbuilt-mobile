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
   *  literal `editEventId` field the governed backend demands, and is also the
   *  command's idempotencyKey. There is no legacy-key fallback — a correction
   *  without a valid editEventId fails closed. */
  editEventId?: string;
  /** Immutable creation instant of THIS correction (offset-aware ISO). Stamped
   *  ONCE when the driver submits and preserved verbatim across every retry —
   *  it is the correction's event time, distinct from the pull's business time.
   *  Required by the governed v2 producer (correctionCreatedAtUTC). */
  correctionCreatedAtUTC?: string;
  /** Deterministic CHANGED-ONLY mask from finalizeEdit (canonical wire names).
   *  When present it REPLACES the always-on assertion mask so the trail records
   *  only what the driver actually changed. Absent → legacy assertion mask. */
  editedFieldsOverride?: string[];
  /** Well-Down authority (edit path): true only when the driver explicitly
   *  changed Well-Down. Untouched → false so the server preserves canonical. */
  wellDownIsAuthoritative?: boolean;
};

/** Governed v2 producer contract (evaluateWbmEdit). */
export const GOVERNED_EDIT_SCHEMA_VERSION = 2 as const;

/**
 * Historical deterministic key. RETAINED only so genuinely-legacy stored
 * operations can still correlate their old receipts; it is NEVER used to build
 * a new governed command (which requires a literal editEventId).
 */
export function wbmEditIdempotencyKey(originalPacketTimestamp: string, wellName: string): string {
  const ts = originalPacketTimestamp.slice(0, 15);
  return `edit_${ts}_${wellName.replace(/\s+/g, '')}`;
}

/** Governed backends require an 8–128 char, firebase-key-safe id. */
const KEY_UNSAFE = /[.#$\[\]/]/;
export function isValidEditEventId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 8 && id.length <= 128 && !KEY_UNSAFE.test(id);
}

/**
 * Build the governed v2 edit command (evaluateWbmEdit contract). The WB-M edit
 * screen carries the Well Down control, so this command ALWAYS makes an explicit
 * final-state assertion for the driver-editable fields — tankLevelFeet, bblsTaken
 * and wellDown are declared in editedFields and carried as explicit values. The
 * `wellDown` boolean is sent verbatim (never omitted just because it equals a
 * possibly-stale processed value — the Thor 1 incident had processed.wellDown=false
 * while live status was DOWN, so the repair MUST be asserted). Operational time
 * (dateTimeUTC/dateTime) is declared only when the driver actually set it.
 *
 * editedFields is built explicitly (never from truthiness): well-status intent is
 * an assertion, not an inference.
 */
export function buildWbmEditCommand(input: WbmEditCommandInput): Record<string, unknown> {
  // Fail closed: a governed correction MUST carry its literal editEventId and a
  // stable creation instant. No legacy-identity fallback — a malformed
  // correction is rejected, not guessed.
  if (!isValidEditEventId(input.editEventId)) {
    throw new Error('edit_event_id_required');
  }
  if (input.editEventId === input.originalPacketId) {
    throw new Error('edit_event_id_collides_with_original');
  }
  const correctionCreatedAtUTC = (input.correctionCreatedAtUTC || '').trim();
  if (!correctionCreatedAtUTC || Number.isNaN(Date.parse(correctionCreatedAtUTC))) {
    throw new Error('correction_created_at_required');
  }
  const editEventId = input.editEventId;
  const dateTimeUTC = (input.dateTimeUTC || '').trim();
  const dateTime = (input.dateTime || '').trim();

  // Field mask. Prefer the deterministic CHANGED-ONLY mask from finalizeEdit; it
  // records exactly what the driver altered. Only when it is absent (legacy op /
  // recovery of a pre-finalize operation) fall back to the always-on assertion
  // mask so the edit still applies. A valid override must be non-empty.
  const override = Array.isArray(input.editedFieldsOverride)
    ? input.editedFieldsOverride.filter((f) => typeof f === 'string' && f.length > 0)
    : null;
  let editedFields: string[];
  if (override && override.length > 0) {
    editedFields = Array.from(new Set(override));
  } else {
    editedFields = ['tankLevelFeet', 'bblsTaken', 'wellDown'];
    if (dateTimeUTC) editedFields.push('dateTimeUTC');
    if (dateTime) editedFields.push('dateTime');
  }

  const packet: Record<string, unknown> = {
    requestType: 'edit',
    schemaVersion: GOVERNED_EDIT_SCHEMA_VERSION,
    editedFields,
    wellName: input.wellName,
    originalPacketId: input.originalPacketId,
    packetId: input.originalPacketId,
    editEventId,                 // literal identity field the backend requires
    idempotencyKey: editEventId, // idempotencyKey === editEventId (per-correction)
    correctionCreatedAtUTC,      // immutable event time, preserved across retries
    tankLevelFeet: input.tankLevelFeet,
    bblsTaken: input.bblsTaken,
    wellDown: input.wellDown === true, // explicit final-state boolean, never omitted
  };
  // Well-Down authority: default true (assertion) unless finalize marked the
  // untouched checkbox non-authoritative, so the server preserves canonical.
  if (input.wellDownIsAuthoritative === false) packet.wellDownIsAuthoritative = false;
  if (dateTimeUTC) packet.dateTimeUTC = dateTimeUTC;
  if (dateTime) packet.dateTime = dateTime;
  if (input.timezone) packet.timezone = input.timezone;
  return packet;
}

export function commandOmitsOperationalTime(packet: Record<string, unknown>): boolean {
  return packet.dateTimeUTC === undefined && packet.dateTime === undefined;
}
