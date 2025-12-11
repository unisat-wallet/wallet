import React, { useContext } from 'react'

type RouteTypes = any

export interface NavigationContextType {
  navigate: (screenName: RouteTypes, params?: any) => void
  replace: (screenName: RouteTypes, params?: any) => void
  poptotop: () => void
  goBack: () => void
  navToTab: () => void
  navToTest: () => void
  navToLock: (params?: any) => void
  navToWelcome: () => void

  getRouteState<T>(props?: any): T

  navToUtxoTools: () => void
  navToUrl: (url: string) => void

  navToExplorerTx: (txid: string) => void
  navToExplorerAddress: (address: string) => void

  navToMarketPlaceBrc20: (ticker: string) => void
  navToInscribeBrc20: (ticker: string) => void
}

const initContext = {
  navigate: (screenName: RouteTypes, params?: any) => {},
  poptotop: () => {},
  goBack: () => {},
  replace: (screenName: RouteTypes, params?: any) => {},
  navToTab: () => {},
  navToTest: () => {},
  navToLock: () => {},
  navToWelcome: () => {},

  getRouteState<T>(): T {
    // todo
    return undefined as T
  },

  navToUtxoTools: () => {},

  navToUrl: (url: string) => {},
  navToExplorerTx: (txid: string) => {},
  navToExplorerAddress: (address: string) => {},

  navToMarketPlaceBrc20: (ticker: string) => {},
  navToInscribeBrc20: (ticker: string) => {},
}

export const NavigationContext = React.createContext<NavigationContextType>(initContext)

export function useNavigation() {
  const ctx = useContext(NavigationContext)
  return ctx
}
