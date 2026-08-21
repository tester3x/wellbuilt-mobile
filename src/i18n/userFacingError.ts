/**
 * Map raw provider/network errors to safe localized UI messages.
 * Raw strings remain available for console/debug only.
 */

export type UserFacingErrorKind =
  | 'network'
  | 'noNetwork'
  | 'server'
  | 'timeout'
  | 'unreachable'
  | 'authSession'
  | 'permission'
  | 'serverRejection'
  | 'malformed'
  | 'retryableQueued'
  | 'firebaseRead'
  | 'firebaseWrite'
  | 'updateRequired'
  | 'unknown';

export function classifyError(err: unknown): UserFacingErrorKind {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : '';
  const name = err && typeof err === 'object' ? String((err as any).name || '') : '';
  if (name === 'AbortError' || /timeout|timed out|aborted/i.test(msg)) return 'timeout';
  if (name === 'FeatureUnavailableError' || /update_required|feature_unavailable|update required/i.test(msg)) {
    return 'updateRequired';
  }
  if (name === 'AuthSessionError' || /id_token_required|auth_session|auth_missing|auth_expired|auth_revoked/i.test(msg)) {
    return 'authSession';
  }
  if (/permission_denied|permission denied|not authorized|http_403|\b403\b/i.test(msg)) {
    return 'permission';
  }
  if (/malformed|invalid packet|invalid payload/i.test(msg)) return 'malformed';
  if (/rejected by server|quarantine|server_rejection/i.test(msg)) return 'serverRejection';
  if (/network request failed|failed to fetch|econnrefused|enetunreach/i.test(msg)) {
    return 'network';
  }
  if (/no network|not connected|offline/i.test(msg)) {
    if (/queue/i.test(msg)) return 'retryableQueued';
    return 'noNetwork';
  }
  if (/unreachable|cannot reach|enotfound|dns/i.test(msg)) return 'unreachable';
  if (/firebase (get|put|delete) failed|http\s*[45]\d\d|status\)|internal server/i.test(msg)) {
    if (/\b401\b/.test(msg)) return 'authSession';
    if (/\b403\b/.test(msg)) return 'permission';
    if (/put|delete|write|save/i.test(msg)) return 'firebaseWrite';
    if (/get|load|read|fetch/i.test(msg)) return 'firebaseRead';
    return 'server';
  }
  if (/[45]\d\d/.test(msg) || /server error/i.test(msg)) return 'server';
  // Keep legacy 'network' for the original generic mapping used by tests
  if (/network/i.test(msg)) return 'network';
  return 'unknown';
}

/**
 * Localized message safe to show in UI. Never returns raw stack/provider text.
 * Prefer passing `t` from useTranslation in components to avoid load order issues.
 */
export function userFacingErrorMessage(
  err: unknown,
  t?: (key: string) => string,
): string {
  const kind = classifyError(err);
  const key = `errors.${kind}`;
  if (t) return t(key);
  try {
    // Lazy require so unit tests of classifyError need not load expo-localization
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const i18n = require('./index').default as { t: (k: string) => string };
    return i18n.t(key);
  } catch {
    return 'Something went wrong. Please try again.';
  }
}
