import { evaluateSsoLogout, normalizeLogoutAt } from '../ssoLogout';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Suite-owned SSO logout', () => {
  const verified = Date.parse('2026-08-21T17:00:00.000Z');
  const newer = Date.parse('2026-08-21T18:00:00.000Z');
  const older = Date.parse('2026-08-21T16:00:00.000Z');

  it('newer canonical logout logs out an SSO session', () => {
    expect(evaluateSsoLogout({
      authMethod: 'sso',
      verifiedAtMs: verified,
      liveLogoutAtMs: newer,
    })).toBe('logout');
  });

  it('older logout does not log out', () => {
    expect(evaluateSsoLogout({
      authMethod: 'sso',
      verifiedAtMs: verified,
      liveLogoutAtMs: older,
    })).toBe('keep');
  });

  it('manual login ignores the Suite logout', () => {
    expect(evaluateSsoLogout({
      authMethod: 'manual',
      verifiedAtMs: verified,
      liveLogoutAtMs: newer,
    })).toBe('keep');
  });

  it('unavailable live check is keep (caller must not use a cached envelope)', () => {
    expect(evaluateSsoLogout({
      authMethod: 'sso',
      verifiedAtMs: verified,
      liveLogoutAtMs: null,
    })).toBe('keep');
  });

  it('normalizes ISO and epoch logoutAt', () => {
    expect(normalizeLogoutAt('2026-08-21T18:00:00.000Z')).toBe(newer);
    expect(normalizeLogoutAt(newer)).toBe(newer);
    expect(normalizeLogoutAt(null)).toBeNull();
  });

  it('production source does not GET drivers/profiles/{driverId}', () => {
    const layout = readFileSync(join(__dirname, '../../../app/_layout.tsx'), 'utf8');
    const wellConfig = readFileSync(join(__dirname, '../wellConfig.ts'), 'utf8');
    expect(layout).not.toMatch(/drivers\/profiles\/\$\{/);
    expect(layout).toMatch(/bootstrapWbmSession/);
    expect(wellConfig).not.toMatch(/drivers\/profiles\/\$\{/);
  });
});
