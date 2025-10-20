import { changeLanguage, initI18n, t } from '@unisat/i18n'

// Default locale helper
const getCurrentLocale = () => {
  // This would be stored in preferences in a real implementation
  return 'en'
}

class I18nService {
  private initialized = false

  async init() {
    if (!this.initialized) {
      await initI18n('en')
      this.initialized = true
      console.log('[I18nService] Initialized')
    }
  }

  changeLanguage = changeLanguage
  t = t
  getCurrentLocale = getCurrentLocale

  async cleanup() {
    this.initialized = false
  }
}

export const i18n = new I18nService()

export { getCurrentLocale, t }

export default i18n
