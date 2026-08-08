/**
 * User-visible date/time/number formatting bound to the *selected app language*,
 * not the device locale. Stored/canonical values are never rewritten here.
 */

export type AppLocaleTag = 'en-US' | 'es-US';

/** Optional override for tests / explicit calls. */
let currentLangOverride: string | null = null;

/** Call from app bootstrap or after changeLanguage so formatters track app language. */
export function setAppLanguageForFormatting(lang: string | null | undefined): void {
  currentLangOverride = lang ?? null;
}

function resolveLang(lang?: string | null): string {
  if (lang) return lang;
  if (currentLangOverride) return currentLangOverride;
  try {
    // Lazy require avoids pulling expo-localization into pure unit tests of format.ts
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const i18n = require('./index').default as { language?: string };
    return i18n?.language || 'en';
  } catch {
    return 'en';
  }
}

/** BCP-47 tag for Intl APIs from current app language. */
export function appLocaleTag(lang?: string | null): AppLocaleTag {
  const code = resolveLang(lang).toLowerCase();
  return code.startsWith('es') ? 'es-US' : 'en-US';
}

export function formatAppDateTime(
  input: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
  lang?: string | null,
): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleString(appLocaleTag(lang), options);
}

export function formatAppDate(
  input: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
  lang?: string | null,
): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleDateString(appLocaleTag(lang), options);
}

export function formatAppTime(
  input: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
  lang?: string | null,
): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleTimeString(
    appLocaleTag(lang),
    options ?? { hour: '2-digit', minute: '2-digit' },
  );
}

export function formatAppNumber(
  n: number,
  options?: Intl.NumberFormatOptions,
  lang?: string | null,
): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString(appLocaleTag(lang), options);
}

/**
 * Simple count-based plural picker aligned with EN/ES driver UI:
 * count === 1 → singular form; otherwise (0, 2+) → plural form.
 * Prefer i18n keys with {{count}} when possible; this helper is for tests
 * and central consistency.
 */
export function pickPluralForm(
  count: number,
  forms: { one: string; other: string },
): string {
  return count === 1 ? forms.one : forms.other;
}
