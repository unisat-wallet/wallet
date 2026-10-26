import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { BUS_METHODS } from '@unisat/wallet-shared'
import { useNavigation } from '../context/NavigationContext'
import { useWallet } from '../context/WalletContext'
import { useWallTabFocusRefresh } from '../hooks/global'
import { useCurrentKeyring } from '../hooks/keyrings'
import { useCurrentAccount } from '../hooks/accounts'
import { useChainType, useWalletConfig } from '../hooks/settings'
import { getSupportedAssets, useWalletView } from '../hooks/ui'
import type { RgbBalance } from '../types'
import { WalletView } from '../types/ui'
import { useInfiniteList } from './useInfiniteList'
import { uiEventBus } from '../utils/eventBus'
import { isSameRgbAssetId, normalizeConfiguredRgbUsdt } from '../utils/rgb-usdt'

export const UNCONFIGURED_RGB_USDT_ASSET_ID = '-'

export function includeConfiguredRgbUsdt(items: RgbBalance[], assetId: string, balance?: RgbBalance) {
  if (!assetId) return items
  if (assetId === UNCONFIGURED_RGB_USDT_ASSET_ID) {
    return [{
      assetId,
      name: 'USDT',
      ticker: 'USDT',
      balance: '0',
      spendable: '0',
      configuredUsdt: true,
      configuredPlaceholder: true,
      configurationUnavailable: true,
    }, ...items]
  }
  const existing = items.find(item => isSameRgbAssetId(item.assetId, assetId)) || balance
  const usdt: RgbBalance = existing
    ? { ...normalizeConfiguredRgbUsdt(existing, assetId), configuredUsdt: true }
    : { assetId, name: 'USDT', ticker: 'USDT', balance: '0', spendable: '0', configuredUsdt: true, configuredPlaceholder: true }
  return [usdt, ...items.filter(item => !isSameRgbAssetId(item.assetId, assetId))]
}

export function useRGBListLogic({
  autoRefresh = false,
  enabled = true,
  focused,
}: { autoRefresh?: boolean; enabled?: boolean; focused?: boolean } = {}) {
  const nav = useNavigation()
  const wallet = useWallet()
  const currentKeyring = useCurrentKeyring()
  const currentAccount = useCurrentAccount()
  const chainType = useChainType()
  const configuredUsdtAssetId = useWalletConfig().rgbUsdtAssetId?.trim() || ''
  const walletView = useWalletView()
  const isFocus = focused ?? walletView === WalletView.RGB
  const [fundingAddress, setFundingAddress] = useState('')
  const [fundingBalance, setFundingBalance] = useState(0)
  const [configuredUsdtBalance, setConfiguredUsdtBalance] = useState<RgbBalance>()

  const supportedAssets = getSupportedAssets(chainType, '', {
    keyringType: currentKeyring?.type,
  })
  const isRgbSupported = supportedAssets.assets.rgb

  useEffect(() => {
    let active = true
    setConfiguredUsdtBalance(undefined)
    if (enabled && isRgbSupported && configuredUsdtAssetId && configuredUsdtAssetId !== UNCONFIGURED_RGB_USDT_ASSET_ID) {
      void wallet.getRGBAssetBalance('', configuredUsdtAssetId)
        .then(balance => {
          if (active) setConfiguredUsdtBalance(balance)
        })
        .catch(() => undefined)
    }
    return () => {
      active = false
    }
  }, [enabled, isRgbSupported, configuredUsdtAssetId, chainType, currentKeyring?.key, currentAccount?.key, wallet])

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
    hasLoaded,
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
  const visibleItems = useMemo(
    () => includeConfiguredRgbUsdt(
      items,
      enabled && isRgbSupported ? configuredUsdtAssetId : '',
      configuredUsdtBalance && isSameRgbAssetId(configuredUsdtBalance.assetId, configuredUsdtAssetId)
        ? configuredUsdtBalance
        : undefined
    ),
    [items, enabled, isRgbSupported, configuredUsdtAssetId, configuredUsdtBalance]
  )
  const usdtAlreadyCounted = configuredUsdtAssetId !== UNCONFIGURED_RGB_USDT_ASSET_ID && (
    items.some(item => configuredUsdtAssetId && isSameRgbAssetId(item.assetId, configuredUsdtAssetId)) ||
    !!(configuredUsdtBalance && isSameRgbAssetId(configuredUsdtBalance.assetId, configuredUsdtAssetId))
  )
  const visibleTotal = total + (enabled && isRgbSupported && configuredUsdtAssetId && !usdtAlreadyCounted ? 1 : 0)
  const walletTabFocusRefresh = useWallTabFocusRefresh()

  useEffect(() => {
    if (!enabled || !isFocus) return

    const alreadyRefreshed = lastRefreshTimeRef.current === walletTabFocusRefresh
    if (alreadyRefreshed) return

    refreshFundingAddress()
    refreshList({ showLoading: false })
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
      refreshList({ showLoading: false })
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
    items: visibleItems,
    total: visibleTotal,
    loading,
    showLoading,
    hasLoaded,
    hasMore,
    fundingAddress,
    fundingBalance,
    onRefresh: refresh,
    onLoadMore,
    onClickItem,
  }
}
