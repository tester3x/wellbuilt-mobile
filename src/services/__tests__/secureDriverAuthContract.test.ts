import { secureLogin } from '../secureDriverAuth';

describe('WB-M deployed authenticateDriver contract', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends credentials only and does not request an unsupported session audience', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        result: {
          customToken: 'custom-token',
          driverId: 'driver-1',
          displayName: 'MikeS24',
          companyId: 'liquid-gold',
        },
      }),
    } as Response);

    await expect(secureLogin('MikeS24', 'private-passcode')).resolves.toMatchObject({
      driverId: 'driver-1',
      companyId: 'liquid-gold',
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const envelope = JSON.parse(String(init.body));
    expect(envelope.data).toEqual({ displayName: 'MikeS24', passcode: 'private-passcode' });
    expect(envelope.data).not.toHaveProperty('audience');
  });
});
