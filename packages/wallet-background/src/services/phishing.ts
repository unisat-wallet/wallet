import logger from 'loglevel'

import { t } from '@unisat/i18n'
import { ExtensionAdapter, PhishingAdapter, PhishingService } from '@unisat/phishing-detect'

/**
 * Phishing detection service - extends the base PhishingService with extension-specific functionality
 */
class PhishingDetectServiceWrapper extends PhishingService {
  constructor() {
    const storage: PhishingAdapter = new ExtensionAdapter()

    // Call parent constructor with extension-compatible storage
    super({
      adapter: storage,
      logger,
      t: t,
    })
  }

  async init(): Promise<void> {
    console.log('[PhishingService] Initialized')
  }
}

const phishingDetectService = new PhishingDetectServiceWrapper()

export default phishingDetectService
