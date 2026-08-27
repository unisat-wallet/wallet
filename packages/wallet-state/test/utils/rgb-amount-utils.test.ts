import { describe, expect, it } from 'vitest'

import {
  getRgbIconShortName,
  isValidRgbDecimalAmount,
  normalizeRgbAmountInput,
  toRgbAtomicAmount,
  toRgbDisplayAmount,
} from '../../src/utils/rgb-amount-utils'

describe('RGB amount utils', () => {
  it('converts display supply to atomic units using the asset precision', () => {
    expect(toRgbAtomicAmount('1000', 2)).toBe('100000')
    expect(toRgbAtomicAmount('0.5', 2)).toBe('50')
    expect(toRgbAtomicAmount('1.5', 8)).toBe('150000000')
  })

  it('formats atomic amounts for display without using floating point numbers', () => {
    expect(toRgbDisplayAmount('1000', 2)).toBe('10')
    expect(toRgbDisplayAmount('950', 2)).toBe('9.5')
    expect(toRgbDisplayAmount('50', 2)).toBe('0.5')
    expect(toRgbDisplayAmount('1', 8)).toBe('0.00000001')
  })

  it('accepts display decimals only up to the asset precision', () => {
    expect(isValidRgbDecimalAmount('0.5', 2)).toBe(true)
    expect(isValidRgbDecimalAmount('0.001', 2)).toBe(false)
    expect(isValidRgbDecimalAmount('1e3', 2)).toBe(false)
    expect(normalizeRgbAmountInput('000.50', 2)).toBe('0.50')
  })

  it('uses the asset name for placeholder icon initials instead of the ticker', () => {
    expect(getRgbIconShortName('RGBRGB', '*')).toBe('RG')
    expect(getRgbIconShortName('Test Token', 'ABCDEFG')).toBe('TE')
    expect(getRgbIconShortName('', '*')).toBe('*')
  })
})
