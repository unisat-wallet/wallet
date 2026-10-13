import type { RgbTransferItem } from '../types'

export function getReadyRgbBroadcasts(
  items: RgbTransferItem[],
  dismissedIds: Set<string>
): RgbTransferItem[] {
  return items
    .filter(
      item =>
        item.type === 'send' &&
        item.status === 'ready_to_broadcast' &&
        !dismissedIds.has(item.transferId || item.id)
    )
    .sort(
      (left, right) =>
        (right.acknowledgedAt ?? right.timestamp) - (left.acknowledgedAt ?? left.timestamp) ||
        right.timestamp - left.timestamp ||
        (right.transferId || right.id).localeCompare(left.transferId || left.id)
    )
}

export function selectReadyRgbBroadcastId(
  readyBroadcasts: RgbTransferItem[],
  activeId?: string
): string | undefined {
  if (activeId && readyBroadcasts.some(item => (item.transferId || item.id) === activeId)) {
    return activeId
  }
  const first = readyBroadcasts[0]
  return first?.transferId || first?.id
}
