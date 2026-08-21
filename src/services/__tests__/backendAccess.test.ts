jest.mock('../firebaseAuthSession', () => ({
  getValidIdToken: jest.fn(async () => {
    throw Object.assign(new Error('missing'), { name: 'AuthSessionError' });
  }),
}));

import { readJsonPath } from '../backendAccess';

describe('readJsonPath classified missing token', () => {
  test('real fetch without a token is auth_session, not not-found', async () => {
    const r = await readJsonPath('packets/processed/x', fetch);
    expect(r.found).toBe(false);
    expect(r.diagnosis?.kind).toBe('auth_session');
  });
});
