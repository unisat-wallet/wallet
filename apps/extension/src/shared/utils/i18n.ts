import log from 'loglevel';

import { FALLBACK_LOCALE, SUPPORTED_LOCALES, SupportedLocale } from '@unisat/wallet-shared';
import { ProxyStorageAdapter } from '@unisat/wallet-storage';

export interface Translations {
  [key: string]: string;
}

const fetchLocale = async (locale: string): Promise<Translations> => {
  const res = await fetch(`./_locales/${locale}/messages.json`);
  const data: Record<string, { message: string; description: string }> = await res.json();
  const translations: Translations = {};

  for (const [key, value] of Object.entries(data)) {
    translations[key] = value.message;
  }

  return translations;
};

const processSubstitutions = (
  message: string,
  substitutions?: string | string[] | Record<string, string | number>
): string => {
  try {
    if (substitutions) {
      if (typeof substitutions === 'string') {
        message = message.replace(/\$1/g, substitutions);
      } else if (Array.isArray(substitutions)) {
        substitutions.forEach((substitution, index) => {
          const regex = new RegExp(`\\$${index + 1}`, 'g');
          message = message.replace(regex, substitution);
        });
      } else {
        Object.entries(substitutions).forEach(([key, substitution]) => {
          message = message.split(`{${key}}`).join(String(substitution));
          const regex = new RegExp(`\\$${key}`, 'g');
          message = message.replace(regex, String(substitution));
        });
      }
    }

    return message;
  } catch (error) {
    console.error(`Error getting message for "${message}":`, error);
    return message;
  }
};

class I18nService {
  private currentLocale: string;
  private translations: Map<string, Translations> = new Map();
  private loadingLocales: Map<string, Promise<Translations>> = new Map();
  private initialized = false;
  private storage: ProxyStorageAdapter = undefined!;

  constructor() {
    this.currentLocale = FALLBACK_LOCALE;
  }

  async init(config: { storage?: ProxyStorageAdapter }) {
    this.storage = config.storage!;

    await this.loadLocale(FALLBACK_LOCALE);

    if (this.storage) {
      const locale = await this.storage.get('i18nextLng');
      this.currentLocale = locale || FALLBACK_LOCALE;
      await this.loadLocale(this.currentLocale);
    }

    this.initialized = true;
  }

  private async loadLocale(locale: string): Promise<void> {
    if (this.translations.has(locale)) {
      return;
    }

    try {
      let loadingLocale = this.loadingLocales.get(locale);
      if (!loadingLocale) {
        loadingLocale = fetchLocale(locale);
        this.loadingLocales.set(locale, loadingLocale);
      }

      const translations = await loadingLocale;
      this.translations.set(locale, translations);
    } catch (error) {
      if (locale !== FALLBACK_LOCALE) {
        await this.loadLocale(FALLBACK_LOCALE);
      }
    } finally {
      this.loadingLocales.delete(locale);
    }
  }

  translate = (key: string, substitutions?: string | string[] | Record<string, string | number>): string => {
    if (!this.initialized) {
      log.warn('I18n not initialized, returning key');
      return key;
    }

    const rawKey = key.includes(' ') ? key.replace(/ /g, '__') : key;
    const translations = this.translations.get(this.currentLocale);
    const translation =
      translations?.[key] ??
      translations?.[rawKey] ??
      this.translations.get(FALLBACK_LOCALE)?.[key] ??
      this.translations.get(FALLBACK_LOCALE)?.[rawKey];
    if (translation === undefined) {
      log.warn(`Translation for key "${key}" not found in locale "${this.currentLocale}"`);
      return key;
    }
    const result = processSubstitutions(translation, substitutions);

    return result;
  };

  async changeLanguage(locale: string): Promise<void> {
    if (!SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
      log.warn(`Locale ${locale} is not supported`);
      return;
    }

    try {
      await this.loadLocale(locale);
      this.currentLocale = locale;
      if (this.storage) {
        await this.storage.set('i18nextLng', locale);
      }

      log.debug(`Language changed to: ${locale}`);
    } catch (error) {
      log.error(`Failed to change language to ${locale}:`, error);
      throw error;
    }
  }

  getCurrentLocale(): string {
    return this.currentLocale;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const i18nService = new I18nService();
