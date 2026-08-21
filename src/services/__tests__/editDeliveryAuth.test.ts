import { readFileSync } from 'fs';
import { join } from 'path';

describe('WB-M edit/delivery uses Auth ID tokens, not the API key', () => {
  const edit = readFileSync(join(__dirname, '..', 'editDelivery.ts'), 'utf8');
  const delivery = readFileSync(join(__dirname, '..', 'deliveryStatus.ts'), 'utf8');
  const firebase = readFileSync(join(__dirname, '..', 'firebase.ts'), 'utf8');

  it('does not attach the API key as RTDB auth', () => {
    expect(edit).not.toMatch(/auth=\$\{FIREBASE_API_KEY\}/);
    expect(delivery).not.toMatch(/auth=\$\{FIREBASE_API_KEY\}/);
    expect(firebase).not.toMatch(/auth=\$\{FIREBASE_API_KEY\}/);
  });

  it('uses getValidIdToken for authorized reads', () => {
    expect(edit).toMatch(/getValidIdToken/);
    expect(delivery).toMatch(/getValidIdToken/);
    expect(firebase).toMatch(/getValidIdToken/);
  });
});
