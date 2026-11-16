import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseWallet } from '../src/wallets/BaseWallet'
import { ChainType, WalletType, type WalletConfig } from '../src/types'

class DummyWallet extends BaseWallet {
  readonly config: WalletConfig = {
    name: 'Dummy',
    icon: 'dummy.svg',
    type: WalletType.UniSat,
    supportChain: [ChainType.BITCOIN_MAINNET],
    downloadUrl: 'https://example.com/download',
  }

  async init(): Promise<void> {}
  async requestAccount() {
    return undefined
  }
  async getAccount() {
    return undefined
  }
  addListener(): void {}
  removeListener(): void {}
  async getBalance() {
    return { confirmed: 0, unconfirmed: 0, total: 0 }
  }
  async signPsbt(): Promise<string> {
    return ''
  }
  async signPsbts(): Promise<string[]> {
    return []
  }
  async signMessage(): Promise<string> {
    return ''
  }
  disconnect(): void {}

  exposeTranslate(key: string, fallback: string) {
    return this.t(key, fallback)
  }

  exposeShowWarning() {
    this.showNotInstalledWarning()
  }

  exposeValidateAccount(address: string, paymentAddress?: string) {
    return this.assertAccountNetwork({
      address,
      pubKey: 'pubkey',
      ...(paymentAddress
        ? { paymentAccount: { address: paymentAddress, pubKey: 'payment-pubkey' } }
        : {}),
    })
  }
}

describe('BaseWallet', () => {
  beforeEach(() => {
    ;(globalThis as any).window = {
      open: vi.fn(),
    }
  })

  it('uses translator when provided and fallback otherwise', () => {
    const wallet = new DummyWallet()

    expect(wallet.exposeTranslate('k', 'fallback')).toBe('fallback')

    wallet.setTranslator((key) => `translated:${key}`)
    expect(wallet.exposeTranslate('k2', 'fallback2')).toBe('translated:k2')
  })

  it('showNotInstalledWarning sends notification and opens download link on click', () => {
    const wallet = new DummyWallet()

    const warning = vi.fn()
    const destroy = vi.fn()

    wallet.setNotifier({ warning, destroy })
    wallet.exposeShowWarning()

    expect(warning).toHaveBeenCalledTimes(1)

    const payload = warning.mock.calls[0][0]
    expect(payload.message).toContain('Dummy not installed')

    payload.onClick()

    expect(destroy).toHaveBeenCalledTimes(1)
    expect((globalThis as any).window.open).toHaveBeenCalledWith(
      'https://example.com/download',
      '_blank',
      'noopener,noreferrer'
    )
  })

  it.each([
    'http://example.com/download',
    'javascript:alert(1)',
    'data:text/html,<h1>fake wallet</h1>',
    '//example.com/download',
  ])('rejects unsafe wallet download link %s', (downloadUrl) => {
    const wallet = new DummyWallet()
    ;(wallet.config as { downloadUrl?: string }).downloadUrl = downloadUrl

    const warning = vi.fn()
    wallet.setNotifier({ warning, destroy: vi.fn() })
    wallet.exposeShowWarning()
    warning.mock.calls[0][0].onClick()

    expect((globalThis as any).window.open).not.toHaveBeenCalled()
  })

  it('rejects unsupported chain values before storing them', () => {
    const wallet = new DummyWallet()

    expect(() => wallet.setChainType(ChainType.BITCOIN_TESTNET)).toThrow('not supported')
    expect(() => wallet.setChainType('constructor' as ChainType)).toThrow('not supported')
  })

  it('rejects an account address from another network', () => {
    const wallet = new DummyWallet()
    wallet.setChainType(ChainType.BITCOIN_MAINNET)

    expect(() => wallet.exposeValidateAccount('tb1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3apj6d3')).toThrow(
      'does not belong to BITCOIN_MAINNET'
    )
    expect(wallet.exposeValidateAccount('bc1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3h8ffkz')).toEqual({
      address: 'bc1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3h8ffkz',
      pubKey: 'pubkey',
    })
    expect(() =>
      wallet.exposeValidateAccount(
        'bc1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3h8ffkz',
        'tb1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3apj6d3'
      )
    ).toThrow('does not belong to BITCOIN_MAINNET')
  })
})
