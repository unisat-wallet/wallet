import type { AddressHistoryAssetItem, AddressHistorySummaryItem } from '../types/history'

export type HistoryAssetChange = {
  asset: AddressHistoryAssetItem
  /** An empty sign denotes a self-transfer output, not a net asset loss. */
  sign: '+' | '-' | ''
}

const CARRIER_BTC_LIMIT = 0.00001 // 1,000 sats

function isCarrierCoin(asset: AddressHistoryAssetItem, hasOtherAsset: boolean) {
  if (!hasOtherAsset || asset.kind !== 'coin') return false
  const amount = Number(asset.amount)
  return Number.isFinite(amount) && amount >= 0 && amount <= CARRIER_BTC_LIMIT
}

export function getHistoryAssetChanges(item: AddressHistorySummaryItem) {
  const hasOtherAsset = [...item.received, ...item.sent].some(asset => asset.kind !== 'coin')
  const hiddenReceived = item.received.filter(asset => isCarrierCoin(asset, hasOtherAsset)).length
  const hiddenSent = item.sent.filter(asset => isCarrierCoin(asset, hasOtherAsset)).length
  if (item.direction === 'self') {
    // The API places all self-owned outputs, including change, in sent. Keep
    // them neutral; their total is not the user-requested transfer amount.
    const changes = item.sent
      .filter(asset => !isCarrierCoin(asset, hasOtherAsset))
      .map((asset): HistoryAssetChange => ({ asset, sign: '' }))
    return { changes, total: Math.max(item.sentCount - hiddenSent, changes.length) }
  }

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
