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

// Keep display formatters aligned with selected app language (not device locale).
import { setAppLanguageForFormatting } from "./format";
setAppLanguageForFormatting(i18n.language);
i18n.on("languageChanged", (lng) => {
  setAppLanguageForFormatting(lng);
});

export default i18n;
