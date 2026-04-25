import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChainType } from '../src/types'
import { OkxWallet } from '../src/wallets/OkxWallet'

function createProvider() {
  return {
    selectedAccount: undefined,
    connect: vi.fn().mockResolvedValue({
      address: 'bc1qokx',
      publicKey: 'pk',
      compressedPublicKey: 'cpk',
    }),
    signMessage: vi.fn().mockResolvedValue('sig'),
    send: vi.fn(),
    inscribe: vi.fn(),
    signPsbt: vi.fn().mockResolvedValue('signed'),
    on: vi.fn(),
    removeListener: vi.fn(),
    getPublicKey: vi.fn(),
    getBalance: vi.fn().mockResolvedValue({ confirmed: 1, unconfirmed: 2, total: 3 }),
  }
}

describe('OkxWallet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses testnet provider when chain is BITCOIN_TESTNET', async () => {
    const bitcoin = createProvider()
    const bitcoinTestnet = createProvider()
    const fractalBitcoin = createProvider()

    ;(globalThis as any).window = {
      okxwallet: { bitcoin, bitcoinTestnet, fractalBitcoin },
    }

    const wallet = new OkxWallet()
    wallet.setChainType(ChainType.BITCOIN_TESTNET)
    wallet.installed = true

    const account = await wallet.requestAccount()
    const balance = await wallet.getBalance()

    expect(account).toEqual({ address: 'bc1qokx', pubKey: 'cpk' })
    expect(bitcoinTestnet.connect).toHaveBeenCalledTimes(1)
    expect(bitcoin.connect).not.toHaveBeenCalled()
    expect(balance.total).toBe(3)
    expect(bitcoinTestnet.getBalance).toHaveBeenCalledTimes(1)
  })

  it('falls back to connect() when selectedAccount is missing', async () => {
    const provider = createProvider()
    ;(globalThis as any).window = {
      okxwallet: { bitcoin: provider, bitcoinTestnet: createProvider(), fractalBitcoin: createProvider() },
    }

    const wallet = new OkxWallet()
    wallet.setChainType(ChainType.BITCOIN_MAINNET)

    const account = await wallet.getAccount()

    expect(provider.connect).toHaveBeenCalledTimes(1)
    expect(account?.pubKey).toBe('cpk')
  })

  it('throws for unsupported fractal testnet chain', async () => {
    ;(globalThis as any).window = {
      okxwallet: { bitcoin: createProvider(), bitcoinTestnet: createProvider(), fractalBitcoin: createProvider() },
    }

    const wallet = new OkxWallet()
    wallet.setChainType(ChainType.FRACTAL_BITCOIN_TESTNET)

    expect(() => wallet.getBalance()).toThrow('not supported')
  })
})
