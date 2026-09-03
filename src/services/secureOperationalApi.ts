/** Authenticated operational callables. No legacy hash. No public RTDB fallback. */
import { authorizedCallable } from './firebaseAuthSession';

function unsupportedFieldCommand(name: string): never {
  const err = new Error(`unsupported_field_command:${name}`);
  (err as { code?: string }).code = 'unsupported_field_command';
  throw err;
}

/**
 * Pull packets only. Dedicated canonical WB-M callable ingestWbmPull.
 * Envelope `{ packet }`. Driver identity is stamped server-side.
 */
export async function secureIngestPacket(packet: Record<string, unknown>) {
  const requestType = typeof packet.requestType === 'string' && packet.requestType
    ? packet.requestType
    : 'pull';
  if (requestType !== 'pull') {
    unsupportedFieldCommand(requestType);
  }
  // clientMeta rides OUTSIDE the packet: refusal logs can attribute the
  // request to a build without the metadata touching packet validation.
  let clientMeta: Record<string, string> | undefined;
  try {
    const { governedClientBuildMeta } = await import('./clientBuildMeta');
    clientMeta = await governedClientBuildMeta() as Record<string, string> | undefined;
  } catch {
    clientMeta = undefined;
  }
  return authorizedCallable<{ ok: boolean; key?: string; packetId?: string; duplicate?: boolean }>(
    'ingestWbmPull',
    clientMeta ? { packet, clientMeta } : { packet },
  );
}

export async function secureIngestEdit(packet: Record<string, unknown>) {
  const requestType = typeof packet.requestType === 'string' ? packet.requestType : '';
  if (requestType !== 'edit') {
    unsupportedFieldCommand(requestType || 'unknown');
  }
  return authorizedCallable<{
    ok: boolean;
    key?: string;
    packetId?: string;
    idempotencyKey?: string;
    duplicate?: boolean;
    queued?: boolean;
    committed?: boolean;
  }>('ingestWbmEdit', { packet });
}

/**
 * Pulls go to ingestWbmPull. Edits go to ingestWbmEdit.
 * History/control commands stay explicitly unavailable.
 */
export async function secureSubmitFieldCommand(packet: Record<string, unknown>): Promise<{
  ok: boolean;
  key?: string;
  packetId?: string;
  duplicate?: boolean;
  queued?: boolean;
  committed?: boolean;
  receiptKey?: string;
  status?: string;
  idempotencyKey?: string;
}> {
  const requestType = typeof packet.requestType === 'string' ? packet.requestType : '';
  if (requestType === 'pull') {
    return secureIngestPacket(packet);
  }
  if (requestType === 'edit') {
    return secureIngestEdit(packet);
  }
  unsupportedFieldCommand(requestType || 'unknown');
}

/** Legacy field-command receipt lookup is not a deployed production callable. */
export async function getFieldCommandStatus(_query: {
  packetId?: string;
  idempotencyKey?: string;
  receiptKey?: string;
}): Promise<never> {
  unsupportedFieldCommand('getFieldCommandStatus');
}

export type WbmEditStatus = 'pending' | 'applied' | 'rejected' | 'missing';

/** Driver-facing changed field on an edit's before→after display. */
export type WbmEditDisplayField = 'topLevelFeet' | 'bblsTaken' | 'wellDown' | 'dateTimeUTC';
export type WbmEditChange = { field: WbmEditDisplayField; before: string | number | boolean | null; after: string | number | boolean | null };
export type WbmEditCorrection = { editEventId: string | null; appliedAtUTC: string | null; correctionCreatedAtUTC: string | null; changes: WbmEditChange[] };
export type WbmEditDisplay = {
  editedAt: string | null;
  /** NET change per field across all corrections (earliest before → latest after). */
  changes: WbmEditChange[];
  /** Every correction, chronological, preserved as evidence. */
  corrections: WbmEditCorrection[];
  /** Fields that changed but whose original before-value is unrecoverable. */
  unavailableBeforeFields: WbmEditDisplayField[];
  correctionCount: number;
  /** false ⇒ no editHistory detail exists (legacy record) — show honestly, never invent. */
  detailAvailable: boolean;
};

/**
 * Governed edit-status for ONE correction + the authoritative before→after
 * DISPLAY for the whole original (all corrections, chronological). Ownership-
 * scoped server-side; server derives BEFORE values from stored packets (never
 * the client's claim). This is the confirmation source AND the History card's
 * before→after data — NOT a direct packets/processed read.
 */
export async function getWbmEditStatus(query: {
  editEventId: string;
  originalPacketId: string;
}): Promise<{ status: WbmEditStatus; reason?: string; edit?: WbmEditDisplay }> {
  return authorizedCallable<{ status: WbmEditStatus; reason?: string; edit?: WbmEditDisplay }>('getWbmEditStatus', {
    editEventId: query.editEventId,
    originalPacketId: query.originalPacketId,
  });
}

export type WbmEditV3SubmitStatus = 'accepted' | 'applying' | 'applied' | 'rejected' | 'retry_wait';

/**
 * THE ordinary-edit transport. Submits a correction to the additive durable lane
 * (`wbmEdits/v3/ops/{editEventId}`). Acceptance is returned only after the op is
 * durably stored; the server worker then applies it and verifies the durable
 * trail before it is `applied`. Idempotent on the op record: the same editEventId
 * + same payload resumes the existing op (never a duplicate); a different payload
 * under the same id is a permanent idempotency conflict. NEVER routes through the
 * legacy `packets/incoming` edit path.
 */
export async function submitWbmEditV3(packet: Record<string, unknown>): Promise<{
  ok: boolean;
  status: WbmEditV3SubmitStatus;
  editEventId?: string;
  idempotent?: boolean;
  reason?: string;
}> {
  const requestType = typeof packet.requestType === 'string' ? packet.requestType : '';
  if (requestType !== 'edit') {
    unsupportedFieldCommand(requestType || 'unknown');
  }
  return authorizedCallable('submitWbmEditV3', { packet });
}

/**
 * Governed recovery for an accepted-but-missing edit. Reuses the correction's
 * EXISTING editEventId + preserved payload (never a new id). Server refuses
 * unless the canary kill switch explicitly allow-lists this exact editEventId,
 * and is idempotent (a claimed/applied edit returns its existing status).
 */
export async function recoverWbmEdit(packet: Record<string, unknown>): Promise<{
  ok: boolean;
  status: WbmEditStatus | 'claimed' | 'refused';
  reason?: string;
  editEventId?: string;
  receiptWritten?: boolean;
  idempotent?: boolean;
}> {
  const requestType = typeof packet.requestType === 'string' ? packet.requestType : '';
  if (requestType !== 'edit') {
    unsupportedFieldCommand(requestType || 'unknown');
  }
  return authorizedCallable('governedRecoverWbmEdit', { packet });
}
