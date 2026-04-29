import { useCallback, useMemo } from 'react'

import { CHAINS_MAP, Inscription } from '@unisat/wallet-shared'
import { AddressType, ChainType } from '@unisat/wallet-types'
import { getAddressType } from '../utils/bitcoin-utils'

import { AppState, AssetTabKey } from '..'
import { useCurrentAddress } from '../hooks/accounts'
import { useAppDispatch, useAppSelector } from '../hooks/base'
import { useChainType, useIconBaseUrl, useUnisatWebsite } from '../hooks/settings'
import { uiActions } from '../reducers/ui'
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

export function useMoreAssetTabKey() {
  const uiState = useUIState()
  return uiState.moreAssetTabKey
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
  }: {
    toInfo?: { address: string; domain: string; inscription?: Inscription }
    inputAmount?: string
  }) => {
    dispatch(
      (uiActions as any).updateTxCreateScreen({
        toInfo,
        inputAmount,
      })
    )
  }
}

export function useFeeRateBar() {
  const uiState = useUIState()
  return uiState.feeRateBar
}

export function useUpdateFeeRateBar() {
  const dispatch = useAppDispatch()
  return ({
    feeRate,
    feeRateInputVal,
    enableLowFeeRate,
    feeOptionIndex,
    showCustomInput,
  }: {
    feeRate?: number
    feeRateInputVal?: string
    enableLowFeeRate?: boolean
    feeOptionIndex?: number
    showCustomInput?: boolean
  }) => {
    dispatch(
      (uiActions as any).updateFeeRateBar({
        feeRate,
        feeRateInputVal,
        enableLowFeeRate,
        feeOptionIndex,
        showCustomInput,
      })
    )
  }
}

export function useResetFeeRateBar() {
  const dispatch = useAppDispatch()
  return () => {
    dispatch((uiActions as any).resetFeeRateBar())
  }
}

export function useAddressInput() {
  const uiState = useUIState()
  return uiState.addressInput
}

export function useUpdateAddressInput() {
  const dispatch = useAppDispatch()
  return ({ address, domain }: { address?: string; domain?: string }) => {
    dispatch(
      (uiActions as any).updateAddressInput({
        address,
        domain,
      })
    )
  }
}

export function useResetAddressInput() {
  const dispatch = useAppDispatch()
  return () => {
    dispatch((uiActions as any).resetAddressInput())
  }
}

export function useAmountInput() {
  const uiState = useUIState()
  return uiState.amountInput
}

export function useUpdateAmountInput() {
  const dispatch = useAppDispatch()
  return ({ amount }: { amount?: string }) => {
    dispatch(
      (uiActions as any).updateAmountInput({
        amount,
      })
    )
  }
}

export function useResetAmountInput() {
  const dispatch = useAppDispatch()
  return () => {
    dispatch((uiActions as any).resetAmountInput())
  }
}

