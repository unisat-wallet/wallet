import { describe, expect, it } from 'vitest'

import { toPublicRgbPendingReceiveInvoice } from '../src/rgb/rgbPresentation'

describe('RGB pending invoice presentation', () => {
  it('marks a received consignment as awaiting acceptance and disables invoice release', () => {
    const invoice = toPublicRgbPendingReceiveInvoice(
      {
        invoice: 'rgb:invoice',
        recipientId: 'recipient-id',
        pendingAccept: { txid: 'a'.repeat(64) },
      },
      0,
      'WaitingCounterparty'
    )

    expect(invoice).toMatchObject({ status: 'PendingAccept', canCancel: false })
  })
})
