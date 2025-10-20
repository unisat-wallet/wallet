/**
 * UniSat Wallet Background - Main exports
 */

// Core background manager
export { BackgroundManager } from './background-manager'

// Adapters for cross-platform compatibility
export * from './adapters'

// Controllers
export { phishingController, providerController, walletController } from './controllers'

// Services
export {
  contactBookService,
  i18n,
  keyringService,
  notificationService,
  permissionService,
  phishingDetectService,
  preferenceService,
  sessionService,
  walletApiService,
} from './services'

// webapi
export { storage, notification } from './webapi'

// Integration bridge for unisat-extension
export * from './integration/extension-bridge'

// Shared types and constants
export * from './shared/types'
export * from './shared/constants'

// Utils
export { brc20Utils } from './utils/brc20-utils'
export { namesUtils } from './utils/names-utils'

// Re-export commonly used types
export type { BackgroundManagerConfig, BackgroundManagerEvents } from './background-manager'
