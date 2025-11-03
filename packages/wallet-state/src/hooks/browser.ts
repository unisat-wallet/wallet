import { AppState } from '..'
import { useAppSelector } from '../hooks'

export function useBrowserState(): AppState['browser'] {
  return useAppSelector(state => state.browser)
}

export function useWalletTabScreenState() {
  const state = useBrowserState()
  return state.walletTabScreen
}
