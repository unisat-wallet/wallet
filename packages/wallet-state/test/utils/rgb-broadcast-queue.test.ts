import { describe, expect, it } from 'vitest'
import type { RgbTransferItem } from '../../src/types'
import { getReadyRgbBroadcasts, selectReadyRgbBroadcastId } from '../../src/utils/rgb-broadcast-queue'

const transfer = (id: string, createdAt: number, acknowledgedAt: number): RgbTransferItem => ({
  id: `local-send:${id}`,
  transferId: id,
  type: 'send',
  status: 'ready_to_broadcast',
  timestamp: createdAt,
  acknowledgedAt,
})

describe('getReadyRgbBroadcasts', () => {
  it('shows the most recently accepted transfer first, even when it was created first', () => {
    const firstInvoice = transfer('first', 100, 400)
    const secondInvoice = transfer('second', 200, 300)

    expect(getReadyRgbBroadcasts([secondInvoice, firstInvoice], new Set()).map(item => item.transferId))
      .toEqual(['first', 'second'])
  })

  it('keeps other ready transfers available after dismissing one', () => {
    const firstInvoice = transfer('first', 100, 300)
    const secondInvoice = transfer('second', 200, 400)
    const items = [firstInvoice, secondInvoice]

    expect(getReadyRgbBroadcasts(items, new Set()).map(item => item.transferId))
      .toEqual(['second', 'first'])
    expect(getReadyRgbBroadcasts(items, new Set(['second'])).map(item => item.transferId))
      .toEqual(['first'])
  })

  it('keeps the open transfer fixed while another acceptance arrives', () => {
    const firstInvoice = transfer('first', 100, 300)
    const secondInvoice = transfer('second', 200, 400)
    const ready = getReadyRgbBroadcasts([firstInvoice, secondInvoice], new Set())

    expect(selectReadyRgbBroadcastId(ready, 'first')).toBe('first')
    expect(selectReadyRgbBroadcastId(ready, 'missing')).toBe('second')
  })
})
