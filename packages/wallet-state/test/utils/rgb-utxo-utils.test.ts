import { describe, expect, it } from 'vitest'

import {
  estimateRgbUtxoCreateMinSats,
  RGB_UTXO_RECOMMENDED_BALANCE_SATS,
} from '../../src/utils/rgb-utxo-utils'

describe('RGB UTXO funding requirements', () => {
  it('includes all five dust outputs in the minimum estimate', () => {
    expect(estimateRgbUtxoCreateMinSats(1)).toBe(2_000)
  })

  it('keeps the recommended balance above the typical minimum at 1 sat/vB', () => {
    expect(RGB_UTXO_RECOMMENDED_BALANCE_SATS).toBe(3_000)
    expect(RGB_UTXO_RECOMMENDED_BALANCE_SATS).toBeGreaterThan(estimateRgbUtxoCreateMinSats(1))
  })
})
