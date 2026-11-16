import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { RgbActivityItem, RgbActivityType, RgbAssetDetail, RgbBalance } from '..'
import { useI18n, useNavigation, useWallet, useWalletConfig } from '..'
import { getRgbIconShortName } from '../utils/rgb-amount-utils'
import {
  findRgbAssetPolicy,
  isSameRgbAssetId,
  normalizeConfiguredRgbAsset,
} from '../utils/rgb-usdt'
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
  const walletConfig = useWalletConfig()
  const assetPolicy = findRgbAssetPolicy(assetId, walletConfig)
  const wallet = useWallet()
  const { t } = useI18n()

  const [detail, setDetail] = useState<RgbAssetDetail>()
  const [detailLoading, setDetailLoading] = useState(true)
  const [fetchedTokenBalance, setFetchedTokenBalance] = useState<RgbBalance>()
  const [balanceLoading, setBalanceLoading] = useState(true)
  const [balanceChecked, setBalanceChecked] = useState(false)
  const [pendingDetails, setPendingDetails] = useState<
    Awaited<ReturnType<typeof wallet.getRgbAssetPendingDetails>>
  >()
  const [pendingDetailsLoading, setPendingDetailsLoading] = useState(false)
  const [pendingDetailsError, setPendingDetailsError] = useState<string>()
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

  useEffect(() => {
    setPendingDetails(undefined)
    setPendingDetailsError(undefined)
  }, [assetId])

  const loadPendingDetails = useCallback(async (forceSync = false) => {
    if (assetId === '' || isUnconfiguredUsdt) return
    setPendingDetailsLoading(true)
    setPendingDetailsError(undefined)
    try {
      const data = await wallet.getRgbAssetPendingDetails({ assetId, forceSync })
      setPendingDetails(data)
      if (data.balance) {
        setFetchedTokenBalance(data.balance)
        setBalanceChecked(true)
      }
    } catch (error) {
      setPendingDetailsError(error instanceof Error ? error.message : String(error))
    } finally {
      setPendingDetailsLoading(false)
    }
  }, [assetId, isUnconfiguredUsdt, wallet])

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
      // The scoped transfer query fetches this asset's remote activity and
      // merges durable local-only rows in one request.
      const transfers = await wallet.getRgbTransfers(page, pageSize, {
        skipSync: false,
        assetId,
        ...(activityType ? { type: activityType } : {}),
      })
      const scopedTransfers = transfers.list.filter(transfer =>
        isSameRgbAssetId(transfer.assetId, assetId) &&
        (!activityType || transfer.type === activityType)
      )
      const list: RgbActivityItem[] = scopedTransfers.map(transfer => ({
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
      return {
        list,
        total: scopedTransfers.length === transfers.list.length
          ? transfers.total
          : scopedTransfers.length,
      }
    },
    dependencies: [assetId, activityType, isUnconfiguredUsdt],
  })
  const activityRef = useRef<RgbActivityItem[]>([])
  useEffect(() => {
    activityRef.current = activity
  }, [activity])

  const activityStatusPollingRef = useRef(false)
  const pollActivityStatus = useCallback(async () => {
    if (assetId === '' || isUnconfiguredUsdt || activityStatusPollingRef.current) return
    activityStatusPollingRef.current = true
    try {
      const transfers = await wallet.getRgbTransfers(1, 20, {
        skipSync: false,
        assetId,
        ...(activityType ? { type: activityType } : {}),
        statusOnly: true,
      })
      const current = activityRef.current
      const changed = transfers.list
        .filter(transfer => isSameRgbAssetId(transfer.assetId, assetId))
        .some(transfer => {
          const identities = new Set(
            [transfer.transferId, transfer.id, transfer.txid].filter(Boolean)
          )
          const previous = current.find(item =>
            [item.transferId, item.id, item.txid].some(identity => identity && identities.has(identity))
          )
          return !previous ||
            previous.status !== transfer.status ||
            previous.txid !== (transfer.txid ?? '') ||
            previous.rejectionReason !== transfer.rejectionReason
        })
      if (changed) onRefreshActivity({ showLoading: false })
    } catch {
      // Keep the currently rendered history and retry on the next poll.
    } finally {
      activityStatusPollingRef.current = false
    }
  }, [activityType, assetId, isUnconfiguredUsdt, onRefreshActivity, wallet])

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
      void pollActivityStatus()
    }, 10_000)
    return () => clearInterval(intervalId)
  }, [hasActiveActivity, hasPendingBalance, hasLockedBalance, loadBalance, pollActivityStatus])

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
  const displayTokenBalance = resolvedTokenBalance
    ? normalizeConfiguredRgbAsset(resolvedTokenBalance, walletConfig)
    : resolvedTokenBalance
  const displayDetail = detail
    ? normalizeConfiguredRgbAsset(detail, walletConfig)
    : detail
  const displayActivity = activity.map(item => normalizeConfiguredRgbAsset(item, walletConfig))

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
    assetPolicy,
    t,
    activityItems: displayActivity,
    activityTotal: total,
    activityHasMore: hasMore,
    onLoadMoreActivity: onLoadMore,
    onRefreshActivity: onRefresh,
    pendingDetails,
    pendingDetailsLoading,
    pendingDetailsError,
    loadPendingDetails,
    enableTransfer,
    enableReceive,
    onClickSend,
    onClickBurn,
    onClickReceive,
    onClickViewInvoices,
  }
}
