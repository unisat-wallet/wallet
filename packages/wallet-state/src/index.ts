import { load, save } from 'redux-localstorage-simple'

import { configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/dist/query/react/index.js'

import accounts from './reducers/accounts'
import discovery from './reducers/discovery'
import { updateVersion } from './actions/global'
import global from './reducers/global'
import keyrings from './reducers/keyrings'
import settings from './reducers/settings'
import transactions from './reducers/transactions'
import ui from './reducers/ui'
import browser from './reducers/browser'

const PERSISTED_KEYS: string[] = ['ui', 'discovery']

export function createAppStore() {
  const store = configureStore({
    reducer: {
      accounts,
      transactions,
      settings,
      global,
      keyrings,
      ui,
      discovery,
      browser,
    },
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({ thunk: true }).concat(
        save({ states: PERSISTED_KEYS, debounce: 1000 })
      ),
    preloadedState: load({ states: PERSISTED_KEYS, disableWarnings: true }),
  })

  store.dispatch(updateVersion())
  setupListeners(store.dispatch)

  return store
}

export type AppStore = ReturnType<typeof createAppStore>
export type AppState = ReturnType<AppStore['getState']>
export type AppDispatch = AppStore['dispatch']

export * from './context'
export * from './hooks'
export * from './updater'
export * from './reducers'
export * from './types'
export * from './ui-hooks'
export { uiEventBus } from './utils/eventBus'
export {
  decodeRgbInvoice,
  decodeRgbInvoiceAmountState,
  getRgbInvoiceAmount,
  getRgbInvoiceAssetId,
  type DecodedRgbInvoice,
  type RgbInvoiceAssignmentKind,
  type RgbInvoiceType,
} from './utils/rgb-invoice-utils'
export { useAsyncEffect } from './utils/ui-utils'
