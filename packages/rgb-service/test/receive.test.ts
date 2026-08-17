import { describe, expect, it } from 'vitest'
import { concealBlindSeal, decodeRgbInvoice, encodeBlindRgbInvoice } from '../src'

describe('blind RGB receive', () => {
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

  it('advertises the receiver funding address as an invoice query param', () => {
    const invoice = encodeBlindRgbInvoice({
      network: 'mainnet',
      seal: { txid: '11'.repeat(32), vout: 2, blinding: 3n },
      address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    })
    const decoded = decodeRgbInvoice(invoice)

    expect(decoded.beneficiaryAddress).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')
  })
})
