import { describe, expect, it } from 'vitest'

import {
  decodeRgbInvoice,
  decodeRgbInvoiceAmountState,
  getRgbInvoiceAmount,
  getRgbInvoiceAssetId,
} from '../../src/utils/rgb-invoice-utils'

describe('rgb invoice utils', () => {
  it('decodes fungible amount state from RGB invoice encoding', () => {
    expect(decodeRgbInvoiceAmountState('ae')).toBe('1')
    expect(decodeRgbInvoiceAmountState('BF')).toBe('100')
    expect(decodeRgbInvoiceAmountState('XabF')).toBe('1000')
  })

  it('decodes a blind RGB invoice string', () => {
    const invoice =
      'rgb:~/~/BF/bc:utxob:QB8o7v9S-FQ7316n-6Ng_Xhw-nxwwsTY-ALc3x~v-4mpRbRq-3n5~j?assignment_name=assetOwner&endpoints=rpc://10.168.1.109:13000/json-rpc'

    const decoded = decodeRgbInvoice(invoice)

    expect(decoded.valid).toBe(true)
    expect(decoded.scheme).toBe('rgb')
    expect(decoded.invoiceType).toBe('blind')
    expect(decoded.network).toBe('mainnet')
    expect(decoded.assignmentKind).toBe('fungible')
    expect(decoded.assignmentName).toBe('assetOwner')
    expect(decoded.amount).toBe('100')
    expect(decoded.assetId).toBeUndefined()
    expect(decoded.needsAssetId).toBe(true)
    expect(decoded.needsAmount).toBe(false)
    expect(decoded.transportEndpoints).toEqual(['rpc://10.168.1.109:13000/json-rpc'])
    expect(decoded.recipientId).toBe('bc:utxob:QB8o7v9S-FQ7316n-6Ng_Xhw-nxwwsTY-ALc3x~v-4mpRbRq-3n5~j')
  })

  it('keeps contract id as the asset id when the invoice includes one', () => {
    const invoice =
      'rgb:5ChCCSqU-hID5wGR-L9jArK6-S71gdZ7-WBaQV1R-EKctNjo/~/~/bc:utxob:test?endpoints=rpc://proxy'

    const decoded = decodeRgbInvoice(invoice)

    expect(decoded.assetId).toBe('rgb:5ChCCSqU-hID5wGR-L9jArK6-S71gdZ7-WBaQV1R-EKctNjo')
    expect(decoded.needsAssetId).toBe(false)
    expect(decoded.needsAmount).toBe(true)
  })

  it('decodes compatible JSON invoice payloads', () => {
    const decoded = decodeRgbInvoice(
      JSON.stringify({
        invoice: 'rgb:~/~/~/bc:utxob:test',
        assetId: 'rgb:test-asset',
        amount: '42',
        recipientId: 'bc:utxob:test',
        transportEndpoints: 'rpc://proxy-a,rpc://proxy-b',
      })
    )

    expect(decoded.valid).toBe(true)
    expect(decoded.assetId).toBe('rgb:test-asset')
    expect(decoded.amount).toBe('42')
    expect(decoded.invoiceType).toBe('blind')
    expect(decoded.transportEndpoints).toEqual(['rpc://proxy-a', 'rpc://proxy-b'])
    expect(getRgbInvoiceAmount(decoded.invoice)).toBe('42')
    expect(getRgbInvoiceAssetId(decoded.invoice)).toBe('rgb:test-asset')
  })
})
