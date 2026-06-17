import { useCallback, useEffect, useMemo, useState } from 'react'

import type { RgbActivityItem, RgbActivityType, RgbAssetDetail, RgbBalance } from '..'
import { useCurrentAccount, useI18n, useNavigation, useWallet } from '..'
import { useInfiniteList } from './useInfiniteList'

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
  const wallet = useWallet()
  const account = useCurrentAccount()
  const { t } = useI18n()

  const [detail, setDetail] = useState<RgbAssetDetail>()
  const [detailLoading, setDetailLoading] = useState(true)
  const [fetchedTokenBalance, setFetchedTokenBalance] = useState<RgbBalance>()
  const [balanceLoading, setBalanceLoading] = useState(!tokenBalance)
  const [activityType, setActivityType] = useState<RgbActivityType | undefined>()
  const [activeTab, setActiveTab] = useState<RGBTokenScreenTabKey>(RGBTokenScreenTabKey.DETAILS)

  const loadDetail = useCallback(async () => {
    if (account.address === '' || assetId === '') {
      setDetail(undefined)
      setDetailLoading(false)
      return
    }

    setDetailLoading(true)
    try {
      const data = await wallet.getRGBAssetDetail(account.address, assetId)
      setDetail(data)
    } finally {
      setDetailLoading(false)
    }
  }, [account.address, assetId, wallet])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const loadBalance = useCallback(async () => {
    if (tokenBalance) {
      setFetchedTokenBalance(undefined)
      setBalanceLoading(false)
      return
    }

    if (account.address === '' || assetId === '') {
      setFetchedTokenBalance(undefined)
      setBalanceLoading(false)
      return
    }

    setBalanceLoading(true)
    try {
      const data = await wallet.getRGBAssetBalance(account.address, assetId)
      setFetchedTokenBalance(data)
    } catch (e) {
      setFetchedTokenBalance(undefined)
    } finally {
      setBalanceLoading(false)
    }
  }, [account.address, assetId, tokenBalance, wallet])

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
      if (account.address === '' || assetId === '') {
        return { list: [], total: 0 }
      }

      const { list, total } = await wallet.getRGBAssetActivity(
        account.address,
        assetId,
        page,
        pageSize,
        activityType
      )
      return { list, total }
    },
    dependencies: [account.address, assetId, activityType],
  })

  const onRefresh = useCallback(() => {
    loadDetail()
    loadBalance()
    onRefreshActivity()
  }, [loadDetail, loadBalance, onRefreshActivity])

  const resolvedTokenBalance = tokenBalance || fetchedTokenBalance || detail?.balance

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
  const iconInfo = {
    iconUrl: detail?.['iconUrl'] || resolvedTokenBalance?.['iconUrl'] || '',
    iconShortName: ticker.slice(0, 2).toUpperCase(),
  }

  const transferBalance =
    resolvedTokenBalance?.spendable ||
    detail?.balance?.spendable ||
    resolvedTokenBalance?.balance ||
    detail?.balance?.balance ||
    resolvedTokenBalance?.amount
  const enableTransfer = !!assetId && hasPositiveAmount(transferBalance)

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
