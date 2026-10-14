import { useCallback, useEffect, useMemo, useState } from 'react'

import type { RgbActivityItem, RgbActivityType, RgbAssetDetail, RgbBalance } from '..'
import { useI18n, useNavigation, useWallet } from '..'
import { getRgbIconShortName } from '../utils/rgb-amount-utils'
import { useInfiniteList } from './useInfiniteList'

export enum RGBTokenScreenTabKey {
  DETAILS = 'details',
  HISTORY = 'history',
}

const LOCAL_ACTIVITY_STATUSES = new Set([
  'signed',
  'waiting_ack',
  'broadcasting',
  'broadcasted',
  'broadcast_failed',
  'pending_accept',
  'confirming',
  'waiting_receive',
  'pending',
  'unconfirmed',
  'canceled',
  'cancelled',
  'rejected',
])

function isSameRgbAssetId(left?: string, right?: string) {
  const normalize = (value?: string) => value?.replace(/^rgb:/, '')
  return !!left && !!right && normalize(left) === normalize(right)
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
    if (assetId === '') {
      setDetail(undefined)
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
  }, [assetId, wallet])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const loadBalance = useCallback(async () => {
    if (assetId === '') {
      setFetchedTokenBalance(undefined)
      setBalanceLoading(false)
      setBalanceChecked(true)
      return
    }

    setFetchedTokenBalance(undefined)
    setBalanceLoading(true)
    setBalanceChecked(false)
    try {
      const data = await wallet.getRGBAssetBalance('', assetId)
      setFetchedTokenBalance(data)
    } catch (e) {
      setFetchedTokenBalance(undefined)
    } finally {
      setBalanceLoading(false)
      setBalanceChecked(true)
    }
  }, [assetId, wallet])

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
      if (assetId === '') {
        return { list: [], total: 0 }
      }

      const activity = await wallet.getRGBAssetActivity('', assetId, page, pageSize, activityType)
      if (page !== 1) return activity

      // Keep local transfers visible while the indexer catches up, including
      // canceled or rejected records that may never appear in indexed activity.
      const transfers = await wallet.getRgbTransfers(1, 50, { skipSync: true })
      const localItems: RgbActivityItem[] = transfers.list
        .filter(
          transfer =>
            transfer.local &&
            isSameRgbAssetId(transfer.assetId, assetId) &&
            (!activityType || transfer.type === activityType) &&
            LOCAL_ACTIVITY_STATUSES.has(String(transfer.status).toLowerCase())
        )
        .map(transfer => ({
          id: transfer.id,
          transferId: transfer.transferId,
          local: transfer.local,
          assetId: transfer.assetId ?? assetId,
          ticker: transfer.ticker,
          name: transfer.name,
          precision: transfer.precision,
          type: transfer.type,
          status: transfer.status,
          amount: transfer.amount ?? '',
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
    dependencies: [assetId, activityType],
  })

  const onRefresh = useCallback(() => {
    loadDetail()
    loadBalance()
    onRefreshActivity()
  }, [loadDetail, loadBalance, onRefreshActivity])

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

  const tokenSummary = detail
    ? {
        tokenInfo: detail,
        assetInfo: detail,
        tokenBalance: resolvedTokenBalance,
      }
    : undefined

  const ticker =
    detail?.ticker ||
    detail?.name ||
    resolvedTokenBalance?.ticker ||
    resolvedTokenBalance?.name ||
    'RGB'
  const name = detail?.name || resolvedTokenBalance?.name || ticker
  const iconInfo = {
    iconUrl: detail?.['iconUrl'] || resolvedTokenBalance?.['iconUrl'] || '',
    iconShortName: getRgbIconShortName(name, ticker),
  }

  // The route can carry a stale optimistic list balance while a just-broadcast
  // transfer is being reconciled. Only a completed local-balance read may
  // authorize another send; otherwise the same allocation could appear
  // spendable for a brief period before it becomes pending.
  const enableTransfer =
    !!assetId && balanceChecked && hasPositiveAmount(fetchedTokenBalance?.spendable)

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
    nav.navigate('RGBReceiveScreen', {
      assetId,
      tokenBalance: resolvedTokenBalance,
    })
  }
  const onClickSend = () => {
    nav.navigate('SendRGBScreen', {
      assetId,
      tokenBalance: resolvedTokenBalance,
    })
  }

  return {
    assetId,
    tokenBalance: resolvedTokenBalance,
    detail,
    activity,
    total,
    loading: detailLoading || balanceLoading || activityLoading,
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
    activityItems: activity,
    activityTotal: total,
    activityHasMore: hasMore,
    onLoadMoreActivity: onLoadMore,
    onRefreshActivity: onRefresh,
    enableTransfer,
    onClickSend,
    onClickReceive,
  }
}
