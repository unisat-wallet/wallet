/**
 * UniSat Wallet Background - Main exports
 */

// Adapters for cross-platform compatibility
export * from './adapters'

// Controllers
export { phishingController, providerController, walletController } from './controllers'
export { type ProviderMethodArgs, type ProviderMethods } from './controllers/provider/methodList'

// Services
export {
  approvalService,
  contactBookService,
  keyringService,
  notificationService,
  permissionService,
  phishingDetectService,
  preferenceService,
  sessionService,
  walletApiService,
} from './services'

// webapi
export { notification } from './webapi'

// Utils
export { brc20Utils } from './utils/brc20-utils'

export { initPersistStoreStorage } from './utils/persistStore'

export { bgEventBus } from './utils/eventBus'

export { getTrustedProviderOrigin } from './utils/provider-origin'

export {
  isAllowedUiControllerMethod,
  isValidUiDevelopmentRequest,
  isValidUiMessageParams,
} from './utils/ui-message-policy'
