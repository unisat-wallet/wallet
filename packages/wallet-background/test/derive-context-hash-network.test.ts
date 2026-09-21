import { ErrorCodes, WalletError } from '@unisat/wallet-shared'
import { ChainType } from '@unisat/wallet-types'
import { describe, expect, it } from 'vitest'

import { chainTypeToCanonicalNetwork } from '../src/shared/utils/deriveContextHash'

describe('chainTypeToCanonicalNetwork', () => {
  it('maps mainnet', () => {
    expect(chainTypeToCanonicalNetwork(ChainType.BITCOIN_MAINNET)).toBe('bitcoin-mainnet')
  })

  it('maps testnet3 and testnet4 to bitcoin-testnet', () => {
    expect(chainTypeToCanonicalNetwork(ChainType.BITCOIN_TESTNET)).toBe('bitcoin-testnet')
    expect(chainTypeToCanonicalNetwork(ChainType.BITCOIN_TESTNET4)).toBe('bitcoin-testnet')
  })

  it('maps signet', () => {
    expect(chainTypeToCanonicalNetwork(ChainType.BITCOIN_SIGNET)).toBe('bitcoin-signet')
  })

  it('maps Fractal mainnet to an isolated network domain', () => {
    expect(chainTypeToCanonicalNetwork(ChainType.FRACTAL_BITCOIN_MAINNET)).toBe('fractal-mainnet')
  })

  it('maps Fractal testnet to an isolated network domain', () => {
    expect(chainTypeToCanonicalNetwork(ChainType.FRACTAL_BITCOIN_TESTNET)).toBe('fractal-testnet')
  })

  it('throws for unknown chain', () => {
    expect(() => chainTypeToCanonicalNetwork('NOT_A_CHAIN' as ChainType)).toThrow(WalletError)
  })

  it('thrown error has code 4901 and identifies the chain', () => {
    try {
      chainTypeToCanonicalNetwork('NOT_A_CHAIN' as ChainType)
      throw new Error('did not throw')
    } catch (e) {
      expect(e).toBeInstanceOf(WalletError)
      expect((e as WalletError).code).toBe(ErrorCodes.UNSUPPORTED_NETWORK)
      expect((e as Error).message).toContain('NOT_A_CHAIN')
    }
  })
})
