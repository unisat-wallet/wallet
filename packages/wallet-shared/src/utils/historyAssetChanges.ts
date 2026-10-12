import type { AddressHistoryAssetItem, AddressHistorySummaryItem } from '../types/history'

export type HistoryAssetChange = {
  asset: AddressHistoryAssetItem
  sign: '+' | '-'
}

const CARRIER_BTC_LIMIT = 0.00001 // 1,000 sats

function isCarrierCoin(asset: AddressHistoryAssetItem, hasOtherAsset: boolean) {
  if (!hasOtherAsset || asset.kind !== 'coin') return false
  const amount = Number(asset.amount)
  return Number.isFinite(amount) && amount >= 0 && amount <= CARRIER_BTC_LIMIT
}

export function getHistoryAssetChanges(item: AddressHistorySummaryItem) {
  // The history API reports gross outputs for self-transfers as sent assets.
  // They have no net asset movement apart from the network fee.
  if (item.direction === 'self') return { changes: [] as HistoryAssetChange[], total: 0 }

  const hasOtherAsset = [...item.received, ...item.sent].some(asset => asset.kind !== 'coin')
  const hiddenReceived = item.received.filter(asset => isCarrierCoin(asset, hasOtherAsset)).length
  const hiddenSent = item.sent.filter(asset => isCarrierCoin(asset, hasOtherAsset)).length
  const received = item.received.filter(asset => !isCarrierCoin(asset, hasOtherAsset))
  const sent = item.sent.filter(asset => !isCarrierCoin(asset, hasOtherAsset))
  const changes: HistoryAssetChange[] = [
    ...received.map((asset): HistoryAssetChange => ({ asset, sign: '+' })),
    ...sent.map((asset): HistoryAssetChange => ({ asset, sign: '-' })),
  ]

  return {
    changes,
    total: Math.max(item.receivedCount + item.sentCount - hiddenReceived - hiddenSent, changes.length),
  }
}
