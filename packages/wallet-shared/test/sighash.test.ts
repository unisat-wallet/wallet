import { describe, expect, it } from 'vitest'
import { getSighashSingleInputIndexes } from '../src/utils/sighash'

describe('getSighashSingleInputIndexes', () => {
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
})
