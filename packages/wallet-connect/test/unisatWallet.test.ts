import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChainType } from '../src/types'
import { UniSatWallet } from '../src/wallets/UniSatWallet'

describe('UniSatWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).window = {}
  })

  it('init marks wallet as installed when provider exists', async () => {
    ;(globalThis as any).window.unisat = {}

    const wallet = new UniSatWallet()
    await wallet.init()

    expect(wallet.installed).toBe(true)
  })

  it('requestAccount checks network and returns account', async () => {
    const provider = {
      requestAccounts: vi.fn().mockResolvedValue(['bc1quser']),
      getPublicKey: vi.fn().mockResolvedValue('pubkey'),
      getChain: vi.fn().mockResolvedValue({ enum: ChainType.BITCOIN_TESTNET }),
      switchChain: vi.fn().mockResolvedValue(undefined),
    }

    ;(globalThis as any).window.unisat = provider

    const wallet = new UniSatWallet()
    wallet.installed = true
    wallet.setChainType(ChainType.BITCOIN_MAINNET)

    const account = await wallet.requestAccount()

    expect(provider.switchChain).toHaveBeenCalledWith(ChainType.BITCOIN_MAINNET)
    expect(account).toEqual({ address: 'bc1quser', pubKey: 'pubkey' })
  })

  it('signPsbt passes toSignInputs with autoFinalized=false', async () => {
    const provider = {
      signPsbt: vi.fn().mockResolvedValue('signed-psbt'),
      getChain: vi.fn().mockResolvedValue({ enum: ChainType.BITCOIN_MAINNET }),
    }

    ;(globalThis as any).window.unisat = provider

    const wallet = new UniSatWallet()
    wallet.setChainType(ChainType.BITCOIN_MAINNET)

    const result = await wallet.signPsbt('psbt-hex', {
      toSignInputs: [{ index: 1, address: 'bc1qabc' }],
    })

    expect(result).toBe('signed-psbt')
    expect(provider.signPsbt).toHaveBeenCalledWith('psbt-hex', {
      autoFinalized: false,
      toSignInputs: [{ index: 1, address: 'bc1qabc' }],
    })
  })
})
