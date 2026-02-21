import en from "./locales/en.json";
import es from "./locales/es.json";

export const resources = {
  en: { translation: en },
  es: { translation: es },
};

export const DEFAULT_LANG = "en";
export const SUPPORTED_LANGS = ["en", "es"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];
