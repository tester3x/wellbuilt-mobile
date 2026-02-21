import * as Localization from "expo-localization";
import { LanguageDetectorModule } from "i18next";

export const languageDetector: LanguageDetectorModule = {
  type: "languageDetector",
  init: () => {},
  detect: () => {
    const locales = Localization.getLocales();
    const locale = locales[0]?.languageCode || "en";
    return locale.startsWith("es") ? "es" : "en";
  },
  cacheUserLanguage: () => {},
};
