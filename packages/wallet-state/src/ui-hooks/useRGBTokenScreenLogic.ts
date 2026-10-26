import { useCallback, useEffect, useMemo, useState } from 'react'

import type { RgbActivityItem, RgbActivityType, RgbAssetDetail, RgbBalance } from '..'
import { useI18n, useNavigation, useWallet, useWalletConfig } from '..'
import { getRgbIconShortName } from '../utils/rgb-amount-utils'
import { isSameRgbAssetId, normalizeConfiguredRgbUsdt } from '../utils/rgb-usdt'
import { useInfiniteList } from './useInfiniteList'
import { UNCONFIGURED_RGB_USDT_ASSET_ID } from './useRGBListLogic'

export enum RGBTokenScreenTabKey {
  DETAILS = 'details',
  HISTORY = 'history',
}

function hasPositiveAmount(value?: string | number | null) {
  if (value === undefined || value === null || value === '') {
    return false
  }
  return Number(value) > 0
}

export function useRGBTokenScreenLogic() {
  const nav = useNavigation()
  const { assetId, tokenBalance } = nav.getRouteState<'RGBTokenScreen'>()
  const isUnconfiguredUsdt = assetId === UNCONFIGURED_RGB_USDT_ASSET_ID
  const configuredUsdtAssetId = useWalletConfig().rgbUsdtAssetId?.trim()
  const isConfiguredUsdt = !!configuredUsdtAssetId && !isUnconfiguredUsdt &&
    isSameRgbAssetId(assetId, configuredUsdtAssetId)
  const wallet = useWallet()
  const { t } = useI18n()

  const [detail, setDetail] = useState<RgbAssetDetail>()
  const [detailLoading, setDetailLoading] = useState(true)
  const [fetchedTokenBalance, setFetchedTokenBalance] = useState<RgbBalance>()
  const [balanceLoading, setBalanceLoading] = useState(true)
  const [balanceChecked, setBalanceChecked] = useState(false)
  const [activityType, setActivityType] = useState<RgbActivityType | undefined>()
  const [activeTab, setActiveTab] = useState<RGBTokenScreenTabKey>(RGBTokenScreenTabKey.HISTORY)

  const loadDetail = useCallback(async () => {
    if (assetId === '' || isUnconfiguredUsdt) {
      setDetail(isUnconfiguredUsdt ? { assetId, ticker: 'USDT', name: 'USDT' } : undefined)
      setDetailLoading(false)
      return
    }

    setDetailLoading(true)
    try {
      const data = await wallet.getRGBAssetDetail('', assetId)
      setDetail(data)
    } finally {
      setDetailLoading(false)
    }
  }, [assetId, isUnconfiguredUsdt, wallet])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const loadBalance = useCallback(async (showLoading = true) => {
    if (assetId === '' || isUnconfiguredUsdt) {
      setFetchedTokenBalance(undefined)
      setBalanceLoading(false)
      setBalanceChecked(true)
      return
    }

    if (showLoading) {
      setFetchedTokenBalance(undefined)
      setBalanceLoading(true)
      setBalanceChecked(false)
    }
    try {
      const data = await wallet.getRGBAssetBalance('', assetId)
      setFetchedTokenBalance(data)
    } catch (e) {
      if (showLoading) setFetchedTokenBalance(undefined)
    } finally {
      setBalanceLoading(false)
      setBalanceChecked(true)
    }
  }, [assetId, isUnconfiguredUsdt, wallet])

  useEffect(() => {
    loadBalance()
  }, [loadBalance])

  const {
    data: activity,
    total,
    loading: activityLoading,
    hasMore,
    onRefresh: onRefreshActivity,
    onLoadMore,
  } = useInfiniteList<RgbActivityItem>({
    fetcher: async (page, pageSize) => {
      if (assetId === '' || isUnconfiguredUsdt) {
        return { list: [], total: 0 }
      }

      if (page !== 1) {
        return wallet.getRGBAssetActivity('', assetId, page, pageSize, activityType)
      }

      // Use the same local transfer rows as the full RGB history. Some states
      // (including ready_to_broadcast and canceled) never reach the indexer.
      // This also advances pending receive consignments while the token page
      // is open; the full RGB history page need not be mounted for progress.
      const [activity, transfers] = await Promise.all([
        wallet.getRGBAssetActivity('', assetId, page, pageSize, activityType),
        wallet.getRgbTransfers(1, 50, { skipSync: false }),
      ])
      const localItems: RgbActivityItem[] = transfers.list
        .filter(
          transfer =>
            transfer.local &&
            isSameRgbAssetId(transfer.assetId, assetId) &&
            (!activityType || transfer.type === activityType)
        )
        .map(transfer => ({
          id: transfer.id,
          transferId: transfer.transferId,
          local: transfer.local,
          burn: transfer.burn,
          assetId: transfer.assetId ?? assetId,
          ticker: transfer.ticker,
          name: transfer.name,
          precision: transfer.precision,
          type: transfer.type,
          status: transfer.status,
          rejectionReason: transfer.rejectionReason,
          canReject: transfer.canReject,
          rejectLocally: transfer.rejectLocally,
          amount: transfer.amount ?? '',
          lockedAmount: transfer.lockedAmount,
          txid: transfer.txid ?? '',
          timestamp: transfer.timestamp,
        }))
      const localTxids = new Set(localItems.map(item => item.txid).filter(Boolean))
      const localIds = new Set(localItems.map(item => item.id))
      const remoteItems = activity.list.filter(
        item => !localIds.has(item.id) && (!item.txid || !localTxids.has(item.txid))
      )
      const list = [...localItems, ...remoteItems].sort(
        (left, right) => right.timestamp - left.timestamp
      )
      return {
        list,
        total:
          activity.list.length >= activity.total
            ? list.length
            : Math.max(activity.total + localItems.length, list.length),
      }
    },
    dependencies: [assetId, activityType, isUnconfiguredUsdt],
  })

  const onRefresh = useCallback(() => {
    loadDetail()
    loadBalance()
    onRefreshActivity()
  }, [loadDetail, loadBalance, onRefreshActivity])

  const hasActiveActivity = activity.some(item =>
    !['settled', 'confirmed', 'failed', 'rejected', 'canceled', 'cancelled'].includes(
      String(item.status || '').toLowerCase()
    )
  )
  const hasPendingBalance = hasPositiveAmount(
    fetchedTokenBalance?.pending ?? tokenBalance?.pending
  )
  const hasLockedBalance = hasPositiveAmount(
    fetchedTokenBalance?.lockedAmount ?? tokenBalance?.lockedAmount
  )

  useEffect(() => {
    if (!hasActiveActivity && !hasPendingBalance && !hasLockedBalance) return undefined
    const intervalId = setInterval(() => {
      void loadBalance(false)
      onRefreshActivity()
    }, 10_000)
    return () => clearInterval(intervalId)
  }, [hasActiveActivity, hasPendingBalance, hasLockedBalance, loadBalance, onRefreshActivity])

  const latestTokenBalance = fetchedTokenBalance || tokenBalance || detail?.balance
  const resolvedPrecision =
    fetchedTokenBalance?.precision ??
    tokenBalance?.precision ??
    detail?.precision ??
    detail?.balance?.precision
  const resolvedTokenBalance =
    latestTokenBalance && resolvedPrecision !== undefined
      ? { ...latestTokenBalance, precision: resolvedPrecision }
      : latestTokenBalance
  const displayTokenBalance = resolvedTokenBalance && isConfiguredUsdt
    ? { ...resolvedTokenBalance, name: 'USDT', ticker: 'USDT' }
    : resolvedTokenBalance
  const displayDetail = detail && isConfiguredUsdt
    ? { ...detail, name: 'USDT', ticker: 'USDT' }
    : detail
  const displayActivity = isConfiguredUsdt
    ? activity.map(item => normalizeConfiguredRgbUsdt(item, configuredUsdtAssetId))
    : activity

  const tokenSummary = displayDetail
    ? {
        tokenInfo: displayDetail,
        assetInfo: displayDetail,
        tokenBalance: displayTokenBalance,
      }
    : undefined

  const ticker =
    displayDetail?.ticker ||
    displayDetail?.name ||
    displayTokenBalance?.ticker ||
    displayTokenBalance?.name ||
    'RGB'
  const name = displayDetail?.name || displayTokenBalance?.name || ticker
  const iconInfo = {
    assetId,
    iconUrl: detail?.['iconUrl'] || resolvedTokenBalance?.['iconUrl'] || '',
    iconShortName: getRgbIconShortName(name, ticker),
  }

  // The route can carry a stale optimistic list balance while a just-broadcast
  // transfer is being reconciled. Only a completed local-balance read may
  // authorize another send; otherwise the same allocation could appear
  // spendable for a brief period before it becomes pending.
  const enableTransfer =
    !!assetId && !isUnconfiguredUsdt && balanceChecked && hasPositiveAmount(fetchedTokenBalance?.spendable)
  const enableReceive = !!assetId && !isUnconfiguredUsdt

  const tabItems = useMemo(
    () => [
      {
        key: RGBTokenScreenTabKey.HISTORY,
        label: t('history'),
      },
      {
        key: RGBTokenScreenTabKey.DETAILS,
        label: t('details'),
      },
    ],
    [t]
  )

  const onClickReceive = () => {
    if (isUnconfiguredUsdt) return
    nav.navigate('RGBReceiveScreen', {
      assetId,
      tokenBalance: displayTokenBalance,
    })
  }
  const onClickViewInvoices = () => {
    if (isUnconfiguredUsdt) return
    nav.navigate('RGBInvoiceListScreen', {
      assetId,
      tokenBalance: displayTokenBalance,
    })
  }
  const onClickSend = () => {
    if (isUnconfiguredUsdt) return
    nav.navigate('SendRGBScreen', {
      assetId,
      tokenBalance: displayTokenBalance,
    })
  }
  const onClickBurn = () => {
    if (isUnconfiguredUsdt || String(detail?.schema || resolvedTokenBalance?.schema || '').toUpperCase() !== 'BFA') return
    nav.navigate('SendRGBScreen', { assetId, tokenBalance: displayTokenBalance, burn: true })
  }

  return {
    assetId,
    tokenBalance: displayTokenBalance,
    detail: displayDetail,
    activity: displayActivity,
    total,
    loading: detailLoading || balanceLoading,
    detailLoading,
    balanceLoading,
    activityLoading,
    hasMore,
    activityType,
    setActivityType,
    activeTab,
    setActiveTab,
    tabItems,
    onRefresh,
    onLoadMore,

    tokenSummary,
    iconInfo,
    t,
    activityItems: displayActivity,
    activityTotal: total,
    activityHasMore: hasMore,
    onLoadMoreActivity: onLoadMore,
    onRefreshActivity: onRefresh,
    enableTransfer,
    enableReceive,
    onClickSend,
    onClickBurn,
    onClickReceive,
    onClickViewInvoices,
  }
}
