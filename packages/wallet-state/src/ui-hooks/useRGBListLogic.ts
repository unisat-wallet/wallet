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
import {
  getRgbAssetPolicies,
  isSameRgbAssetId,
  normalizeConfiguredRgbAsset,
  normalizeConfiguredRgbUsdt,
} from '../utils/rgb-usdt'

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

export function includeConfiguredRgbAssets(
  items: RgbBalance[],
  walletConfig: ReturnType<typeof useWalletConfig>,
  fetchedBalances: RgbBalance[] = []
) {
  const policies = getRgbAssetPolicies(walletConfig)
  if (!policies.length) {
    return includeConfiguredRgbUsdt(items, walletConfig.rgbUsdtAssetId?.trim() || '')
  }

  const normalized = items.map(item => normalizeConfiguredRgbAsset(item, walletConfig))
  for (const policy of policies) {
    if (policy.status === 'disabled' || !policy.showWhenZero) continue
    if (normalized.some(item => isSameRgbAssetId(item.assetId, policy.assetId))) continue
    const fetched = fetchedBalances.find(item => isSameRgbAssetId(item.assetId, policy.assetId))
    normalized.push(normalizeConfiguredRgbAsset(fetched || {
      assetId: policy.assetId,
      name: policy.displayName || policy.ticker || 'RGB',
      ticker: policy.ticker || policy.displayName || 'RGB',
      balance: '0',
      spendable: '0',
      configuredPlaceholder: true,
    }, walletConfig))
  }

  const policyOrder = new Map(
    policies.map(policy => [
      policy.assetId.replace(/^rgb:/i, '').toLowerCase(),
      policy.sortOrder ?? 0,
    ])
  )
  return normalized
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftOrder = policyOrder.get(left.item.assetId.replace(/^rgb:/i, '').toLowerCase())
      const rightOrder = policyOrder.get(right.item.assetId.replace(/^rgb:/i, '').toLowerCase())
      if (leftOrder === undefined && rightOrder === undefined) return left.index - right.index
      if (leftOrder === undefined) return 1
      if (rightOrder === undefined) return -1
      return rightOrder - leftOrder || left.index - right.index
    })
    .map(entry => entry.item)
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
  const walletConfig = useWalletConfig()
  const configuredAssetPolicies = useMemo(() => getRgbAssetPolicies(walletConfig), [walletConfig])
  const zeroBalancePolicyIds = useMemo(
    () => configuredAssetPolicies
      .filter(policy => policy.showWhenZero && policy.status !== 'disabled')
      .map(policy => policy.assetId),
    [configuredAssetPolicies]
  )
  const walletView = useWalletView()
  const isFocus = focused ?? walletView === WalletView.RGB
  const [fundingAddress, setFundingAddress] = useState('')
  const [fundingBalance, setFundingBalance] = useState(0)
  const [configuredAssetBalances, setConfiguredAssetBalances] = useState<RgbBalance[]>([])

  const supportedAssets = getSupportedAssets(chainType, '', {
    keyringType: currentKeyring?.type,
  })
  const isRgbSupported = supportedAssets.assets.rgb

  useEffect(() => {
    let active = true
    setConfiguredAssetBalances([])
    if (enabled && isRgbSupported && zeroBalancePolicyIds.length) {
      void Promise.all(zeroBalancePolicyIds.map(assetId =>
        wallet.getRGBAssetBalance('', assetId).catch(() => undefined)
      )).then(balances => {
        if (active) setConfiguredAssetBalances(balances.filter(Boolean) as RgbBalance[])
      })
    }
    return () => {
      active = false
    }
  }, [enabled, isRgbSupported, zeroBalancePolicyIds.join('|'), chainType, currentKeyring?.key, currentAccount?.key, wallet])

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
    () => enabled && isRgbSupported
      ? includeConfiguredRgbAssets(items, walletConfig, configuredAssetBalances)
      : items,
    [items, enabled, isRgbSupported, walletConfig, configuredAssetBalances]
  )
  const injectedCount = visibleItems.filter(item =>
    !items.some(existing => isSameRgbAssetId(existing.assetId, item.assetId))
  ).length
  const visibleTotal = total + injectedCount
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
