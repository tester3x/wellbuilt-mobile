/** Secure operational callables dual-run for WB-M. */
const CALLABLE_BASE = 'https://us-central1-wellbuilt-sync.cloudfunctions.net';

async function callCallable<T>(name: string, data: Record<string, unknown>): Promise<T> {
  const resp = await fetch(`${CALLABLE_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || body.error) {
    throw new Error(body?.error?.message || `Callable ${name} failed (${resp.status})`);
  }
  return body.result as T;
}

export async function secureIngestPacket(
  packet: Record<string, unknown>,
  driverHash?: string,
) {
  return callCallable<{ ok: boolean; key: string; duplicate?: boolean }>('ingestDriverPacket', {
    packet,
    driverHash,
  });
}
