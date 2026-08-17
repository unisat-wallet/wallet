import { describe, expect, it } from 'vitest'
import { serializeStrictBitcoinTransaction } from '../src'

describe('serializeStrictBitcoinTransaction', () => {
  it('matches the RGB strict Bitcoin transaction encoding vector', () => {
    const wireTransaction = Buffer.from(
      `0200000001${'11'.repeat(32)}0300000000fdffffff017b00000000000000036a202200000000`,
      'hex'
    )
    const strict = serializeStrictBitcoinTransaction(wireTransaction)

    expect(Buffer.from(strict).toString('hex')).toBe(
      `0200000001000000${'11'.repeat(32)}0300000000000000fdffffff00000000010000007b00000000000000030000006a202200000000`
    )
  })
})
