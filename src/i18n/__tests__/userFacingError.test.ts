/**
 * User-facing error mapping — pure classification + message keys present.
 * Avoids loading full i18n (expo-localization) by testing classify + locale files.
 */
import { classifyError } from '../userFacingError';
import en from '../locales/en.json';
import es from '../locales/es.json';

describe('userFacingError classification', () => {
  test('classifies network errors', () => {
    expect(classifyError(new Error('Network request failed'))).toBe('network');
    expect(classifyError(new Error('Failed to fetch'))).toBe('network');
  });

  test('classifies timeout/abort', () => {
    const e = new Error('aborted');
    (e as any).name = 'AbortError';
    expect(classifyError(e)).toBe('timeout');
  });

  test('classifies firebase GET/PUT status failures', () => {
    expect(classifyError(new Error('Firebase GET failed (500)'))).toBe('firebaseRead');
    expect(classifyError(new Error('Firebase PUT failed (403)'))).toBe('firebaseWrite');
  });

  test('unknown fallback', () => {
    expect(classifyError(new Error('something weird'))).toBe('unknown');
  });
});

describe('user-facing error strings (locale tables)', () => {
  test('EN and ES define safe messages without raw HTTP codes', () => {
    for (const key of ['network', 'server', 'timeout', 'unknown', 'firebaseRead', 'firebaseWrite']) {
      const enMsg = (en as any).errors[key] as string;
      const esMsg = (es as any).errors[key] as string;
      expect(enMsg.length).toBeGreaterThan(5);
      expect(esMsg.length).toBeGreaterThan(5);
      expect(enMsg).not.toMatch(/\b50[0-9]\b/);
      expect(esMsg).not.toMatch(/\b50[0-9]\b/);
      expect(enMsg).not.toMatch(/Firebase GET failed/i);
    }
  });
});
