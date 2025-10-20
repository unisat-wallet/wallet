/**
 * Extension Bridge - Integration bridge
 * 
 * This module is responsible for integrating wallet-background with existing unisat-extension
 */

import { BackgroundManager } from '../background-manager'
import { 
  ExtensionStorageAdapter, 
  ExtensionNotificationAdapter, 
  ExtensionNetworkAdapter, 
  ExtensionPlatformAdapter 
} from '../adapters/extension'

export interface ExtensionBridgeConfig {
  enablePhishingDetection?: boolean
  enableNotifications?: boolean
  autoStart?: boolean
}

export class ExtensionBridge {
  private backgroundManager: BackgroundManager
  private initialized = false

  constructor(config: ExtensionBridgeConfig = {}) {
    // Create adapters for extension environment
    const adapters = {
      storage: new ExtensionStorageAdapter(),
      notification: new ExtensionNotificationAdapter(), 
      network: new ExtensionNetworkAdapter(),
      platform: new ExtensionPlatformAdapter()
    }

    this.backgroundManager = new BackgroundManager(adapters)

    if (config.autoStart) {
      this.initialize()
    }
  }

  /**
   * Initialize the wallet background services
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      await this.backgroundManager.initialize()
      this.initialized = true
      console.log('[ExtensionBridge] Successfully initialized wallet-background')
    } catch (error) {
      console.error('[ExtensionBridge] Failed to initialize:', error)
      throw error
    }
  }

  /**
   * Get a service instance
   */
  getService<T>(name: string): T {
    return this.backgroundManager.getService<T>(name)
  }

  /**
   * Get the background manager instance
   */
  getBackgroundManager(): BackgroundManager {
    return this.backgroundManager
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Cleanup all services
   */
  async cleanup(): Promise<void> {
    await this.backgroundManager.cleanup()
    this.initialized = false
  }

  /**
   * Create extension-compatible service exports
   * This allows existing unisat-extension code to use the new services
   */
  createLegacyExports() {
    return {
      // Export services in the format expected by unisat-extension
      walletController: this.getService('wallet'),
      phishingController: this.getService('phishingController'),
      providerController: this.getService('provider'),
      
      // Export individual services
      keyringService: this.getService('keyring'),
      permissionService: this.getService('permission'),
      preferenceService: this.getService('preference'),
      contactBookService: this.getService('contactBook'),
      notificationService: this.getService('notification'),
      sessionService: this.getService('session'),
      walletApiService: this.getService('walletApi'),
      phishingService: this.getService('phishing'),
      i18n: this.getService('i18n')
    }
  }
}

/**
 * Create a default extension bridge instance
 */
export function createExtensionBridge(config?: ExtensionBridgeConfig): ExtensionBridge {
  return new ExtensionBridge(config)
}

/**
 * Initialize wallet-background for unisat-extension
 * This is the main entry point for integration
 */
export async function initializeWalletBackground(config?: ExtensionBridgeConfig) {
  const bridge = createExtensionBridge(config)
  await bridge.initialize()
  return bridge
}