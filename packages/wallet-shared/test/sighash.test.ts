import { describe, expect, it } from 'vitest'
import {
  getInvalidSighashInputIndexes,
  getSighashAllAnyoneCanPayInputIndexes,
  getSighashNoneInputIndexes,
  getSighashSingleAnyoneCanPayInputIndexes,
  getSighashSingleInputIndexes,
  getSighashTypeLabel,
  isDefinedSighashType,
} from '../src/utils/sighash'

describe('sighash input indexes', () => {
  it('checks only selected inputs and recognizes ANYONECANPAY', () => {
    const indexes = getSighashSingleInputIndexes(
      {
        psbtHex: '',
        toSignInputs: [{ index: 0, publicKey: '' }, { index: 2, publicKey: '' }],
      },
      [
        { sighashType: 0x03 },
        { sighashType: 0x03 },
        { sighashType: 0x83 },
        { sighashType: 0x01 },
      ]
    )

    expect(indexes).toEqual([0, 2])
  })

  it('finds only signed inputs whose signature omits other inputs and outputs', () => {
    const indexes = getSighashSingleAnyoneCanPayInputIndexes(
      {
        psbtHex: '',
        toSignInputs: [{ index: 0, publicKey: '', sighashTypes: [0x83] }],
      },
      [{ sighashType: 0x83 }, { sighashType: 0x83 }]
    )

    expect(indexes).toEqual([0])
  })

  it('finds signed SIGHASH_NONE inputs, including ANYONECANPAY', () => {
    const indexes = getSighashNoneInputIndexes(
      {
        psbtHex: '',
        toSignInputs: [{ index: 0, publicKey: '' }, { index: 2, publicKey: '' }],
      },
      [{ sighashType: 0x02 }, { sighashType: 0x02 }, { sighashType: 0x82 }]
    )

    expect(indexes).toEqual([0, 2])
  })

  it('finds SIGHASH_ALL | ANYONECANPAY without treating bare ANYONECANPAY as valid', () => {
    const toSignData = {
      psbtHex: '',
      toSignInputs: [0, 1, 2].map(index => ({ index, publicKey: '' })),
    }
    const inputInfos = [{ sighashType: 0x81 }, { sighashType: 0x80 }, { sighashType: 0x86 }]

    expect(getSighashAllAnyoneCanPayInputIndexes(toSignData, inputInfos)).toEqual([0])
    expect(getSighashNoneInputIndexes(toSignData, inputInfos)).toEqual([])
    expect(getInvalidSighashInputIndexes(toSignData, inputInfos)).toEqual([1, 2])
  })

  it('labels defined warning types and identifies undefined types', () => {
    expect(getSighashTypeLabel(0x81)).toBe('SIGHASH_ALL|ANYONECANPAY')
    expect(getSighashTypeLabel(0x02)).toBe('SIGHASH_NONE')
    expect(getSighashTypeLabel(0x83)).toBe('SIGHASH_SINGLE|ANYONECANPAY')
    expect(getSighashTypeLabel(0x01)).toBeUndefined()
    expect(getSighashTypeLabel(0x80)).toBe('INVALID_SIGHASH(0x80)')
    expect(isDefinedSighashType(0x80)).toBe(false)
    expect(isDefinedSighashType(0x00)).toBe(true)
  })
})
