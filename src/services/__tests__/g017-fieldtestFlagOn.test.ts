import { readFileSync } from 'fs';
import { join } from 'path';
import { GOVERNED_PACKET_ACCESS, isGovernedPacketAccessEnabled } from '../governedPacketAccessFlag';

const root = join(__dirname, '../../..');
const appJson = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
const flagSrc = readFileSync(join(root, 'src/services/governedPacketAccessFlag.ts'), 'utf8');

describe('G-017 field-test release', () => {
  test('governed packet access flag is exactly true', () => {
    expect(GOVERNED_PACKET_ACCESS).toBe(true);
    expect(isGovernedPacketAccessEnabled()).toBe(true);
    expect(flagSrc).toMatch(/boolean = true/);
  });

  test('fails if this field-test branch ships with the flag OFF', () => {
    expect(GOVERNED_PACKET_ACCESS).not.toBe(false);
    expect(flagSrc).not.toMatch(/boolean = false/);
  });

  test('Android versionCode is exactly one above proven VC58 history', () => {
    expect(appJson.expo.android.versionCode).toBe(59);
  });

  test('shared Expo version and iOS buildNumber are unchanged', () => {
    expect(appJson.expo.version).toBe('2.1.0');
    expect(appJson.expo.ios.buildNumber).toBe('24');
  });
});
