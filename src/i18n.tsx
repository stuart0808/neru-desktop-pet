import React from "react";
import type { AppLanguage, AppLocale, DesktopPetApi } from "../shared/types";
import { languageLabels, resolveLocale, supportedLocales, translate } from "../shared/i18n";

type I18nContextValue = {
  language: AppLanguage;
  locale: AppLocale;
  languageOptions: Array<{ value: AppLanguage; label: string }>;
  t(text: string, params?: Record<string, string | number>): string;
};

const I18nContext = React.createContext<I18nContextValue>({
  language: "system",
  locale: "zh-CN",
  languageOptions: [
    { value: "system", label: languageLabels.system },
    ...supportedLocales.map((locale) => ({ value: locale, label: languageLabels[locale] }))
  ],
  t: (text, params) => translate("zh-CN", text, params)
});

export function I18nProvider({ api, children }: { api?: DesktopPetApi; children: React.ReactNode }) {
  const [language, setLanguage] = React.useState<AppLanguage>("system");

  React.useEffect(() => {
    let disposed = false;
    if (!api) return;
    void api.settings.get()
      .then((settings) => {
        if (!disposed) setLanguage(settings.language);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [api]);

  React.useEffect(() => {
    if (!api) return;
    return api.events.onSnapshotUpdated(() => {
      void api.settings.get()
        .then((settings) => setLanguage(settings.language))
        .catch(() => undefined);
    });
  }, [api]);

  const locale = React.useMemo(() => resolveLocale(language, navigator.language), [language]);
  const value = React.useMemo<I18nContextValue>(() => ({
    language,
    locale,
    languageOptions: [
      { value: "system", label: translate(locale, languageLabels.system) },
      ...supportedLocales.map((item) => ({ value: item, label: languageLabels[item] }))
    ],
    t: (text, params) => translate(locale, text, params)
  }), [language, locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return React.useContext(I18nContext);
}
