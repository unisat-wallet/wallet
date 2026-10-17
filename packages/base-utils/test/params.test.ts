import { describe, expect, it } from 'vitest'

import { paramsUtils } from '../src/params'

describe('formatAmount', () => {
  it.each(['0', '00', '0x0', '0X0', '-0', '-1', ' 0', 'abc', 'Infinity', 'NaN'])(
    'rejects non-positive or invalid string amount %j',
    amount => {
      expect(() => paramsUtils.formatAmount(amount)).toThrow('Amount must be greater than 0')
    }
  )

  it.each([0, -0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects non-positive or invalid numeric amount %s',
    amount => {
      expect(() => paramsUtils.formatAmount(amount)).toThrow()
    }
  )

  it.each([
    ['1', '1'],
    ['001', '1'],
    ['1.', '1'],
    ['1.25', '1.25'],
    ['1e3', '1000'],
    ['0x1', '1'],
    [' 2', '2'],
  ])('normalizes positive string amount %j to %j', (amount, expected) => {
    expect(paramsUtils.formatAmount(amount)).toBe(expected)
  })

  it('preserves positive numeric amounts', () => {
    expect(paramsUtils.formatAmount(1.25)).toBe(1.25)
  })
})
