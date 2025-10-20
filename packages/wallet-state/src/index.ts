import { load, save } from 'redux-localstorage-simple'

import { configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query/react'

import accounts from './reducers/accounts'
import discovery from './reducers/discovery'
import { updateVersion } from './actions/global'
import global from './reducers/global'
import keyrings from './reducers/keyrings'
import settings from './reducers/settings'
import transactions from './reducers/transactions'
import ui from './reducers/ui'

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
  },
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({ thunk: true }).concat(save({ states: PERSISTED_KEYS, debounce: 1000 })),
  preloadedState: load({ states: PERSISTED_KEYS, disableWarnings: true }),
})

store.dispatch(updateVersion())

setupListeners(store.dispatch)

export default store

export type AppState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export * from './context'
export * from './hooks'
export * from './updater'
