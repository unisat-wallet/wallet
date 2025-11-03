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
    // @ts-ignore
    getDefaultMiddleware({ thunk: true }),
  // preloadedState: load({ states: PERSISTED_KEYS, disableWarnings: true }),
})

store.dispatch(updateVersion())

setupListeners(store.dispatch)

export default store

export type AppState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export * from './context'
export * from './hooks'
export * from './updater'
export * from './reducers'
export * from './types'
export * from './ui-hooks'
