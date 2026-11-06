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

  it('exposes the actual asset received by an Any Asset invoice awaiting acceptance', () => {
    const invoice = toPublicRgbPendingReceiveInvoice({
      invoice: 'rgb:any-invoice',
      recipientId: 'recipient-id',
      pendingAccept: {
        assetId: 'rgb:received-asset',
        amount: '11100000000',
        precision: 8,
      },
    })

    expect(invoice).toMatchObject({
      assetId: 'rgb:received-asset',
      amount: '11100000000',
      precision: 8,
      status: 'PendingAccept',
    })
  })

  it('keeps the actual asset on an accepted Any Asset invoice while confirming', () => {
    const invoice = toPublicRgbPendingReceiveInvoice({
      invoice: 'rgb:any-invoice',
      recipientId: 'recipient-id',
      receivedConsignment: {
        assetId: 'rgb:received-asset',
        amount: '11100000000',
        precision: 8,
        accepted: true,
        broadcastDetectedAt: 1,
      },
    })

    expect(invoice).toMatchObject({
      assetId: 'rgb:received-asset',
      amount: '11100000000',
      precision: 8,
      status: 'WaitingSenderConfirmation',
    })
  })
})
