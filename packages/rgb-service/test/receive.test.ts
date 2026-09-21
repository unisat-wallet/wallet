import { describe, expect, it, vi } from 'vitest'
import { concealBlindSeal, decodeRgbInvoice, encodeBlindRgbInvoice } from '../src'

describe('blind RGB receive', () => {
  it.each([
    { name: 'any asset', assetId: undefined, amount: undefined },
    { name: 'fixed asset, any amount', assetId: 'rgb:aa', amount: undefined },
    { name: 'fixed asset, fixed amount', assetId: 'rgb:aa', amount: '9007199254740993' },
  ])('preserves $name query fields when URLSearchParams.size is undefined', ({ assetId, amount }) => {
    const input = {
      network: 'mainnet' as const,
      seal: { txid: '11'.repeat(32), vout: 2, blinding: 3n },
      assetId,
      amount,
      expirationTimestamp: 1_800_000_000,
      transportEndpoints: ['rpcs://proxy.example.test/json-rpc'],
    }
    const expected = encodeBlindRgbInvoice(input)
    class WithoutSize extends URLSearchParams {}
    Object.defineProperty(WithoutSize.prototype, 'size', { value: undefined })
    vi.stubGlobal('URLSearchParams', WithoutSize)
    try {
      expect(new URLSearchParams().size).toBeUndefined()
      const invoice = encodeBlindRgbInvoice(input)
      expect(invoice).toBe(expected)
      expect(decodeRgbInvoice(invoice)).toMatchObject({
        assetId,
        amount,
        expirationTimestamp: input.expirationTimestamp,
        transportEndpoints: input.transportEndpoints,
      })
      const emptyQuery = encodeBlindRgbInvoice({ network: input.network, seal: input.seal })
      expect(emptyQuery).not.toContain('?')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('uses strict little-endian txid bytes when concealing a blind seal', () => {
    const seal = {
      txid: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      vout: 2,
      blinding: 3n,
    }

    expect(Buffer.from(concealBlindSeal(seal)).toString('hex')).toBe(
      '51dc3120e6acd8319780b1da44e3c860850288f50257e862727a93b37165c8f0'
    )
  })

  it('creates a parseable invoice from a persistent blinded UTXO seal', () => {
    const seal = { txid: '11'.repeat(32), vout: 2, blinding: 3n }
    const invoice = encodeBlindRgbInvoice({
      network: 'mainnet',
      seal,
      assetId: 'rgb:aa',
      amount: '42',
    })
    const decoded = decodeRgbInvoice(invoice)

    expect(decoded).toMatchObject({
      assetId: 'rgb:aa',
      amount: '42',
      recipientType: 'blind',
      network: 'mainnet',
    })
    expect(
      decoded.seal.type === 'confidential' && Buffer.from(decoded.seal.secretSeal).toString('hex')
    ).toBe(Buffer.from(concealBlindSeal(seal)).toString('hex'))
  })
})
