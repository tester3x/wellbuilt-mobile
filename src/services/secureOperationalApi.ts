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
  return authorizedCallable<{ ok: boolean; key?: string; packetId?: string; duplicate?: boolean }>(
    'ingestWbmPull',
    { packet },
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

/** Receipt lookup is not a deployed production callable. */
export async function getFieldCommandStatus(_query: {
  packetId?: string;
  idempotencyKey?: string;
  receiptKey?: string;
}): Promise<never> {
  unsupportedFieldCommand('getFieldCommandStatus');
}
