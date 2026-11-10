import type { RgbTransferItem } from '../types'

export interface RgbPendingTransferGroup {
  key: string
  representative: RgbTransferItem
  items: RgbTransferItem[]
}

export function isRgbPendingAcceptance(item: RgbTransferItem) {
  return (
    item.type === 'receive' &&
    item.local === true &&
    item.status.toLowerCase() === 'pending_accept'
  )
}

export function groupRgbPendingAcceptances(items: RgbTransferItem[]): RgbPendingTransferGroup[] {
  const groups = new Map<string, RgbTransferItem[]>()
  for (const item of items) {
    if (!isRgbPendingAcceptance(item)) continue
    const transferId = item.transferId || item.id
    const key = item.batch && item.txid ? `batch:${item.txid}` : `transfer:${transferId}`
    const current = groups.get(key)
    if (current) current.push(item)
    else groups.set(key, [item])
  }

  return [...groups.entries()]
    .map(([key, groupItems]) => ({
      key,
      representative: groupItems.reduce((latest, item) =>
        item.timestamp > latest.timestamp ? item : latest
      ),
      items: groupItems.sort((left, right) => right.timestamp - left.timestamp),
    }))
    .sort((left, right) => right.representative.timestamp - left.representative.timestamp)
}
