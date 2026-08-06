// i18n 初始化：仅 zh/en（§0 决策 4），结构保留扩展位（locale/namespace 两级目录）。
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '@shared/i18n/locales/en/translation.json';
import zh from '@shared/i18n/locales/zh/translation.json';

export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function resolveLanguage(input?: string): SupportedLanguage {
  return input?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: resolveLanguage(typeof navigator === 'undefined' ? undefined : navigator.language),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
