import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { languageDetector } from "./languageDetector";
import en from "./locales/en.json";
import es from "./locales/es.json";

i18n
  .use(languageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    compatibilityJSON: "v4",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
