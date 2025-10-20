/**
 * Usage Example - How to use wallet-background in unisat-extension
 * 
 * This file demonstrates how to integrate wallet-background into existing unisat-extension
 */

import { initializeWalletBackground } from './extension-bridge'

/**
 * Method 1: Completely replace existing background services
 */
export async function replaceBackgroundServices() {
  // Initialize wallet-background
  const bridge = await initializeWalletBackground({
    enablePhishingDetection: true,
    enableNotifications: true,
    autoStart: true
  })

  // Get service exports compatible with existing code
  const services = bridge.createLegacyExports()

  // Now services can be used as before
  const { walletController, keyringService, permissionService } = services

  return services
}

/**
 * Method 2: Progressive migration - only use specific services
 */
export async function partialMigration() {
  const bridge = await initializeWalletBackground()

  // Only use new phishing service, keep others unchanged
  const phishingService = bridge.getService('phishing')
  const preferenceService = bridge.getService('preference')

  return {
    phishingService,
    preferenceService
  }
}

/**
 * Method 3: Integrate into existing background/index.ts
 */
export async function integrateIntoExistingBackground() {
  try {
    // Initialize new background services
    const bridge = await initializeWalletBackground()
    
    // Get services
    const services = bridge.createLegacyExports()
    
    // Listen for service ready events
    bridge.getBackgroundManager().on('service:ready', (serviceName) => {
      console.log(`Service ${serviceName} is ready`)
    })

    bridge.getBackgroundManager().on('manager:ready', () => {
      console.log('All wallet background services are ready')
    })

    return services
  } catch (error) {
    console.error('Failed to initialize wallet background:', error)
    throw error
  }
}

/**
 * How to use in manifest.json background script
 * 
 * In unisat-extension/src/background/index.ts:
 * 
 * ```typescript
 * import { integrateIntoExistingBackground } from '@unisat/wallet-background/integration'
 * 
 * // Replace existing service initialization
 * async function initializeServices() {
 *   const services = await integrateIntoExistingBackground()
 *   
 *   // Export services for use by other modules
 *   return services
 * }
 * 
 * initializeServices().then(services => {
 *   // Set up message listeners etc.
 *   chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
 *     // Use services.providerController to handle messages
 *   })
 * })
 * ```
 */