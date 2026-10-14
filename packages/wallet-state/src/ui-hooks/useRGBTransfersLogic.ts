import { useCallback, useEffect, useRef, useState } from 'react'

import { useWallet } from '../context'
import { useCurrentAccount } from '../hooks/accounts'
import { useCurrentKeyring } from '../hooks/keyrings'
import { useChainType } from '../hooks/settings'
import type { RgbAssetDetail, RgbTransferItem, RgbTransferNotification } from '../types'
import { useInfiniteList } from './useInfiniteList'
import { getRgbTokenPrecision } from '../utils/rgb-amount-utils'
import { mergeRgbTransferAssetMetadata } from '../utils/rgb-transfer-metadata'

const rgbAssetDetailCache = new Map<string, RgbAssetDetail>()
const rgbTransferListCache = new Map<string, { list: RgbTransferItem[]; total: number }>()

function isInProgress(item: RgbTransferItem) {
  if (
    ['canceled', 'cancelled', 'rejected', 'settled', 'confirmed', 'failed'].includes(
      item.status.toLowerCase()
    )
  ) {
    return false
  }
  return (
    item.local ||
    ['signed', 'waiting_ack', 'broadcasting', 'broadcasted', 'broadcast_failed', 'pending_accept', 'confirming', 'waiting_receive', 'pending', 'unconfirmed'].includes(
      item.status.toLowerCase()
    )
  )
}

export function useRGBTransfersLogic({
  enabled = true,
  initialFullSync = false,
  pollingEnabled = true,
}: { enabled?: boolean; initialFullSync?: boolean; pollingEnabled?: boolean } = {}) {
  const wallet = useWallet()
  const currentKeyring = useCurrentKeyring()
  const currentAccount = useCurrentAccount()
  const chainType = useChainType()
  const cacheKey = `${chainType}:${currentKeyring?.key || ''}:${currentAccount?.key || ''}:${enabled ? '1' : '0'}`
  const [loadedCacheKey, setLoadedCacheKey] = useState('')
  const skipSyncRef = useRef(!initialFullSync)
  const requestFullSyncRef = useRef(false)

  const fetchTransfers = useCallback(
    async (page: number, pageSize: number) => {
      if (!enabled) return Promise.resolve({ currentPage: page, pageSize, total: 0, list: [] })
      const skipSync = skipSyncRef.current
      skipSyncRef.current = true
      const result = await wallet.getRgbTransfers(page, pageSize, { skipSync })
      if (skipSync && page === 1) requestFullSyncRef.current = true
      const assetIds = [...new Set(result.list.map(item => item.assetId).filter(Boolean))] as string[]
      const details = new Map<string, RgbAssetDetail>()
      await Promise.all(
        assetIds.map(async assetId => {
          const detailKey = `${cacheKey}:${assetId}`
          const cachedDetail = rgbAssetDetailCache.get(detailKey)
          if (cachedDetail) {
            details.set(assetId, cachedDetail)
            return
          }
          try {
            const detail = await wallet.getRGBAssetDetail('', assetId)
            if (detail) {
              details.set(assetId, detail)
              if (detail.name || detail.ticker) rgbAssetDetailCache.set(detailKey, detail)
            }
          } catch {
            // Retry on the next refresh when local asset metadata becomes available.
          }
        })
      )
      if (page === 1) setLoadedCacheKey(cacheKey)
      return {
        ...result,
        list: result.list.map(item => {
          const detail = details.get(item.assetId || '')
          const enriched = mergeRgbTransferAssetMetadata(item, detail)
          const detailPrecision = detail ? getRgbTokenPrecision(detail) : undefined
          return {
            ...enriched,
            precision:
              detail?.precision !== undefined
                ? detailPrecision
                : enriched.precision ?? detailPrecision ?? 0,
          }
        }),
      }
    },
    [cacheKey, enabled, wallet]
  )
  const {
    data: items,
    total,
    loading,
    hasMore,
    onRefresh,
    onLoadMore,
  } = useInfiniteList<RgbTransferItem>({
    fetcher: fetchTransfers,
    dependencies: [chainType, currentKeyring?.key, currentAccount?.key, enabled],
  })
  const cached = rgbTransferListCache.get(cacheKey)
  const visibleItems = loading && items.length === 0 && cached?.list.length ? cached.list : items
  const visibleTotal = loading && items.length === 0 && cached ? cached.total : total
  const hasInProgressTransfer = visibleItems.some(isInProgress)
  const previousStatusByTransfer = useRef(new Map<string, string>())
  const notifiedTransferEvents = useRef(new Set<string>())
  const [notifications, setNotifications] = useState<RgbTransferNotification[]>([])

  useEffect(() => {
    skipSyncRef.current = !initialFullSync
    requestFullSyncRef.current = false
  }, [cacheKey, initialFullSync])

  useEffect(() => {
    if (loading) return
    rgbTransferListCache.set(cacheKey, { list: items, total })
  }, [cacheKey, items, loading, total])

  useEffect(() => {
    if (!enabled || loading || !requestFullSyncRef.current) return
    requestFullSyncRef.current = false
    skipSyncRef.current = false
    onRefresh()
  }, [enabled, items, loading, onRefresh])

  useEffect(() => {
    const currentStatusByTransfer = new Map<string, string>()
    for (const item of items) {
      const transferKey = item.txid || item.transferId || item.id
      const status = item.status.toLowerCase()
      const previousStatus = previousStatusByTransfer.current.get(transferKey)
      const newlyBroadcast =
        previousStatus === 'waiting_ack' &&
        ['broadcasting', 'broadcasted', 'confirming', 'pending', 'unconfirmed', 'settled', 'confirmed'].includes(status)
      const notificationKind =
        item.type === 'send' && newlyBroadcast
          ? 'broadcasted'
          : item.type === 'receive' &&
              ['confirming', 'waiting_receive', 'pending', 'unconfirmed'].includes(previousStatus || '') &&
              ['settled', 'confirmed'].includes(status)
            ? 'receive_confirmed'
            : undefined
      if (notificationKind) {
        const eventId = `${notificationKind}:${transferKey}`
        if (!notifiedTransferEvents.current.has(eventId)) {
          notifiedTransferEvents.current.add(eventId)
          setNotifications(current => [...current, { kind: notificationKind, transfer: item }])
        }
      }
      currentStatusByTransfer.set(transferKey, status)
    }
    previousStatusByTransfer.current = currentStatusByTransfer
  }, [items])

  useEffect(() => {
    if (!pollingEnabled || !hasInProgressTransfer) return undefined
    const intervalId = setInterval(() => {
      skipSyncRef.current = false
      onRefresh()
    }, 10_000)
    return () => clearInterval(intervalId)
  }, [hasInProgressTransfer, onRefresh, pollingEnabled])

  return {
    items: visibleItems,
    isCurrentAccountLoaded: loadedCacheKey === cacheKey,
    total: visibleTotal,
    loading,
    hasMore,
    onRefresh,
    onLoadMore,
    pendingCount: visibleItems.filter(isInProgress).length,
    notification: notifications[0],
    dismissNotification: () => setNotifications(current => current.slice(1)),
  }
}
