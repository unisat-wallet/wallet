import { describe, expect, it } from 'vitest'
import {
  appendRgbInvoiceRecipientNonce,
  decodeRgbInvoice,
  encodeWitnessRgbInvoice,
  rgbProxyInvoiceId,
  witnessSealToScriptPubKey,
} from '../src'

describe('decodeRgbInvoice', () => {
  it('decodes invoice identity, amount and transport without a network request', () => {
    const invoice = decodeRgbInvoice(
      'rgb:BQUFBQUF-BQUFBQU-FBQUFBQ-UFBQUFB-QUFBQUF-BQUFBQU/schema-id/~/bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw?amount=42&endpoints=rpcs%3A%2F%2Fproxy.example'
    )

    expect(invoice).toMatchObject({
      assetId: 'rgb:BQUFBQUF-BQUFBQU-FBQUFBQ-UFBQUFB-QUFBQUF-BQUFBQU',
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
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    )
    expect(invoice.recipientType).toBe('blind')
    expect(invoice.seal).toMatchObject({ type: 'confidential' })
    expect(invoice.seal.type === 'confidential' && invoice.seal.secretSeal).toHaveLength(32)
  })

  it('rejects malformed beneficiary seals before planning a transfer', () => {
    expect(() =>
      decodeRgbInvoice(
        'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/schema/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBn'
      )
    ).toThrow('checksum')
    expect(() => decodeRgbInvoice('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/schema/~/bc:tapret:recipient')).toThrow(
      'utxob or wvout'
    )
  })

  it('rejects invoices whose payload does not contain exactly four path segments', () => {
    const recipientId =
      'bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    const assetId = 'AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'

    expect(() => decodeRgbInvoice(`rgb:${assetId}/extra/schema/~/${recipientId}`)).toThrow(
      'Invalid RGB invoice payload'
    )
  })

  it.each(['rgb:asset/~/~/bc:wvout:attacker', 'rgb:asset?assetId=attacker'])(
    'rejects an asset ID that can rewrite a witness invoice: %s',
    assetId => {
      expect(() =>
        encodeWitnessRgbInvoice({
          network: 'mainnet',
          scriptPubKey:
            '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
          assetId,
          transportEndpoints: ['rpcs://proxy.example/rgb/json-rpc'],
        })
      ).toThrow('BAID64 encoding is invalid')
    }
  )

  it('creates witness invoices with stable beneficiary and unique proxy routing', () => {
    const scriptPubKey = '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
    const make = (nonce: number) =>
      decodeRgbInvoice(
        encodeWitnessRgbInvoice({
          network: 'testnet4',
          scriptPubKey,
          transportEndpoints: [
            appendRgbInvoiceRecipientNonce('rpcs://proxy.example/rgb/json-rpc', new Uint8Array(16).fill(nonce)),
          ],
        })
      )
    const first = make(1)
    const second = make(2)
    expect(first.recipientType).toBe('witness')
    expect(first.seal.type === 'witness' && Buffer.from(witnessSealToScriptPubKey(first.seal)).toString('hex')).toBe(scriptPubKey)
    expect(first.recipientId).toBe(second.recipientId)
    expect(first.proxyRecipientId).not.toBe(second.proxyRecipientId)
    expect(first.proxyRecipientId).toMatch(/^[0-9a-f]{64}$/)
  })

  it('writes and reads standard expiry in witness invoices', () => {
    const invoice = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      transportEndpoints: ['rpcs://proxy.example'],
      expirationTimestamp: 1_800_000_000,
    })
    expect(invoice).toContain('expiry=1800000000')
    expect(invoice).not.toContain('expirationTimestamp=')
    expect(decodeRgbInvoice(invoice).expirationTimestamp).toBe(1_800_000_000)
  })

  it.each([
    'expirationTimestamp=1800000000',
    'expirationTimestamp=',
    'expiry=',
    'expiry=-1',
    'expiry=not-a-time',
    'expiry=9007199254740992',
    'expiry=1800000000&expiry=1800000001',
  ])('rejects unsupported or invalid expiry query: %s', query => {
    const invoice = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      transportEndpoints: ['rpcs://proxy.example'],
    })
    expect(() => decodeRgbInvoice(`${invoice}&${query}`)).toThrow(/expiry|expirationTimestamp/)
  })

  it('carries the proxy v1 signing key and derives the registered invoice ID', () => {
    const publicKey = 'ab'.repeat(32)
    const invoice = decodeRgbInvoice(encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      transportEndpoints: ['rpcs://proxy.example'],
      proxyPublicKey: publicKey,
    }))
    expect(invoice.proxyPublicKey).toBe(publicKey)
    expect(invoice.proxyInvoiceId).toBe(rgbProxyInvoiceId(invoice.recipientId, publicKey))
    expect(invoice.proxyRecipientId).toBe(invoice.proxyInvoiceId)
  })
})
