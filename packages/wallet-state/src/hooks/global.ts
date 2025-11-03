import { useCallback } from 'react'

import { AddressType } from '@unisat/wallet-types'

import { AppState, useNavigation } from '..'
import { useAppDispatch, useAppSelector } from './base'
import { globalActions } from '../reducers/global'
import { useWallet } from '../context/WalletContext'
import { useApproval } from './approval'
import { TabOption } from '../types'

export function useGlobalState(): AppState['global'] {
  return useAppSelector(state => state.global)
}

export function useTab() {
  const globalState = useGlobalState()
  return globalState.tab
}

export function useScreenState() {
  const globalState = useGlobalState()
  return globalState.screenState
}

export function useUpdateScreenStateCallback() {
  const dispatch = useAppDispatch()
  return useCallback(
    (screenState: Partial<AppState['global']['screenState']>) => {
      dispatch(
        globalActions['updateScreenState']!({
          screenState,
        })
      )
    },
    [dispatch]
  )
}

export function useSetTabCallback() {
  const dispatch = useAppDispatch()
  return useCallback(
    (tab: TabOption) => {
      dispatch(
        globalActions['update']!({
          tab,
        })
      )
    },
    [dispatch]
  )
}

export function useBooted() {
  const globalState = useGlobalState()
  return globalState.isBooted
}

export function useIsUnlocked() {
  const globalState = useGlobalState()
  return globalState.isUnlocked
}

export function useIsReady() {
  const globalState = useGlobalState()
  return globalState.isReady
}

export function useIsRefresh() {
  const globalState = useGlobalState()
  return globalState.isRefresh
}

export function useBackRefresh() {
  const globalState = useGlobalState()
  return globalState.backRefresh
}

export function useWallRefresh() {
  const globalState = useGlobalState()
  return globalState.wallRefresh
}

export function useWallTabRefresh() {
  const globalState = useGlobalState()
  return globalState.wallTabRefresh
}

export function useWallTabFocusRefresh() {
  const globalState = useGlobalState()
  return globalState.wallTabFocusRefresh
}

export function useGoBackRefresh() {
  const globalState = useGlobalState()
  return globalState.goBackRefresh
}

export function useLayerState() {
  const globalState = useGlobalState()
  return globalState.layerState
}

export function useUnlockRefresh() {
  const globalState = useGlobalState()
  return globalState.unlockRefres
}

export function useUnlockRead() {
  const globalState = useGlobalState()
  return globalState.unlockRead
}
export function useIsUnlockTimeRefres() {
  const globalState = useGlobalState()
  return globalState.isUnlockTimeRefres
}

export function useIsScrollViewModel() {
  const globalState = useGlobalState()
  return globalState.isScrollViewModel
}

export function useIsScrollViewTop() {
  const globalState = useGlobalState()
  return globalState.isScrollViewTop
}

export function useIsScrollViewBot() {
  const globalState = useGlobalState()
  return globalState.isScrollViewBot
}

export function useIsBiometrics() {
  const globalState = useGlobalState()
  return globalState.isBiometrics
}

export function useIsBiometricsKey() {
  const globalState = useGlobalState()
  return globalState.isBiometricsKey
}

export function useSwitchChainModalVisible() {
  const globalState = useGlobalState()
  return globalState.switchChainModalVisible
}

export function useLockCallback() {
  const dispatch = useAppDispatch()
  const wallet = useWallet()
  const navigation = useNavigation()
  return useCallback(async () => {
    await wallet.lockWallet()
    const isBooted = await wallet.isBooted()
    const isUnlocked = await wallet.isUnlocked()
    if (!isBooted) {
      navigation.navToWelcome
      return
    }

    if (!isUnlocked && !isBooted) {
      navigation.navToWelcome
      return
    }

    if (!isUnlocked && isBooted) {
      navigation.navToLock({ fromStartup: true })
      return
    }
    const currentAccount = await wallet.getCurrentAccount()
    if (!currentAccount) {
      navigation.navToWelcome
    }

    dispatch(globalActions.update({ isUnlocked: false }))
  }, [dispatch, wallet])
}

export function useUnlockCallback() {
  const dispatch = useAppDispatch()
  const wallet = useWallet()
  const [, resolveApproval] = useApproval()
  return useCallback(
    async (password: string) => {
      await wallet.unlock(password)
      dispatch(globalActions.update({ isUnlocked: true }))
      resolveApproval()
    },
    [dispatch, wallet]
  )
}

export function useCreateAccountCallback() {
  const dispatch = useAppDispatch()
  const wallet = useWallet()
  return useCallback(
    async (
      mnemonics: string,
      hdPath: string,
      passphrase: string,
      addressType: AddressType,
      accountCount: number
    ) => {
      await wallet.createKeyringWithMnemonics(
        mnemonics,
        hdPath,
        passphrase,
        addressType,
        accountCount
      )
      dispatch(globalActions.update({ isUnlocked: true }))
    },
    [dispatch, wallet]
  )
}

export function useImportAccountsFromKeystoneCallback() {
  const dispatch = useAppDispatch()
  const wallet = useWallet()
  return useCallback(
    async (
      urType: string,
      urCbor: string,
      addressType: AddressType,
      accountCount: number,
      hdPath: string,
      filterPubkey?: string[],
      connectionType: 'USB' | 'QR' = 'USB'
    ) => {
      await wallet.createKeyringWithKeystone(
        urType,
        urCbor,
        addressType,
        hdPath,
        accountCount,
        filterPubkey,
        connectionType
      )
      dispatch(globalActions.update({ isUnlocked: true }))
    },
    [dispatch, wallet]
  )
}

export function useCreateColdWalletCallback() {
  const dispatch = useAppDispatch()
  const wallet = useWallet()
  return useCallback(
    async (
      xpub: string,
      addressType: AddressType,
      alianName?: string,
      hdPath?: string,
      accountCount?: number
    ) => {
      await wallet.createKeyringWithColdWallet(xpub, addressType, alianName, hdPath, accountCount)
      dispatch(globalActions.update({ isUnlocked: true }))
    },
    [dispatch, wallet]
  )
}
