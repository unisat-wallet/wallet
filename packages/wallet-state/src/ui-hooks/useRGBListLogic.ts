import { useCallback, useEffect, useRef, useState } from 'react'

import { BUS_METHODS } from '@unisat/wallet-shared'
import { useNavigation } from '../context/NavigationContext'
import { useWallet } from '../context/WalletContext'
import { useWallTabFocusRefresh } from '../hooks/global'
import { useCurrentKeyring } from '../hooks/keyrings'
import { useCurrentAccount } from '../hooks/accounts'
import { useChainType } from '../hooks/settings'
import { getSupportedAssets, useWalletView } from '../hooks/ui'
import type { RgbBalance } from '../types'
import { WalletView } from '../types/ui'
import { useInfiniteList } from './useInfiniteList'
import { uiEventBus } from '../utils/eventBus'

export function useRGBListLogic({
  autoRefresh = false,
  enabled = true,
}: { autoRefresh?: boolean; enabled?: boolean } = {}) {
  const nav = useNavigation()
  const wallet = useWallet()
  const currentKeyring = useCurrentKeyring()
  const currentAccount = useCurrentAccount()
  const chainType = useChainType()
  const walletView = useWalletView()
  const isFocus = walletView === WalletView.RGB
  const [fundingAddress, setFundingAddress] = useState('')
  const [fundingBalance, setFundingBalance] = useState(0)

  const supportedAssets = getSupportedAssets(chainType, '', {
    keyringType: currentKeyring?.type,
  })
  const isRgbSupported = supportedAssets.assets.rgb

  const refreshFundingAddress = useCallback(async () => {
    if (!enabled || !isRgbSupported) {
      setFundingAddress('')
      setFundingBalance(0)
      return
    }

    try {
      const { address } = await wallet.getRgbFundingAddress()
      setFundingAddress(address)
      try {
        const balance = await wallet.getAddressBalanceV2(address)
        setFundingBalance(balance.totalBalance)
      } catch {
        setFundingBalance(0)
      }
    } catch {
      setFundingAddress('')
      setFundingBalance(0)
    }
  }, [enabled, isRgbSupported, wallet])

  useEffect(() => {
    if (!enabled || !isFocus) return
    refreshFundingAddress()
  }, [enabled, isFocus, refreshFundingAddress, currentKeyring?.key, currentAccount?.key, chainType])

  const {
    data: items,
    total,
    loading,
    showLoading,
    hasMore,
    onRefresh: refreshList,
    onLoadMore,
  } = useInfiniteList<RgbBalance>({
    fetcher: async (page, pageSize) => {
      if (!enabled || !isRgbSupported) {
        return { list: [], total: 0 }
      }
      const { list, total } = await wallet.getRGBList('', page, pageSize, { skipSync: !isFocus })
      return { list, total }
    },
    dependencies: [
      chainType,
      currentKeyring?.key,
      currentKeyring?.type,
      currentAccount?.key,
      enabled,
      isRgbSupported,
      isFocus,
    ],
  })
  const lastRefreshTimeRef = useRef<number>(0)
  const walletTabFocusRefresh = useWallTabFocusRefresh()

  useEffect(() => {
    if (!enabled || !isFocus) return

    const alreadyRefreshed = lastRefreshTimeRef.current === walletTabFocusRefresh
    if (alreadyRefreshed) return

    refreshFundingAddress()
    refreshList()
    lastRefreshTimeRef.current = walletTabFocusRefresh
  }, [enabled, walletTabFocusRefresh, isFocus, refreshList, refreshFundingAddress])

  useEffect(() => {
    if (!autoRefresh || !enabled || !isFocus || !isRgbSupported) return undefined

    const intervalId = setInterval(() => {
      refreshFundingAddress()
      refreshList({ showLoading: false })
    }, 5000)

    return () => clearInterval(intervalId)
  }, [autoRefresh, enabled, isFocus, isRgbSupported, refreshList, refreshFundingAddress])

  useEffect(() => {
    const handleRgbAssetsChanged = () => {
      if (!enabled || !isFocus || !isRgbSupported) return
      refreshFundingAddress()
      refreshList()
    }

    uiEventBus.addEventListener(BUS_METHODS.RGB_ASSETS_CHANGED, handleRgbAssetsChanged)
    return () => {
      uiEventBus.removeEventListener(BUS_METHODS.RGB_ASSETS_CHANGED, handleRgbAssetsChanged)
    }
  }, [enabled, isFocus, isRgbSupported, refreshList, refreshFundingAddress])

  const onClickItem = (item: RgbBalance) => {
    const assetId = item.assetId
    if (!assetId) return

    nav.navigate('RGBTokenScreen', { assetId, tokenBalance: item })
  }

  const refresh = useCallback(() => {
    if (enabled && isFocus) {
      refreshFundingAddress()
    }
    refreshList()
  }, [enabled, isFocus, refreshList, refreshFundingAddress])

  return {
    items,
    total,
    loading,
    showLoading,
    hasMore,
    fundingAddress,
    fundingBalance,
    onRefresh: refresh,
    onLoadMore,
    onClickItem,
  }
}
