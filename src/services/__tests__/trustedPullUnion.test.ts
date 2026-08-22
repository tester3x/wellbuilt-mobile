import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeTrustedHistoryIds, pullBelongsToDriver } from '../trustedHistoryKeys';

const srcRoot = join(__dirname, '..');

const UUID = 'bbbbbbbb-cccc-4ddd-8eee-000000000001';
const LEGACY = 'syn_alpha_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'syn_bravo_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('WB-M historical-pull union', () => {
  it('includes canonical UUID and bound legacy key; rejects a foreign key', () => {
    const trusted = normalizeTrustedHistoryIds(UUID, [UUID, LEGACY]);
    expect(pullBelongsToDriver({ driverId: UUID }, trusted)).toBe(true);
    expect(pullBelongsToDriver({ driverId: LEGACY }, trusted)).toBe(true);
    expect(pullBelongsToDriver({ driverId: OTHER }, trusted)).toBe(false);
  });

  it('isolates two synthetic identities', () => {
    const alpha = normalizeTrustedHistoryIds(UUID, [UUID, LEGACY]);
    const bravo = normalizeTrustedHistoryIds(
      'bbbbbbbb-cccc-4ddd-8eee-000000000002',
      ['bbbbbbbb-cccc-4ddd-8eee-000000000002', OTHER],
    );
    expect(pullBelongsToDriver({ driverId: LEGACY }, alpha)).toBe(true);
    expect(pullBelongsToDriver({ driverId: LEGACY }, bravo)).toBe(false);
    expect(pullBelongsToDriver({ driverId: OTHER }, bravo)).toBe(true);
    expect(pullBelongsToDriver({ driverId: OTHER }, alpha)).toBe(false);
  });

  it('does not dump all company packets on zero UUID matches', () => {
    const trusted = normalizeTrustedHistoryIds(UUID, [UUID, LEGACY]);
    expect(pullBelongsToDriver({ driverName: 'FixtureDriverAlpha' }, trusted, 'FixtureDriverAlpha')).toBe(true);
    expect(pullBelongsToDriver({ driverId: OTHER, driverName: 'FixtureDriverAlpha' }, trusted, 'FixtureDriverAlpha')).toBe(false);
  });

  it('bootstrap and pullHistory source use trusted aliases, not client-supplied keys', () => {
    const well = readFileSync(join(srcRoot, 'wellConfig.ts'), 'utf8');
    const pull = readFileSync(join(srcRoot, 'pullHistory.ts'), 'utf8');
    const bootstrap = readFileSync(join(srcRoot, 'wbmBootstrapCache.ts'), 'utf8');
    expect(well).toMatch(/bootstrapWbmSession/);
    expect(bootstrap).toMatch(/trustedHistoryDriverIds/);
    expect(pull).toMatch(/pullBelongsToDriver/);
    expect(pull).toMatch(/normalizeTrustedHistoryIds/);
    expect(pull).not.toMatch(/p\.driverId !== driverId/);
  });
});
