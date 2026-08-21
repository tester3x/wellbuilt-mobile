jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn() }));
jest.mock('expo-device', () => ({ modelName: 'test' }));

const mockSecureLogin = jest.fn();
jest.mock('../secureDriverAuth', () => ({
  secureLogin: (...args: unknown[]) => mockSecureLogin(...args),
  bootstrapDriverSession: jest.fn(),
}));

import { classifyLoginFailure, verifyLogin } from '../driverAuth';

describe('verifyLogin end-to-end classification', () => {
  beforeEach(() => {
    mockSecureLogin.mockReset();
  });

  test('{valid:false} from thrown network is classified, not a raw connection string dump', async () => {
    mockSecureLogin.mockRejectedValue(new Error('Network request failed'));
    const r = await verifyLogin('Mike', '1234');
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.errorKind).toBe('no_network');
      expect(r.errorCode).toBeTruthy();
      expect(r.error).not.toMatch(/please check your internet/i);
    }
  });

  test('{valid:false} invalid credentials stay invalid_credentials', async () => {
    mockSecureLogin.mockRejectedValue(new Error('Invalid name or passcode'));
    const r = await verifyLogin('Mike', 'bad');
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errorKind).toBe('invalid_credentials');
  });

  test('thrown classifier matches valid:false path', () => {
    const thrown = classifyLoginFailure(new Error('timed out'));
    expect(thrown.kind).toBe('timeout');
  });

  test('success returns typed routes/roles', async () => {
    mockSecureLogin.mockResolvedValue({
      driverId: 'd1',
      displayName: 'Mike',
      isAdmin: false,
      isViewer: false,
      companyId: 'c1',
      companyName: 'Co',
      roles: ['driver'],
      assignedRoutes: ['North Loop'],
    });
    const r = await verifyLogin('Mike', '1234');
    expect(r.valid).toBe(true);
    if (r.valid) {
      expect(r.roles).toEqual(['driver']);
      expect(r.assignedRoutes).toEqual(['North Loop']);
    }
  });
});
