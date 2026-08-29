// ingestRefusal.ts — classify a failed authenticated ingest attempt (Phase 4).
//
// The 2026-08-28 audit found a queued submission refused with HTTP 400 on
// every flush, retrying forever and indistinguishable on the device from
// "awaiting server". The server now returns a STABLE reason code in the
// callable error; this module decides what the queue does with a failure:
//
//   permanent  → the server deterministically refuses THIS payload
//                (validation, authorization, precondition). Retrying can
//                never succeed — the packet is parked as a retained
//                rejected record WITH its reason. Intent never disappears:
//                the payload copy is kept and the history row shows why.
//   transient  → network, server unavailability, throttling, or auth-token
//                expiry. The packet stays queued on the capped backoff.
//
// Unknown shapes classify as TRANSIENT — when in doubt keep retrying;
// wrongly parking a deliverable packet is worse than a few spare attempts.

export type IngestFailureClass =
  | { kind: 'permanent'; reason: string }
  | { kind: 'transient'; reason: string };

/** Callable-protocol statuses that mean "this exact request can never succeed". */
const PERMANENT_STATUSES = new Set([
  'INVALID_ARGUMENT',
  'FAILED_PRECONDITION',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'OUT_OF_RANGE',
]);

/** HTTP statuses that are permanent when no protocol status is available. */
const PERMANENT_HTTP = new Set([400, 403, 404]);

export function classifyIngestFailure(err: unknown): IngestFailureClass {
  const e = (err ?? {}) as {
    message?: unknown;
    callableStatus?: unknown;
    httpStatus?: unknown;
  };
  const reason = typeof e.message === 'string' && e.message.trim()
    ? e.message.trim().slice(0, 120)
    : 'unknown_error';

  const status = typeof e.callableStatus === 'string' ? e.callableStatus.toUpperCase() : null;
  if (status) {
    return PERMANENT_STATUSES.has(status)
      ? { kind: 'permanent', reason }
      : { kind: 'transient', reason };
  }

  const http = typeof e.httpStatus === 'number' ? e.httpStatus : null;
  if (http != null) {
    return PERMANENT_HTTP.has(http)
      ? { kind: 'permanent', reason }
      : { kind: 'transient', reason }; // 401 (token refresh), 429, 5xx — retry
  }

  return { kind: 'transient', reason };
}