export function useResetTxState() {
  const dispatch = useAppDispatch()
  return () => {
    dispatch((uiActions as any).resetTxCreateScreen())
    dispatch((uiActions as any).resetFeeRateBar())
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

export function getSupportedAssets(chainType: ChainType, address: string) {
  const assetTabKeys: AssetTabKey[] = []

  const chain = CHAINS_MAP[chainType]
  const networkType = chain.networkType
  const addressType = getAddressType(address, networkType)

  const assets = {
    ordinals: false,
    runes: false,
    CAT20: false,
    alkanes: false,
    brc20Prog: false,
  }

  assets.ordinals = true
  assetTabKeys.push(AssetTabKey.ORDINALS)

  assets.runes = true
  assetTabKeys.push(AssetTabKey.RUNES)

  if (
    (chainType === ChainType.FRACTAL_BITCOIN_MAINNET ||
      chainType === ChainType.FRACTAL_BITCOIN_TESTNET) &&
    (addressType == AddressType.P2TR || addressType == AddressType.P2WPKH)
  ) {
    assets.CAT20 = true
    assetTabKeys.push(AssetTabKey.CAT)
  }

  if (chainType === ChainType.BITCOIN_MAINNET || chainType === ChainType.BITCOIN_SIGNET) {
    assets.alkanes = true
    assetTabKeys.push(AssetTabKey.MORE)
  }

  if (chainType === ChainType.BITCOIN_MAINNET || chainType === ChainType.BITCOIN_SIGNET) {
    assets.brc20Prog = true
  }

  return {
    assets,
    tabKeys: assetTabKeys,
    key: chainType + address + assetTabKeys.join(','),
  }
}
export function useSupportedAssets() {
  const chainType = useChainType()
  const currentAddress = useCurrentAddress()
  const supportedAssets = getSupportedAssets(chainType, currentAddress)
  return supportedAssets
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

export function useBRC20IconInfo(ticker: string) {
  const baseUrl = useIconBaseUrl()
  const iconUrl = `${baseUrl}/brc20/${ticker}`
  const iconShortName = ticker.substring(0, 2)
  const chainType = useChainType()
  if (chainType === ChainType.BITCOIN_MAINNET || chainType === ChainType.FRACTAL_BITCOIN_MAINNET) {
    return { iconUrl, iconShortName }
  }

  return { iconUrl: '', iconShortName }
}

export function useRunesIconInfo(spacedRune: string) {
  const baseUrl = useIconBaseUrl()
  const iconUrl = `${baseUrl}/runes/${spacedRune}`
  const iconShortName = spacedRune.substring(0, 2)
  const chainType = useChainType()
  if (chainType === ChainType.BITCOIN_MAINNET || chainType === ChainType.FRACTAL_BITCOIN_MAINNET) {
    return { iconUrl, iconShortName }
  }

  return { iconUrl: '', iconShortName }
}

export function useAlkanesIconInfo(name: string, alkaneid: string) {
  const baseUrl = useIconBaseUrl()
  const iconUrl = `${baseUrl}/alkanes/${name}/${alkaneid}`
  const iconShortName = name.substring(0, 2)
  const chainType = useChainType()
  if (chainType === ChainType.BITCOIN_MAINNET || chainType === ChainType.FRACTAL_BITCOIN_MAINNET) {
    return { iconUrl, iconShortName }
  }

  return { iconUrl: '', iconShortName }
}

export function useCAT20IconInfo(name: string, tokenId: string) {
  const baseUrl = useIconBaseUrl()
  const iconUrl = `${baseUrl}/cat20/${name}/${tokenId}`
  const iconShortName = name.substring(0, 2)
  const chainType = useChainType()
  if (chainType === ChainType.BITCOIN_MAINNET || chainType === ChainType.FRACTAL_BITCOIN_MAINNET) {
    return { iconUrl, iconShortName }
  }

  return { iconUrl: '', iconShortName }
}

export function useBRC20MarketPlaceWebsite(ticker: string) {
  const chainType = useChainType()
  const unisatWebsite = useUnisatWebsite()
  if (chainType === ChainType.BITCOIN_MAINNET) {
    if (ticker.length == 6) {
      return `${unisatWebsite}/market/brc20_prog?tick=${ticker}`
    }
  }
  return `${unisatWebsite}/market/brc20?tick=${ticker}`
}

export function useRunesMarketUrl(ticker: string) {
  const unisatWebsite = useUnisatWebsite()
  return `${unisatWebsite}/runes/market?tick=${ticker}`
}

export function useAlkanesMarketPlaceWebsite(alkaneid: string) {
  const unisatWebsite = useUnisatWebsite()
  return `${unisatWebsite}/alkanes/market?tick=${alkaneid}`
}

export function useCAT20MarketPlaceWebsite(tokenId: string) {
  const unisatWebsite = useUnisatWebsite()
  return `${unisatWebsite}/dex/cat20/${tokenId}`
}

export function useRunesInscribeUrl(rune: string) {
  const unisatWebsite = useUnisatWebsite()
  const newUrl = `${unisatWebsite}/runes/inscribe?only=1&tab=mint&rune=${rune}`
  return newUrl
}

export function useBalanceCardDetailExpanded() {
  const uiState = useUIState()
  return uiState.balanceDetailExpanded
}

export function useToggleBalanceCardDetailExpanded() {
  const { balanceDetailExpanded } = useUIState()
  const dispatch = useAppDispatch()
  return useCallback(() => {
    dispatch((uiActions as any).setBalanceDetailExpanded(!balanceDetailExpanded))
  }, [dispatch, balanceDetailExpanded])
}
