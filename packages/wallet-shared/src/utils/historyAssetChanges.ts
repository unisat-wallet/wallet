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
  if (item.display?.assetChanges) {
    return {
      changes: item.display.assetChanges,
      total: item.display.assetChanges.length,
    }
  }

  const visibleKinds = item.display?.visibleAssetKinds
  const isVisible = (asset: AddressHistoryAssetItem) => !visibleKinds || visibleKinds.includes(asset.kind)
  const receivedAssets = item.received.filter(isVisible)
  const sentAssets = item.sent.filter(isVisible)
  const receivedCount = visibleKinds ? receivedAssets.length : item.receivedCount
  const sentCount = visibleKinds ? sentAssets.length : item.sentCount
  const hasOtherAsset = [...receivedAssets, ...sentAssets].some(asset => asset.kind !== 'coin')
  const hiddenReceived = receivedAssets.filter(asset => isCarrierCoin(asset, hasOtherAsset)).length
  const hiddenSent = sentAssets.filter(asset => isCarrierCoin(asset, hasOtherAsset)).length
  if (item.display?.balanceEffect === 'neutral') {
    const assets = [...receivedAssets, ...sentAssets]
    const changes = assets
      .filter(asset => !isCarrierCoin(asset, hasOtherAsset))
      .map((asset): HistoryAssetChange => ({ asset, sign: '' }))
    return {
      changes,
      total: Math.max(receivedCount + sentCount - hiddenReceived - hiddenSent, changes.length),
    }
  }
  if (item.direction === 'self') {
    // The API places all self-owned outputs, including change, in sent. Keep
    // them neutral; their total is not the user-requested transfer amount.
    const changes = sentAssets
      .filter(asset => !isCarrierCoin(asset, hasOtherAsset))
      .map((asset): HistoryAssetChange => ({ asset, sign: '' }))
    return { changes, total: Math.max(sentCount - hiddenSent, changes.length) }
  }

  const received = receivedAssets.filter(asset => !isCarrierCoin(asset, hasOtherAsset))
  const sent = sentAssets.filter(asset => !isCarrierCoin(asset, hasOtherAsset))
  const changes: HistoryAssetChange[] = [
    ...received.map((asset): HistoryAssetChange => ({ asset, sign: '+' })),
    ...sent.map((asset): HistoryAssetChange => ({ asset, sign: '-' })),
  ]

  return {
    changes,
    total: Math.max(receivedCount + sentCount - hiddenReceived - hiddenSent, changes.length),
  }
}
