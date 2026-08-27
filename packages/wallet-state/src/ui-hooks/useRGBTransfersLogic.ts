import { useCallback, useEffect, useRef, useState } from 'react'

import { useWallet } from '../context'
import { useCurrentAccount } from '../hooks/accounts'
import { useCurrentKeyring } from '../hooks/keyrings'
import { useChainType } from '../hooks/settings'
import type { RgbTransferItem, RgbTransferNotification } from '../types'
import { useInfiniteList } from './useInfiniteList'
import { getRgbTokenPrecision } from '../utils/rgb-amount-utils'

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

export function useRGBTransfersLogic({ enabled = true }: { enabled?: boolean } = {}) {
  const wallet = useWallet()
  const currentKeyring = useCurrentKeyring()
  const currentAccount = useCurrentAccount()
  const chainType = useChainType()
  const fetchTransfers = useCallback(
    async (page: number, pageSize: number) => {
      if (!enabled) return Promise.resolve({ currentPage: page, pageSize, total: 0, list: [] })
      const result = await wallet.getRgbTransfers(page, pageSize)
      const assetIds = [...new Set(result.list.map(item => item.assetId).filter(Boolean))] as string[]
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
        ...result,
        list: result.list.map(item => ({
          ...item,
          precision: item.precision ?? precisions.get(item.assetId || ''),
        })),
      }
    },
    [enabled, wallet]
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
  const hasInProgressTransfer = items.some(isInProgress)
  const previousStatusByTransfer = useRef(new Map<string, string>())
  const notifiedTransferEvents = useRef(new Set<string>())
  const [notifications, setNotifications] = useState<RgbTransferNotification[]>([])

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
    if (!hasInProgressTransfer) return undefined
    const intervalId = setInterval(onRefresh, 10_000)
    return () => clearInterval(intervalId)
  }, [hasInProgressTransfer, onRefresh])

  return {
    items,
    total,
    loading,
    hasMore,
    onRefresh,
    onLoadMore,
    pendingCount: items.filter(isInProgress).length,
    notification: notifications[0],
    dismissNotification: () => setNotifications(current => current.slice(1)),
  }
}
