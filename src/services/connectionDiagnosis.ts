/**
 * Classify backend / session failures for truthful UI.
 * Never treats auth, permission, or malformed local state as "no internet".
 * Codes are diagnostic only — no tokens, names, or secrets.
 */

export type ConnectionKind =
  | 'ok'
  | 'no_network'
  | 'timeout'
  | 'unreachable'
  | 'auth_session'
  | 'permission'
  | 'server_rejection'
  | 'malformed'
  | 'retryable'
  | 'dependency_blocked'
  | 'server';

export interface ConnectionDiagnosis {
  kind: ConnectionKind;
  /** Stable machine code for logs and Sync Status — never a secret. */
  code: string;
  retryable: boolean;
}

export const CONNECTION_I18N_KEY: Record<ConnectionKind, string> = {
  ok: 'errors.unknown',
  no_network: 'errors.noNetwork',
  timeout: 'errors.timeout',
  unreachable: 'errors.unreachable',
  auth_session: 'errors.authSession',
  permission: 'errors.permission',
  server_rejection: 'errors.serverRejection',
  malformed: 'errors.malformed',
  retryable: 'errors.retryableQueued',
  dependency_blocked: 'errors.dependencyBlocked',
  server: 'errors.server',
};

function msgOf(err: unknown): string {
  if (err instanceof Error) return err.message || '';
  if (typeof err === 'string') return err;
  return '';
}

function nameOf(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    return String((err as { name?: unknown }).name || '');
  }
  return '';
}

export function diagnoseThrown(err: unknown): ConnectionDiagnosis {
  const name = nameOf(err);
  const msg = msgOf(err);

  if (name === 'AbortError' || /timeout|timed out|aborted/i.test(msg)) {
    return { kind: 'timeout', code: 'timeout', retryable: true };
  }
  if (name === 'AuthSessionError' || /id_token_required|auth_session|expired|revoked|refresh_failed/i.test(msg)) {
    const code = /expired/i.test(msg) ? 'auth_expired'
      : /revoked/i.test(msg) ? 'auth_revoked'
        : /refresh_failed/i.test(msg) ? 'auth_refresh_failed'
          : /id_token_required|missing/i.test(msg) ? 'auth_missing'
            : 'auth_session';
    return { kind: 'auth_session', code, retryable: false };
  }
  if (/permission_denied|permission denied|not authorized|insufficient/i.test(msg) || /http_403|status 403/i.test(msg)) {
    return { kind: 'permission', code: 'permission_denied', retryable: false };
  }
  if (/malformed|invalid packet|invalid payload|cannot reconstruct/i.test(msg)) {
    return { kind: 'malformed', code: 'malformed_local', retryable: false };
  }
  if (/no network|not connected|offline|network request failed|failed to fetch|enetunreach|econnrefused/i.test(msg)) {
    if (/offline/i.test(msg) && /queue/i.test(msg)) {
      return { kind: 'retryable', code: 'queued_retryable', retryable: true };
    }
    return { kind: 'no_network', code: 'no_network', retryable: true };
  }
  if (/unreachable|cannot reach|enotfound|dns/i.test(msg)) {
    return { kind: 'unreachable', code: 'unreachable', retryable: true };
  }
  // Pull EDIT ingest is not a deployed capability yet. The endpoint cannot
  // accept edits, so retrying can never succeed — this is a backend DEPENDENCY
  // gap, not a transient failure and not a driver-fixable error. Park it under
  // its existing identity until the governed edit capability (ingestWbmEdit)
  // exists; no auto-retry, no driver Retry button, no driver-attention banner.
  if (/unsupported_field_command/i.test(msg)) {
    return { kind: 'dependency_blocked', code: 'edit_unsupported', retryable: false };
  }
  if (/functions\/invalid-argument|invalid-argument|missing_original|forged_well|idempotency_key_mismatch|invalid_bblsTaken|invalid_tankLevelFeet/i.test(msg)) {
    return { kind: 'malformed', code: 'invalid_edit', retryable: false };
  }
  if (/functions\/permission-denied|cross_driver|cross_company|well_out_of_scope|forged_well/i.test(msg)) {
    return { kind: 'permission', code: 'edit_unauthorized', retryable: false };
  }
  if (/rejected by server|quarantine/i.test(msg)) {
    return { kind: 'server_rejection', code: 'server_rejection', retryable: false };
  }
  if (/\b401\b/.test(msg)) {
    return { kind: 'auth_session', code: 'http_401', retryable: false };
  }
  if (/\b403\b/.test(msg)) {
    return { kind: 'permission', code: 'http_403', retryable: false };
  }
  if (/\b5\d\d\b/.test(msg) || /internal server/i.test(msg)) {
    return { kind: 'server', code: 'http_5xx', retryable: true };
  }
  return { kind: 'retryable', code: 'unclassified', retryable: true };
}

export function diagnoseHttpStatus(status: number): ConnectionDiagnosis {
  if (status === 401) return { kind: 'auth_session', code: 'http_401', retryable: false };
  if (status === 403) return { kind: 'permission', code: 'http_403', retryable: false };
  if (status === 404) return { kind: 'ok', code: 'http_404', retryable: false };
  if (status >= 500) return { kind: 'server', code: `http_${status}`, retryable: true };
  if (status === 0) return { kind: 'unreachable', code: 'http_0', retryable: true };
  return { kind: 'server', code: `http_${status}`, retryable: true };
}

export function diagnoseNetInfo(state: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}): ConnectionDiagnosis | null {
  if (state.isConnected === false) {
    return { kind: 'no_network', code: 'netinfo_disconnected', retryable: true };
  }
  if (state.isInternetReachable === false) {
    return { kind: 'no_network', code: 'netinfo_unreachable', retryable: true };
  }
  return null;
}

/** Compact, secret-free line for Sync Status / logs. */
export function formatDiagnosis(d: ConnectionDiagnosis, detail?: string): string {
  const extra = detail && !/bearer|token|passcode|password|authorization/i.test(detail)
    ? `: ${detail.slice(0, 120)}`
    : '';
  return `${d.kind} [${d.code}]${extra}`;
}
