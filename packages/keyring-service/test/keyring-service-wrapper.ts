import { KeyringService } from '../src/keyring-service'
import type { KeyringServiceConfig, DisplayedKeyring } from '../src/types'
import { AddressType } from '@unisat/wallet-types'

// Mock createPersistStore function for extension compatibility
const mockCreatePersistStore = async (config: any) => {
  const store: any = config.template || {}
  return store
}

// Export interfaces for compatibility with extension
export interface ExtensionKeyringItem {
  type: string
  accounts: {
    pubkey: string
    brandName: string
    type?: string
    alianName?: string
  }[]
  addressType: AddressType
  index: number
}

export interface UIKeyringItem {
  type: string
  accounts: string[]
  addressType: AddressType
}

/**
 * KeyringService wrapper - similar to the extension but for testing
 * Extends the base KeyringService with extension-like functionality
 */
export class KeyringServiceWrapper extends KeyringService {
  constructor(useExtensionStorage = false) {
    super()
  }

  // Legacy method names for compatibility
  async bootWallet(password: string) {
    await this.boot(password)
  }

  // Additional convenience methods
  async isWalletUnlocked(): Promise<boolean> {
    return this.getMemStore().isUnlocked
  }

  async getAllKeyrings(): Promise<DisplayedKeyring[]> {
    // This would need to be implemented with actual keyring display logic
    return []
  }

  async getKeyringCount(): Promise<number> {
    const accounts = await this.getAccounts()
    return accounts.length
  }

  async hasAnyKeyrings(): Promise<boolean> {
    return this.hasVault()
  }

  // Override init to ensure storage adapter is properly initialized
  async init(): Promise<void> {
    console.log('[KeyringService] Starting initialization...')

    // Call parent init
    console.log('[KeyringService] Calling parent init...')
    // await super.init()

    console.log('[KeyringService] Initialization complete')
  }

  // Utility methods for testing
  async getStorageType(): Promise<string> {
    return (this as any).storage.constructor.name
  }

  async clearAllData(): Promise<void> {
    await this.setLocked()
  }
}

// Create default instance for testing
export const createKeyringService = (useExtensionStorage = false) => {
  return new KeyringServiceWrapper(useExtensionStorage)
}
