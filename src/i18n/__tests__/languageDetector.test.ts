/**
 * Language persistence unit tests (AsyncStorage mocked).
 */
const store = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
  },
}));

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LANGUAGE_STORAGE_KEY,
  languageDetector,
  normalizeAppLanguage,
} from '../languageDetector';

describe('normalizeAppLanguage', () => {
  test('maps es-* to es', () => {
    expect(normalizeAppLanguage('es')).toBe('es');
    expect(normalizeAppLanguage('es-MX')).toBe('es');
  });
  test('everything else to en', () => {
    expect(normalizeAppLanguage('en')).toBe('en');
    expect(normalizeAppLanguage('fr')).toBe('en');
    expect(normalizeAppLanguage(undefined)).toBe('en');
  });
});

describe('languageDetector persistence', () => {
  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
  });

  test('detect uses stored preference over device', async () => {
    store.set(LANGUAGE_STORAGE_KEY, 'es');
    const lng = await (languageDetector.detect as () => Promise<string>)();
    expect(lng).toBe('es');
  });

  test('detect falls back to device when unset', async () => {
    const lng = await (languageDetector.detect as () => Promise<string>)();
    expect(lng).toBe('en');
  });

  test('cacheUserLanguage writes normalized code', async () => {
    await languageDetector.cacheUserLanguage!('es-MX');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'es');
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe('es');
  });

  test('English→Spanish→English round-trip storage', async () => {
    await languageDetector.cacheUserLanguage!('es');
    expect(await (languageDetector.detect as () => Promise<string>)()).toBe('es');
    await languageDetector.cacheUserLanguage!('en');
    expect(await (languageDetector.detect as () => Promise<string>)()).toBe('en');
  });
});
