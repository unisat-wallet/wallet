import { useCallback, useEffect, useRef, useState } from 'react'

import { useWallet } from '../context'
import { useCurrentAccount } from '../hooks/accounts'
import { useCurrentKeyring } from '../hooks/keyrings'
import { useChainType, useWalletConfig } from '../hooks/settings'
import type { RgbAssetDetail, RgbTransferItem } from '../types'
import { useInfiniteList } from './useInfiniteList'
import { getRgbTokenPrecision } from '../utils/rgb-amount-utils'
import { mergeRgbTransferAssetMetadata } from '../utils/rgb-transfer-metadata'
import { normalizeConfiguredRgbUsdt } from '../utils/rgb-usdt'

const rgbAssetDetailCache = new Map<string, RgbAssetDetail>()
const rgbTransferListCache = new Map<string, { list: RgbTransferItem[]; total: number }>()
const FAST_POLL_DURATION = 60_000
const MEDIUM_POLL_DURATION = 5 * 60_000
const FAST_POLL_INTERVAL = 10_000
const MEDIUM_POLL_INTERVAL = 30_000
const SLOW_POLL_INTERVAL = 60_000

function getPollingInterval(elapsed: number): number {
  if (elapsed < FAST_POLL_DURATION) return FAST_POLL_INTERVAL
  if (elapsed < MEDIUM_POLL_DURATION) return MEDIUM_POLL_INTERVAL
  return SLOW_POLL_INTERVAL
}

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
    ['signed', 'waiting_ack', 'broadcasting', 'broadcasted', 'broadcast_failed', 'pending_accept', 'validation_failed', 'confirming', 'waiting_batch_release', 'waiting_receive', 'pending', 'unconfirmed'].includes(
      item.status.toLowerCase()
    )
  )
}

export function useRGBTransfersLogic({
  enabled = true,
  initialFullSync = false,
  pollingEnabled = true,
  foreground = true,
}: {
  enabled?: boolean
  initialFullSync?: boolean
  pollingEnabled?: boolean
  /** A visible activity surface always loads history; hidden global queues first inspect local state. */
  foreground?: boolean
} = {}) {
  const wallet = useWallet()
  const currentKeyring = useCurrentKeyring()
  const currentAccount = useCurrentAccount()
  const chainType = useChainType()
  const configuredUsdtAssetId = useWalletConfig().rgbUsdtAssetId?.trim() || ''
  const cacheKey = `${chainType}:${currentKeyring?.key || ''}:${currentAccount?.key || ''}:${currentAccount?.address || ''}:${enabled ? '1' : '0'}:${configuredUsdtAssetId}`
  const [loadedCacheKey, setLoadedCacheKey] = useState('')
  const [pendingReceivePoll, setPendingReceivePoll] = useState<{ key: string; pending: boolean }>()
  const skipSyncRef = useRef(!initialFullSync)
  const requestFullSyncRef = useRef(false)
  const pollingStartedAtRef = useRef<number>()

  const fetchTransfers = useCallback(
    async (page: number, pageSize: number) => {
      if (!enabled) return Promise.resolve({ currentPage: page, pageSize, total: 0, list: [] })
      if (!foreground) {
        const { hasPendingActivity } = await wallet.getRgbActivityPollingState()
        if (!hasPendingActivity) {
          setPendingReceivePoll({ key: cacheKey, pending: false })
          if (page === 1) setLoadedCacheKey(cacheKey)
          return { currentPage: page, pageSize, total: 0, list: [] }
        }
      }
      const skipSync = skipSyncRef.current
      skipSyncRef.current = true
      const result = await wallet.getRgbTransfers(page, pageSize, {
        skipSync,
        ...(foreground ? {} : { statusOnly: true }),
      })
      if (skipSync && page === 1) requestFullSyncRef.current = true
      if (page === 1) {
        // An invoice has no transfer row until its consignment is discovered.
        // Keep polling even when the activity list is otherwise empty.
        const invoices = await wallet
          .getRgbPendingReceiveInvoices({ skipSync: true })
          .catch(() => undefined)
        if (invoices) setPendingReceivePoll({ key: cacheKey, pending: invoices.list.length > 0 })
      }
      const assetIds = [...new Set(result.list.map(item => item.assetId).filter(Boolean))] as string[]
      const details = new Map<string, RgbAssetDetail>()
      await Promise.all(
        assetIds.map(async assetId => {
          const detailKey = `${cacheKey}:${assetId}`
          const cachedDetail = rgbAssetDetailCache.get(detailKey)
          if (cachedDetail) details.set(assetId, cachedDetail)
          if (cachedDetail?.precision !== undefined) return
          try {
            const detail = await wallet.getRGBAssetDetail('', assetId)
            if (detail) {
              details.set(assetId, detail)
              // Name-only details can arrive before the local contract is ready.
              // Retry until precision is known; zero is a valid precision.
              if (detail.precision !== undefined && (detail.name || detail.ticker)) {
                rgbAssetDetailCache.set(detailKey, detail)
              }
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
          return normalizeConfiguredRgbUsdt({
            ...enriched,
            precision:
              detail?.precision !== undefined
                ? detailPrecision
                : enriched.precision ?? detailPrecision ?? 0,
          }, configuredUsdtAssetId)
        }),
      }
    },
    [cacheKey, configuredUsdtAssetId, enabled, foreground, wallet]
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
    dependencies: [
      chainType,
      currentKeyring?.key,
      currentAccount?.key,
      currentAccount?.address,
      enabled,
      foreground,
    ],
  })
  const cached = rgbTransferListCache.get(cacheKey)
  const visibleItems = loading && items.length === 0 && cached?.list.length ? cached.list : items
  const visibleTotal = loading && items.length === 0 && cached ? cached.total : total
  const hasInProgressTransfer = visibleItems.some(isInProgress)
  const hasPendingReceiveInvoice =
    pendingReceivePoll?.key === cacheKey && pendingReceivePoll.pending
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
    if (!pollingEnabled || (!hasInProgressTransfer && !hasPendingReceiveInvoice)) {
      pollingStartedAtRef.current = undefined
      return undefined
    }
    const startedAt = pollingStartedAtRef.current ?? Date.now()
    pollingStartedAtRef.current = startedAt
    let timeoutId: ReturnType<typeof setTimeout>
    const schedulePoll = () => {
      const delay = getPollingInterval(Date.now() - startedAt)
      timeoutId = setTimeout(() => {
        skipSyncRef.current = false
        onRefresh()
        schedulePoll()
      }, delay)
    }
    schedulePoll()
    return () => clearTimeout(timeoutId)
  }, [hasInProgressTransfer, hasPendingReceiveInvoice, onRefresh, pollingEnabled])

  return {
    items: visibleItems,
    isCurrentAccountLoaded: loadedCacheKey === cacheKey,
    total: visibleTotal,
    loading,
    hasMore,
    onRefresh,
    onLoadMore,
    pendingCount: visibleItems.filter(isInProgress).length,
  }
}
