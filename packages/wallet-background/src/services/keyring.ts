import logger from 'loglevel'

import { t } from '@unisat/i18n'
import { KeyringService, MemoryStorageAdapter } from '@unisat/keyring-service'
import { KeyringServiceConfig } from '@unisat/keyring-service/types'

/**
 * KeyringService wrapper - similar to the extension but for testing
 * Extends the base KeyringService with extension-like functionality
 */
export class KeyringServiceWrapper extends KeyringService {
  constructor() {
    const storage = new MemoryStorageAdapter()

    const config: KeyringServiceConfig = {
      storage,
      logger,
      t: t,
    }

    super(config)
  }
}

export const keyringService = new KeyringServiceWrapper()
export default keyringService
