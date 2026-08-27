import { useCallback, useEffect, useState } from 'react'

import { useI18n, useWallet } from '..'
import type { RgbActivityItem } from '../types'
import { useInfiniteList } from './useInfiniteList'
import { getRgbTokenPrecision } from '../utils/rgb-amount-utils'

export function useRGBHistoryScreenLogic() {
  const wallet = useWallet()
  const { t } = useI18n()
  const [fundingAddress, setFundingAddress] = useState('')

  const refreshFundingAddress = useCallback(async () => {
    try {
      const { address } = await wallet.getRgbFundingAddress()
      setFundingAddress(address)
    } catch {
      setFundingAddress('')
    }
  }, [wallet])

  useEffect(() => {
    refreshFundingAddress()
  }, [refreshFundingAddress])

  const {
    data: activity,
    total,
    loading,
    hasMore,
    onRefresh,
    onLoadMore,
  } = useInfiniteList<RgbActivityItem>({
    fetcher: async (page, pageSize) => {
      if (!fundingAddress) {
        return { list: [], total: 0 }
      }

      const { list, total } = await wallet.getAddressRgbActivity(
        fundingAddress,
        page,
        pageSize
      )
      const assetIds = [...new Set(list.map(item => item.assetId).filter(Boolean))]
      const precisionEntries = await Promise.all(
        assetIds.map(async assetId => {
          try {
            const detail = await wallet.getRGBAssetDetail('', assetId)
            return [assetId, getRgbTokenPrecision(detail)] as const
          } catch {
            return [assetId, 0] as const
          }
        })
      )
      const precisions = new Map(precisionEntries)
      return {
        list: list.map(item => ({ ...item, precision: item.precision ?? precisions.get(item.assetId) })),
        total,
      }
    },
    dependencies: [fundingAddress],
  })

  const handleRefresh = useCallback(() => {
    refreshFundingAddress()
    onRefresh()
  }, [onRefresh, refreshFundingAddress])

  return {
    activity,
    total,
    loading,
    hasMore,
    onRefresh: handleRefresh,
    onLoadMore,
    t,
  }
}
