import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import { LanguageDetectorAsyncModule } from "i18next";

/** Persisted language preference (survives restart). */
export const LANGUAGE_STORAGE_KEY = "@wellbuilt_language";

export type AppLanguage = "en" | "es";

export function normalizeAppLanguage(code: string | null | undefined): AppLanguage {
  if (code && code.toLowerCase().startsWith("es")) return "es";
  return "en";
}

function deviceLanguage(): AppLanguage {
  const locales = Localization.getLocales();
  const locale = locales[0]?.languageCode || "en";
  return normalizeAppLanguage(locale);
}

/**
 * Async language detector:
 * 1) stored preference (Settings / Welcome toggle)
 * 2) device locale
 * Fallback language for missing keys remains "en" in i18n init.
 */
export const languageDetector: LanguageDetectorAsyncModule = {
  type: "languageDetector",
  async: true,
  init: () => {},
  detect: async () => {
    try {
      const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (stored === "en" || stored === "es") return stored;
    } catch {
      // ignore storage failures — fall through to device
    }
    return deviceLanguage();
  },
  cacheUserLanguage: async (lng: string) => {
    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, normalizeAppLanguage(lng));
    } catch {
      // non-fatal
    }
  },
};
