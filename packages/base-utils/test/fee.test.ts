import { describe, expect, it } from 'vitest'
import { MAX_FEE_RATE, assertValidFeeRate } from '../src/fee'

describe('assertValidFeeRate', () => {
  it('accepts fee rates in the regular UI range', () => {
    expect(assertValidFeeRate(1)).toBe(1)
    expect(assertValidFeeRate(MAX_FEE_RATE)).toBe(MAX_FEE_RATE)
  })

  it('rejects non-finite and out-of-range fee rates', () => {
    for (const feeRate of [0, MAX_FEE_RATE + 1, Number.NaN, Number.POSITIVE_INFINITY, '2']) {
      expect(() => assertValidFeeRate(feeRate)).toThrow('fee rate must be between')
    }
  })

  it('supports the UI low-fee range when explicitly enabled', () => {
    expect(assertValidFeeRate(0.1, { supportLowFeeMode: true })).toBe(0.1)
  })
})
