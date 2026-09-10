/**
 * Batch A — registration must collect + submit the company join code.
 *
 * The deployed requestDriverRegistration callable requires an 8-character
 * companyCode (normalizeCompanyJoinCode = uppercase, strip non-[A-Z0-9]) and
 * resolves it server-side to the company; company NAME alone can never join.
 * secureRegister must normalize the code to that exact contract and put it on
 * the wire. These tests capture the payload the client sends.
 */

const posted: any[] = [];

beforeEach(() => {
  posted.length = 0;
  (global as any).fetch = jest.fn(async (_url: string, init: any) => ({
    ok: true,
    json: async () => {
      posted.push(JSON.parse(init.body));
      return { result: { pendingId: 'p1', status: 'pending' } };
    },
  }));
});

// Mirror of the server's normalizeCompanyJoinCode (companyOnboarding.ts:11).
const serverNormalize = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

test('secureRegister puts a normalized 8-char companyCode on the wire', async () => {
  const { secureRegister } = await import('../secureDriverAuth');
  await secureRegister({
    displayName: 'New Guy', passcode: '1234', companyName: 'Liquid Gold Trucking',
    legalName: 'New Guy', companyCode: 'lg-7h 2k9x',
  });
  expect(posted).toHaveLength(1);
  const data = posted[0].data;
  // Normalized to the server contract, exactly 8 chars, matches server normalize.
  expect(data.companyCode).toBe('LG7H2K9X');
  expect(data.companyCode).toBe(serverNormalize('lg-7h 2k9x'));
  expect(data.companyCode).toHaveLength(8);
  expect(data.source).toBe('wbm');
  // Company NAME is context only — never the join key.
  expect(data.companyName).toBe('Liquid Gold Trucking');
});

test('company name alone cannot join — companyCode is a distinct required field', async () => {
  const { secureRegister } = await import('../secureDriverAuth');
  await secureRegister({ displayName: 'X', passcode: '1', companyName: 'Liquid Gold', companyCode: '' });
  // A blank code is sent blank (not derived from the name); the server then
  // rejects with "Company join code is required" — the client never fabricates
  // a code from companyName.
  expect(posted[0].data.companyCode).toBe('');
  expect(posted[0].data.companyName).toBe('Liquid Gold');
});

test('the entered code and passcode are never logged', async () => {
  const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const { secureRegister } = await import('../secureDriverAuth');
  await secureRegister({ displayName: 'X', passcode: 'SECRETPASS', companyName: 'C', companyCode: 'ABCD2345' });
  const logged = spy.mock.calls.flat().join(' ');
  expect(logged).not.toContain('SECRETPASS');
  expect(logged).not.toContain('ABCD2345');
  spy.mockRestore();
});
