import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChainType } from '../src/types'
import { XverseWallet } from '../src/wallets/XverseWallet'

describe('XverseWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).window = {
      BitcoinProvider: {},
    }
  })

  it('init marks wallet as installed when BitcoinProvider exists', async () => {
    const wallet = new XverseWallet()
    await wallet.init()
    expect(wallet.installed).toBe(true)
  })

  it('signPsbts throws unsupported error', async () => {
    const wallet = new XverseWallet()

    await expect(wallet.signPsbts([{ psbt: 'abc' }])).rejects.toThrow('not supported')
  })

  it('signMessage throws when account has not been requested', async () => {
    const wallet = new XverseWallet()
    wallet.setChainType(ChainType.BITCOIN_MAINNET)

    await expect(wallet.signMessage('hello')).rejects.toThrow('Account not found')
  })

  it('disconnect clears local account state', async () => {
    const wallet = new XverseWallet()
    wallet.disconnect()

    // still expected to fail because account is cleared
    await expect(wallet.signMessage('hello')).rejects.toThrow('Account not found')
  })
})
