import { describe, expect, it } from 'vitest'
import { decodeRgbInvoice, invoiceSealToScriptPubKey } from '../src'

describe('invoiceSealToScriptPubKey', () => {
  it('uses the decoded Pay2Vout payload without an address-string round trip', () => {
    const invoice = decodeRgbInvoice(
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/schema/~/bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw'
    )
    const script = invoiceSealToScriptPubKey(invoice.seal)

    expect(Buffer.from(script!).toString('hex')).toBe(
      '0014c709ed6c37348cc00e8dd3ce9fb9683ec24c15a6'
    )
  })

  it('does not create a Bitcoin output for a blind beneficiary', () => {
    const invoice = decodeRgbInvoice(
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    )

    expect(invoiceSealToScriptPubKey(invoice.seal)).toBeUndefined()
  })
})
