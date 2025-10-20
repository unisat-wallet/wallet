import logger from 'loglevel'

import { t } from '@unisat/i18n'
import {
  BasePreferenceStore,
  ExtensionStorageAdapter,
  PreferenceService,
} from '@unisat/preference-service'
import { ChainType, NetworkType } from '@unisat/wallet-types'

/**
 * Phishing detection service - extends the base PhishingService with extension-specific functionality
 */
class PreferenceServiceWrapper extends PreferenceService {
  constructor() {
    const storage = new ExtensionStorageAdapter()
    const template: BasePreferenceStore = {
      currentKeyringIndex: 0,
      currentAccount: undefined,
      editingKeyringIndex: 0,
      editingAccount: undefined,
      externalLinkAck: false,
      balanceMap: {},
      historyMap: {},
      locale: 'auto',
      watchAddressPreference: {},
      walletSavedList: [],
      alianNames: {},
      initAlianNames: false,
      currentVersion: '0',
      firstOpen: false,
      currency: 'USD',
      addressType: 0,
      networkType: NetworkType.MAINNET as any,
      chainType: ChainType.BITCOIN_MAINNET as any,
      keyringAlianNames: {},
      accountAlianNames: {},
      uiCachedData: {},
      skippedVersion: '',
      appTab: {
        summary: { apps: [] },
        readAppTime: {},
        readTabTime: 1,
      },
      showSafeNotice: true,
      addressFlags: {},
      enableSignData: false,
      autoLockTimeId: 3,
      openInSidePanel: false,
      developerMode: false,
    }

    // Call parent constructor with extension-compatible storage
    super({
      storage: storage,
      logger,
      t: t,
      template,
    })
  }
}

const preferenceService = new PreferenceServiceWrapper()

export default preferenceService
