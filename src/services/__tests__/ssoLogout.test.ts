const mockSecure: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => (k in mockSecure ? mockSecure[k] : null)),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockSecure[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockSecure[k]; }),
}));

const mockCallable = jest.fn();
let mockUser: { uid: string } | null = { uid: 'u' };
jest.mock('../firebaseAuthSession', () => ({
  authorizedCallable: (...args: unknown[]) => mockCallable(...args),
  getFirebaseAuth: () => ({ currentUser: mockUser }),
}));

import {
  checkCanonicalSsoLogout,
  evaluateBoundSsoLogout,
  evaluateSsoLogout,
  normalizeLogoutAt,
  type BoundSsoLogoutCapture,
} from '../ssoLogout';
import { bumpSessionGeneration, resetSessionGenerationForTests } from '../wbmSessionFence';
import { readFileSync } from 'fs';
import { join } from 'path';

const verified = Date.parse('2026-08-21T17:00:00.000Z');
const newer = Date.parse('2026-08-21T18:00:00.000Z');
const older = Date.parse('2026-08-21T16:00:00.000Z');

function captureA(extra: Partial<BoundSsoLogoutCapture> = {}): BoundSsoLogoutCapture {
  return {
    generation: 0,
    driverId: 'driver-a',
    companyId: 'liquid-gold',
    authMethod: 'sso',
    driverVerifiedAt: String(verified),
    ...extra,
  };
}

describe('Suite-owned SSO logout', () => {
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
    const sso = readFileSync(join(__dirname, '../ssoLogout.ts'), 'utf8');
    expect(layout).not.toMatch(/drivers\/profiles\/\$\{/);
    expect(layout).toMatch(/checkCanonicalSsoLogout/);
    expect(sso).toMatch(/bootstrapWbmSession/);
    expect(sso).not.toMatch(/drivers\/profiles\/\$\{/);
    expect(wellConfig).not.toMatch(/drivers\/profiles\/\$\{/);
  });
});

describe('identity-bound live SSO logout', () => {
  const matchingResponse = {
    driverId: 'driver-a',
    companyId: 'liquid-gold',
    logoutAt: newer,
  };

  it('matching live identity with newer logoutAt logs out', () => {
    expect(evaluateBoundSsoLogout({
      capture: captureA(),
      current: captureA(),
      response: matchingResponse,
      hasAuthSession: true,
    })).toBe('logout');
  });

  it('live response driverId differs from the captured session; no logout', () => {
    expect(evaluateBoundSsoLogout({
      capture: captureA(),
      current: captureA(),
      response: { ...matchingResponse, driverId: 'driver-other' },
      hasAuthSession: true,
    })).toBe('keep');
  });

  it('live response companyId differs from the captured session; no logout', () => {
    expect(evaluateBoundSsoLogout({
      capture: captureA(),
      current: captureA(),
      response: { ...matchingResponse, companyId: 'other-co' },
      hasAuthSession: true,
    })).toBe('keep');
  });

  it('missing live driverId, companyId, or logoutAt is keep', () => {
    expect(evaluateBoundSsoLogout({
      capture: captureA(),
      current: captureA(),
      response: { companyId: 'liquid-gold', logoutAt: newer },
      hasAuthSession: true,
    })).toBe('keep');
    expect(evaluateBoundSsoLogout({
      capture: captureA(),
      current: captureA(),
      response: { driverId: 'driver-a', logoutAt: newer },
      hasAuthSession: true,
    })).toBe('keep');
    expect(evaluateBoundSsoLogout({
      capture: captureA(),
      current: captureA(),
      response: { driverId: 'driver-a', companyId: 'liquid-gold' },
      hasAuthSession: true,
    })).toBe('keep');
  });

  it('generation, verifiedAt, authMethod, or Auth mismatch is keep', () => {
    expect(evaluateBoundSsoLogout({
      capture: captureA(),
      current: { ...captureA(), generation: 1 },
      response: matchingResponse,
      hasAuthSession: true,
    })).toBe('keep');
    expect(evaluateBoundSsoLogout({
      capture: captureA(),
      current: { ...captureA(), driverVerifiedAt: String(newer) },
      response: matchingResponse,
      hasAuthSession: true,
    })).toBe('keep');
    expect(evaluateBoundSsoLogout({
      capture: captureA(),
      current: { ...captureA(), authMethod: 'manual' },
      response: matchingResponse,
      hasAuthSession: true,
    })).toBe('keep');
    expect(evaluateBoundSsoLogout({
      capture: captureA(),
      current: captureA(),
      response: matchingResponse,
      hasAuthSession: false,
    })).toBe('keep');
  });
});

describe('live Suite logout callable is bound to the starting identity', () => {
  beforeEach(() => {
    resetSessionGenerationForTests();
    mockCallable.mockReset();
    mockUser = { uid: 'u' };
    for (const k of Object.keys(mockSecure)) delete mockSecure[k];
    mockSecure.driverId = 'driver-a';
    mockSecure.companyId = 'liquid-gold';
    mockSecure.authMethod = 'sso';
    mockSecure.driverVerifiedAt = String(verified);
  });

  it('Driver A live logout request is deferred; session changes to B; A resolves with a newer logoutAt; B is not logged out', async () => {
    let releaseA: (v: unknown) => void = () => undefined;
    mockCallable.mockImplementationOnce(() => new Promise((resolve) => {
      releaseA = resolve;
    }));

    const pending = checkCanonicalSsoLogout();
    for (let i = 0; i < 40 && mockCallable.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(mockCallable).toHaveBeenCalledWith('bootstrapWbmSession', {});

    mockSecure.driverId = 'driver-b';
    mockSecure.companyId = 'liquid-gold';
    mockSecure.authMethod = 'sso';
    mockSecure.driverVerifiedAt = String(verified + 1000);
    bumpSessionGeneration();

    releaseA({
      driverId: 'driver-a',
      companyId: 'liquid-gold',
      logoutAt: newer,
    });
    await expect(pending).resolves.toBe(false);
  });

  it('live response driverId differs from the captured session; no logout', async () => {
    mockCallable.mockResolvedValue({
      driverId: 'driver-other',
      companyId: 'liquid-gold',
      logoutAt: newer,
    });
    await expect(checkCanonicalSsoLogout()).resolves.toBe(false);
  });

  it('live response companyId differs from the captured session; no logout', async () => {
    mockCallable.mockResolvedValue({
      driverId: 'driver-a',
      companyId: 'other-co',
      logoutAt: newer,
    });
    await expect(checkCanonicalSsoLogout()).resolves.toBe(false);
  });

  it('matching live identity with newer logoutAt still logs out', async () => {
    mockCallable.mockResolvedValue({
      driverId: 'driver-a',
      companyId: 'liquid-gold',
      logoutAt: newer,
    });
    await expect(checkCanonicalSsoLogout()).resolves.toBe(true);
  });
});
