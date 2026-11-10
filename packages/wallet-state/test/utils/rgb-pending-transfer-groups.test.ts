import { describe, expect, it } from 'vitest'

import type { RgbTransferItem } from '../../src/types'
import { groupRgbPendingAcceptances } from '../../src/utils/rgb-pending-transfer-groups'

function receive(
  id: string,
  overrides: Partial<RgbTransferItem> = {}
): RgbTransferItem {
  return {
    id,
    transferId: id,
    type: 'receive',
    status: 'pending_accept',
    local: true,
    timestamp: 1,
    ...overrides,
  }
}

describe('groupRgbPendingAcceptances', () => {
  it('groups members of the same Proxy batch by transaction ID', () => {
    const groups = groupRgbPendingAcceptances([
      receive('recipient-1', { batch: true, txid: 'txid', timestamp: 2 }),
      receive('recipient-2', { batch: true, txid: 'txid', timestamp: 3 }),
      receive('recipient-3', { timestamp: 4 }),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ key: 'transfer:recipient-3' })
    expect(groups[1]?.items.map(item => item.transferId)).toEqual([
      'recipient-2',
      'recipient-1',
    ])
  })

  it('excludes non-actionable and non-local receive history', () => {
    const groups = groupRgbPendingAcceptances([
      receive('accepted', { status: 'waiting_receive' }),
      receive('remote', { local: false }),
      receive('pending'),
    ])

    expect(groups.map(group => group.representative.transferId)).toEqual(['pending'])
  })
})
