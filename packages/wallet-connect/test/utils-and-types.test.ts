import { describe, expect, it, vi } from 'vitest'

import {
  ChainType,
  getChainFlags,
} from '../src/types'
import {
  hexToBase64,
  isP2WPKH,
  isSupportedAddressType,
  isTaproot,
  sleep,
} from '../src/utils'

describe('utils and types', () => {
  it('getChainFlags returns exact flags for each chain type', () => {
    expect(getChainFlags(ChainType.BITCOIN_MAINNET)).toEqual({
      isBitcoinMainnet: true,
      isBitcoinTestnet: false,
      isFractalMainnet: false,
      isFractalTestnet: false,
    })

    expect(getChainFlags(ChainType.FRACTAL_BITCOIN_TESTNET)).toEqual({
      isBitcoinMainnet: false,
      isBitcoinTestnet: false,
      isFractalMainnet: false,
      isFractalTestnet: true,
    })
  })

  it('hexToBase64 converts hex payload correctly', () => {
    expect(hexToBase64('48656c6c6f')).toBe('SGVsbG8=')
  })

  it('address type helpers detect supported formats', () => {
    expect(isP2WPKH('bc1qabc')).toBe(true)
    expect(isP2WPKH('tb1qabc')).toBe(true)
    expect(isP2WPKH('bc1pabc')).toBe(false)

    expect(isTaproot('bc1pabc')).toBe(true)
    expect(isTaproot('tb1pabc')).toBe(true)
    expect(isTaproot('bc1qabc')).toBe(false)

    expect(isSupportedAddressType('tb1pabc')).toBe(true)
    expect(isSupportedAddressType('1legacy')).toBe(false)
  })

  it('sleep resolves after timeout', async () => {
    vi.useFakeTimers()
    const done = vi.fn()

    const p = sleep(300).then(done)
    expect(done).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    await p

    expect(done).toHaveBeenCalledTimes(1)
  })
})
