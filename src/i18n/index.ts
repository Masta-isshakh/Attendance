import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = 'attendance.language';

function deviceLanguage(): SupportedLanguage {
  const locales = getLocales();
  const code = locales[0]?.languageCode ?? 'en';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code)
    ? (code as SupportedLanguage)
    : 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

/**
 * Restore the saved choice after init so the first render is never blocked on
 * storage. Falls back silently to the device language if nothing is saved.
 */
export async function restoreSavedLanguage(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved && (SUPPORTED_LANGUAGES as readonly string[]).includes(saved)) {
      await i18n.changeLanguage(saved);
    }
  } catch {
    // A missing preference is not worth surfacing.
  }
}

export async function setLanguage(language: SupportedLanguage | 'system'): Promise<void> {
  if (language === 'system') {
    await AsyncStorage.removeItem(STORAGE_KEY);
    await i18n.changeLanguage(deviceLanguage());
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEY, language);
  await i18n.changeLanguage(language);
}

export async function getStoredLanguage(): Promise<SupportedLanguage | 'system'> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved && (SUPPORTED_LANGUAGES as readonly string[]).includes(saved)) {
      return saved as SupportedLanguage;
    }
  } catch {
    // ignore
  }
  return 'system';
}

export default i18n;
