/**
 * English/Spanish locale parity and badge-only wording gates.
 */
import en from '../locales/en.json';
import es from '../locales/es.json';
import fs from 'fs';
import path from 'path';

function flatten(o: any, p = ''): string[] {
  let keys: string[] = [];
  for (const [a, b] of Object.entries(o || {})) {
    const n = p ? `${p}.${a}` : a;
    if (b && typeof b === 'object' && !Array.isArray(b)) keys = keys.concat(flatten(b, n));
    else keys.push(n);
  }
  return keys;
}

function get(o: any, pathStr: string): unknown {
  return pathStr.split('.').reduce((acc: any, k) => (acc == null ? acc : acc[k]), o);
}

function placeholders(s: unknown): string[] {
  if (typeof s !== 'string') return [];
  return (s.match(/\{\{[^}]+\}\}/g) || []).map((x) => x.slice(2, -2).trim()).sort();
}

describe('locale key parity en ↔ es', () => {
  const ek = flatten(en);
  const sk = flatten(es);
  const eSet = new Set(ek);
  const sSet = new Set(sk);

  test('same key counts', () => {
    expect(ek.length).toBe(sk.length);
  });

  test('no English-only keys', () => {
    expect(ek.filter((k) => !sSet.has(k))).toEqual([]);
  });

  test('no Spanish-only keys', () => {
    expect(sk.filter((k) => !eSet.has(k))).toEqual([]);
  });

  test('interpolation placeholders match', () => {
    const mismatches: string[] = [];
    for (const k of ek) {
      if (!sSet.has(k)) continue;
      const pe = placeholders(get(en, k));
      const ps = placeholders(get(es, k));
      if (JSON.stringify(pe) !== JSON.stringify(ps)) mismatches.push(k);
    }
    expect(mismatches).toEqual([]);
  });

  test('welcome.quotes arrays same length', () => {
    expect((en as any).welcome.quotes.length).toBe((es as any).welcome.quotes.length);
  });
});

describe('badge-only bilingual wording', () => {
  test('history edited fallback keys exist and are distinct', () => {
    expect((en as any).history.editedDetailWithTime).toContain('{{when}}');
    expect((es as any).history.editedDetailWithTime).toContain('{{when}}');
    expect((en as any).history.editedDetailNoTime).toMatch(/edited/i);
    expect((es as any).history.editedDetailNoTime).toMatch(/editad/i);
    // Does not claim a complete secure trail exists
    expect((en as any).history.editedDetailNoTime).toMatch(/unavailable/i);
    expect((es as any).history.editedDetailNoTime).toMatch(/no están disponibles|no est[aá]n disponibles/i);
  });

  test('history.tsx does not hardcode English fallback sentences', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../app/history.tsx'),
      'utf8',
    );
    expect(src).toContain("t('history.editedDetailWithTime'");
    expect(src).toContain("t('history.editedDetailNoTime')");
    expect(src).not.toMatch(/This packet was edited/);
    // No runtime fetch of secure trail path (comments alone are fine)
    expect(src).not.toMatch(/fetchPacketEditHistory|editHistory\/\$\{/);
  });

  test('wellData.edited badge labels exist in both locales', () => {
    expect((en as any).wellData.edited).toBeTruthy();
    expect((es as any).wellData.edited).toBeTruthy();
  });
});

describe('language architecture pins', () => {
  test('fallback language is English', () => {
    const src = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf8');
    expect(src).toMatch(/fallbackLng:\s*["']en["']/);
  });

  test('language detector persists preference', () => {
    const src = fs.readFileSync(path.join(__dirname, '../languageDetector.ts'), 'utf8');
    expect(src).toMatch(/LANGUAGE_STORAGE_KEY/);
    expect(src).toMatch(/AsyncStorage\.setItem/);
    expect(src).toMatch(/AsyncStorage\.getItem/);
    expect(src).toMatch(/async:\s*true/);
  });
});
