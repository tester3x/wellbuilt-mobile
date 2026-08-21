/** Authenticated operational callables. No legacy hash. No public RTDB fallback. */
import { authorizedCallable } from './firebaseAuthSession';

export async function secureIngestPacket(packet: Record<string, unknown>) {
  return authorizedCallable<{ ok: boolean; packetId: string; duplicate?: boolean }>(
    'submitFieldCommand',
    { ...packet, requestType: packet.requestType || 'pull' },
  );
}

export async function secureSubmitFieldCommand(packet: Record<string, unknown>) {
  return authorizedCallable<{
    ok: boolean;
    packetId: string;
    duplicate?: boolean;
    committed?: boolean;
    receiptKey?: string;
    status?: string;
  }>(
    'submitFieldCommand',
    packet,
  );
}

/** Receipt lookup for a previously submitted field command. */
export async function getFieldCommandStatus(query: {
  packetId?: string;
  idempotencyKey?: string;
  receiptKey?: string;
}) {
  return authorizedCallable<{
    status?: string;
    committed?: boolean;
    receiptKey?: string;
  }>('getFieldCommandStatus', query);
}
