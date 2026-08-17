import { describe, expect, it } from 'vitest'
import { decodeRgbInvoice } from '../src'

describe('decodeRgbInvoice', () => {
  it('decodes invoice identity, amount and transport without a network request', () => {
    const invoice = decodeRgbInvoice(
      'rgb:asset-id/schema-id/~/bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw?amount=42&endpoints=rpcs%3A%2F%2Fproxy.example'
    )

    expect(invoice).toMatchObject({
      assetId: 'rgb:asset-id',
      amount: '42',
      recipientId: 'bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw',
      recipientType: 'witness',
      network: 'mainnet',
      transportEndpoints: ['rpcs://proxy.example'],
    })
    expect(invoice.seal).toMatchObject({ type: 'witness', addressType: 'p2wpkh' })
    expect(invoice.seal.type === 'witness' && invoice.seal.pay2vout).toHaveLength(33)
  })

  it('decodes and validates blind seals locally', () => {
    const invoice = decodeRgbInvoice(
      'rgb:asset/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    )
    expect(invoice.recipientType).toBe('blind')
    expect(invoice.seal).toMatchObject({ type: 'confidential' })
    expect(invoice.seal.type === 'confidential' && invoice.seal.secretSeal).toHaveLength(32)
  })

  it('rejects malformed beneficiary seals before planning a transfer', () => {
    expect(() =>
      decodeRgbInvoice(
        'rgb:asset/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBn'
      )
    ).toThrow('checksum')
    expect(() => decodeRgbInvoice('rgb:asset/schema/~/bc:tapret:recipient')).toThrow(
      'utxob or wvout'
    )
  })
})
