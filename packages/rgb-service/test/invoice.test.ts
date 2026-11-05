import { describe, expect, it } from 'vitest'
import {
  appendRgbInvoiceRecipientNonce,
  decodeRgbInvoice,
  encodeWitnessRgbInvoice,
  rgbProxyInvoiceId,
  witnessSealToScriptPubKey,
} from '../src'

describe('decodeRgbInvoice', () => {
  it('encodes fixed amounts in the RGB assignment-state path segment', () => {
    const invoice = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      assetId: 'rgb:BQUFBQUF-BQUFBQU-FBQUFBQ-UFBQUFB-QUFBQUF-BQUFBQU',
      amount: '2000000',
      transportEndpoints: ['rpcs://proxy.example'],
    })

    const knownVector = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      amount: '100',
      transportEndpoints: ['rpcs://proxy.example'],
    })
    expect(knownVector).toContain('/~/BF/bc:wvout:')
    expect(invoice).toContain('/~/FccbW/bc:wvout:')
    expect(invoice).not.toContain('amount=')
    expect(decodeRgbInvoice(invoice).amount).toBe('2000000')
  })

  it('keeps amount-open invoices open for bridge receives', () => {
    const invoice = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      transportEndpoints: ['rpcs://proxy.example'],
    })

    expect(invoice).toContain('/~/~/bc:wvout:')
    expect(invoice).not.toContain('amount=')
    expect(invoice).not.toContain('assignment_name=')
    const decoded = decodeRgbInvoice(invoice)
    expect(decoded.amount).toBeUndefined()
    expect(decoded.assignmentName).toBeUndefined()
  })

  it('keeps assetOwner only when an amount makes the assignment fungible', () => {
    const invoice = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      amount: '1',
      transportEndpoints: ['rpcs://proxy.example'],
    })

    expect(invoice).toContain('assignment_name=assetOwner')
    expect(decodeRgbInvoice(invoice)).toMatchObject({ amount: '1', assignmentName: 'assetOwner' })
  })

  it('uses the RGB Signet beneficiary prefix for witness invoices', () => {
    const invoice = encodeWitnessRgbInvoice({
      network: 'signet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      transportEndpoints: ['rpcs://proxy.example/rgb/json-rpc'],
    })
    expect(invoice).toContain('/sb:wvout:')
    expect(decodeRgbInvoice(invoice).network).toBe('signet')
    expect(decodeRgbInvoice(invoice.replace('/sb:wvout:', '/tbs:wvout:')).network).toBe('signet')
  })

  it('decodes invoice identity, amount and transport without a network request', () => {
    const invoice = decodeRgbInvoice(
      'rgb:BQUFBQUF-BQUFBQU-FBQUFBQ-UFBQUFB-QUFBQUF-BQUFBQU/RWhwUfTMpuP2Zfx1~j4nswCANGeJrYOqDcKelaMV4zU/~/bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw?amount=42&assignment_name=assetOwner&enc=1&endpoints=rpcs%3A%2F%2Fproxy.example'
    )

    expect(invoice).toMatchObject({
      assetId: 'rgb:BQUFBQUF-BQUFBQU-FBQUFBQ-UFBQUFB-QUFBQUF-BQUFBQU',
      amount: '42',
      schema: 'NIA',
      assignmentName: 'assetOwner',
      encryption: 'optional',
      recipientId: 'bc:wvout:A8cJ7Ww3-NIzADo3-Tzp_5aD-7CTBWmA-AAAAAAA-AAAAAAA-ALSQkcw',
      recipientType: 'witness',
      network: 'mainnet',
      transportEndpoints: ['rpcs://proxy.example'],
    })
    expect(invoice.seal).toMatchObject({ type: 'witness', addressType: 'p2wpkh' })
    expect(invoice.seal.type === 'witness' && invoice.seal.pay2vout).toHaveLength(33)
  })

  it('rejects unsupported assignment, schema and encryption semantics', () => {
    const recipientId = 'bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    expect(() => decodeRgbInvoice(
      `rgb:~/~/~/${recipientId}?assignment_name=mintRight`
    )).toThrow('assignment is not supported')
    expect(() => decodeRgbInvoice(
      `rgb:~/RWhwUfTMpuP2Zfx1~j4nswCANGeJrYOqDcKelaMV4zV/~/${recipientId}`
    )).toThrow('schema')
    expect(() => decodeRgbInvoice(`rgb:~/~/~/${recipientId}?enc=2`))
      .toThrow('encryption preference')
  })

  it('decodes and validates blind seals locally', () => {
    const invoice = decodeRgbInvoice(
      'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    )
    expect(invoice.recipientType).toBe('blind')
    expect(invoice.seal).toMatchObject({ type: 'confidential' })
    expect(invoice.seal.type === 'confidential' && invoice.seal.secretSeal).toHaveLength(32)
  })

  it('rejects malformed beneficiary seals before planning a transfer', () => {
    expect(() =>
      decodeRgbInvoice(
        'rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBn'
      )
    ).toThrow('checksum')
    expect(() => decodeRgbInvoice('rgb:AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE/~/~/bc:tapret:recipient')).toThrow(
      'utxob or wvout'
    )
  })

  it('rejects invoices whose payload does not contain exactly four path segments', () => {
    const recipientId =
      'bc:utxob:xDfmDF9g-yNOjriV-6Anbe6H-MLJ__g6-lo7Dd4f-dhWBW8S-XYGBm'
    const assetId = 'AQEBAQEB-AQEBAQE-BAQEBAQ-EBAQEBA-QEBAQEB-AQEBAQE'

    expect(() => decodeRgbInvoice(`rgb:${assetId}/extra/~/~/${recipientId}`)).toThrow(
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

  it('reads legacy expirationTimestamp invoices without changing new invoice encoding', () => {
    const invoice = encodeWitnessRgbInvoice({
      network: 'mainnet',
      scriptPubKey: '512079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      transportEndpoints: ['rpcs://proxy.example'],
      expirationTimestamp: 1_800_000_000,
    })
    expect(decodeRgbInvoice(invoice.replace('expiry=', 'expirationTimestamp=')).expirationTimestamp).toBe(1_800_000_000)
    expect(invoice).not.toContain('expirationTimestamp=')
  })

  it.each([
    'expirationTimestamp=',
    'expirationTimestamp=-1',
    'expirationTimestamp=9007199254740992',
    'expiry=',
    'expiry=-1',
    'expiry=not-a-time',
    'expiry=9007199254740992',
    'expiry=1800000000&expiry=1800000001',
    'expirationTimestamp=1800000000&expirationTimestamp=1800000001',
    'expiry=1800000000&expirationTimestamp=1800000000',
  ])('rejects ambiguous or invalid expiry query: %s', query => {
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
