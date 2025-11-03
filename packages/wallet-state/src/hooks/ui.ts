import { useCallback, useMemo } from 'react'

import { ChainType } from '@unisat/wallet-types'
import { Inscription } from '@unisat/wallet-shared'
import { getAddressType } from '../utils/bitcoin-utils'
import { AddressType } from '@unisat/wallet-types'

import { AppState, AssetTabKey } from '..'
import { useCurrentAccount, useCurrentAddress } from '../hooks/accounts'
import { useAppDispatch, useAppSelector } from '../hooks/base'
import { useChain, useChainType, useNetworkType } from '../hooks/settings'
import { uiActions } from '../reducers/ui'
import { TypeChain } from '@unisat/wallet-shared'
import { useLocation } from 'react-router-dom'
export function useUIState(): AppState['ui'] {
  return useAppSelector(state => state.ui)
}

export function useAssetTabKey() {
  const uiState = useUIState()
  return uiState.assetTabKey
}

export function useOrdinalsAssetTabKey() {
  const uiState = useUIState()
  return uiState.ordinalsAssetTabKey
}

export function useCATAssetTabKey() {
  const uiState = useUIState()
  return uiState.catAssetTabKey
}

export function useAlkanesAssetTabKey() {
  const uiState = useUIState()
  return uiState.alkanesAssetTabKey
}

export function useUiTxCreateScreen() {
  const uiState = useUIState()
  return uiState.uiTxCreateScreen
}

export function useUpdateUiTxCreateScreen() {
  const dispatch = useAppDispatch()
  return ({
    toInfo,
    inputAmount,
    enableRBF,
    feeRate,
  }: {
    toInfo?: { address: string; domain: string; inscription?: Inscription }
    inputAmount?: string
    enableRBF?: boolean
    feeRate?: number
  }) => {
    dispatch((uiActions as any).updateTxCreateScreen({ toInfo, inputAmount, enableRBF, feeRate }))
  }
}

export function useResetUiTxCreateScreen() {
  const dispatch = useAppDispatch()
  return () => {
    dispatch((uiActions as any).resetTxCreateScreen())
  }
}

export const useThrottle = (callback, delay, lastCallRef) => {
  return useCallback(
    (...args) => {
      const now = Date.now()
      if (now - lastCallRef.current > delay) {
        lastCallRef.current = now
        callback(...args)
      }
    },
    [callback, delay, lastCallRef]
  )
}

export function useSupportedAssets() {
  const chainType = useChainType()
  const currentAddress = useCurrentAddress()
  const networkType = useNetworkType()
  const currentAccount = useCurrentAccount()

  const assetTabKeys: AssetTabKey[] = []
  const assets = {
    ordinals: false,
    runes: false,
    CAT20: false,
    alkanes: false,
  }

  assets.ordinals = true
  assetTabKeys.push(AssetTabKey.ORDINALS)

  assets.runes = true
  assetTabKeys.push(AssetTabKey.RUNES)

  if (
    chainType === ChainType.FRACTAL_BITCOIN_MAINNET ||
    chainType === ChainType.FRACTAL_BITCOIN_TESTNET
  ) {
    const addressType = getAddressType(currentAddress, networkType)
    if (addressType == AddressType.P2TR || addressType == AddressType.P2WPKH) {
      assets.CAT20 = true
      assetTabKeys.push(AssetTabKey.CAT)
    }
  }

  if (chainType === ChainType.BITCOIN_SIGNET || chainType === ChainType.BITCOIN_MAINNET) {
    assets.alkanes = true
    assetTabKeys.push(AssetTabKey.ALKANES)
  }

  return {
    tabKeys: assetTabKeys,
    assets,
    key: assetTabKeys.join(','),
  }
}

export const useIsInExpandView = () => {
  // @ts-ignore
  if (typeof window === 'undefined') {
    return false
  }
  return useMemo(() => {
    // @ts-ignore
    if (window.innerWidth > 156 * 3) {
      return true
    } else {
      return false
    }
    // @ts-ignore
  }, [window.innerWidth])
}

export function useWalletTopTabScreenState() {
  const uiState = useUIState()
  return uiState.walletTopTabScreen
}
