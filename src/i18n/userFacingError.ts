/**
 * Map raw provider/network errors to safe localized UI messages.
 * Raw strings remain available for console/debug only.
 */

export type UserFacingErrorKind =
  | 'network'
  | 'server'
  | 'timeout'
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
  if (err && typeof err === 'object' && (err as any).name === 'AbortError') return 'timeout';
  if (/timeout|timed out|aborted/i.test(msg)) return 'timeout';
  if (
    err && typeof err === 'object' && (err as any).name === 'FeatureUnavailableError'
  ) {
    return 'updateRequired';
  }
  if (/update_required|feature_unavailable|update required/i.test(msg)) return 'updateRequired';
  if (/network|offline|failed to fetch|unreachable|econnrefused|enetunreach/i.test(msg)) {
    return 'network';
  }
  if (/firebase (get|put|delete) failed|http\s*[45]\d\d|status\)|internal server/i.test(msg)) {
    if (/put|delete|write|save/i.test(msg)) return 'firebaseWrite';
    if (/get|load|read|fetch/i.test(msg)) return 'firebaseRead';
    return 'server';
  }
  if (/[45]\d\d/.test(msg) || /server error/i.test(msg)) return 'server';
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
