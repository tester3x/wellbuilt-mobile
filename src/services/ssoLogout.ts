/**
 * Suite-owned SSO logout. Manual WB-M login ignores Suite logoutAt.
 * Decision uses a LIVE bootstrap logoutAt, never a cached envelope.
 */
export function evaluateSsoLogout(input: {
  authMethod: string | null;
  verifiedAtMs: number | null;
  liveLogoutAtMs: number | null;
}): 'logout' | 'keep' {
  if (input.authMethod !== 'sso') return 'keep';
  if (input.liveLogoutAtMs == null || !Number.isFinite(input.liveLogoutAtMs)) return 'keep';
  if (input.verifiedAtMs == null || !Number.isFinite(input.verifiedAtMs)) return 'keep';
  return input.liveLogoutAtMs > input.verifiedAtMs ? 'logout' : 'keep';
}

export function normalizeLogoutAt(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) return asNum;
  }
  return null;
}
