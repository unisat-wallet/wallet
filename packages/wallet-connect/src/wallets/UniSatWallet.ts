import type { Account, BtcBalance, ToSignInput, WalletConfig, WalletListenerParams } from '../types'
import { ChainType, WalletType } from '../types'
import { sleep } from '../utils'
import { BaseWallet } from './BaseWallet'

/**
 * UniSat Wallet implementation
 * @see https://unisat.io
 */
export class UniSatWallet extends BaseWallet {
  readonly config: WalletConfig = {
    name: 'UniSat Wallet',
    icon: 'https://next-cdn.unisat.space/_/2025-v2374/logo/logo_black_bg.svg',
    type: WalletType.UniSat,
    logoPadding: 4,
    downloadUrl: 'https://unisat.io/download',
    supportChain: [
      ChainType.BITCOIN_MAINNET,
      ChainType.BITCOIN_TESTNET,
      ChainType.FRACTAL_BITCOIN_MAINNET,
      ChainType.FRACTAL_BITCOIN_TESTNET,
    ],
  }

  async init(): Promise<void> {
    this.installed = !!window.unisat

    // Retry check for slow extension loading
    for (let i = 0; i < 10 && !this.installed; i += 1) {
      await sleep(100 + i * 100)
      this.installed = !!window.unisat
      if (this.installed) break
    }
  }

  async requestAccount(): Promise<Account | undefined> {
    if (!this.installed || !window.unisat) {
      this.showNotInstalledWarning()
      return undefined
    }

    await this.checkNetwork()

    const addresses = await window.unisat.requestAccounts()
    const publicKey = await window.unisat.getPublicKey()
    const address = addresses[0]

    if (!address) {
      return undefined
    }

    return this.assertAccountNetwork({
      address,
      pubKey: publicKey,
    })
  }

  async getAccount(): Promise<Account | undefined> {
    if (!this.installed || !window.unisat) return undefined

    const temp = await window.unisat.getAccounts()
    if (!temp || temp.length <= 0) return undefined

    const currentChain = await window.unisat.getChain()
    if (this.chainType !== currentChain?.enum) {
      // Network mismatch
      return undefined
    }

    const addresses = await window.unisat.getAccounts()
    if (addresses[0]) {
      const publicKey = await window.unisat.getPublicKey()
      return this.assertAccountNetwork({
        address: addresses[0],
        pubKey: publicKey,
      })
    }

    return undefined
  }

  addListener(params: WalletListenerParams): void {
    if (!window.unisat) return
    window.unisat.on('accountsChanged', params.onAccountChange)
    window.unisat.on('networkChanged', params.onNetworkChange)
  }

  removeListener(params: WalletListenerParams): void {
    if (!window.unisat) return
    window.unisat.removeListener('accountsChanged', params.onAccountChange)
    window.unisat.removeListener('networkChanged', params.onNetworkChange)
  }

  async getBalance(): Promise<BtcBalance> {
    if (!this.installed || !window.unisat) {
      return { confirmed: 0, unconfirmed: 0, total: 0 }
    }
    await this.checkNetwork()
    return window.unisat.getBalance()
  }

  /**
   * Check and switch network if needed
   */
  async checkNetwork(): Promise<boolean> {
    if (!window.unisat || !this.chainType) return false

    const currentChain = await window.unisat.getChain()
    if (this.chainType !== currentChain?.enum) {
      await window.unisat.switchChain(this.chainType)
      return false
    }
    return true
  }

  async signPsbt(psbt: string, opt?: { toSignInputs?: ToSignInput[] }): Promise<string> {
    if (!window.unisat) {
      throw new Error(this.t('walletNotConnected', 'Wallet not connected'))
    }

    await this.checkNetwork()
    if (!(await this.getAccount())) {
      throw new Error(this.t('accountNotFound', 'Account not found'))
    }

    const params: { autoFinalized: boolean; toSignInputs?: ToSignInput[] } = {
      autoFinalized: false,
    }
    if (opt?.toSignInputs) {
      params.toSignInputs = opt.toSignInputs
    }

    return window.unisat.signPsbt(psbt, params)
  }

  async signPsbts(params: { psbt: string; toSignInputs?: ToSignInput[] }[]): Promise<string[]> {
    if (!window.unisat) {
      throw new Error(this.t('walletNotConnected', 'Wallet not connected'))
    }

    await this.checkNetwork()
    if (!(await this.getAccount())) {
      throw new Error(this.t('accountNotFound', 'Account not found'))
    }

    const opts = params.map(p => {
      const opt: { autoFinalized: boolean; toSignInputs?: ToSignInput[] } = {
        autoFinalized: false,
      }
      if (p.toSignInputs) {
        opt.toSignInputs = p.toSignInputs
      }
      return opt
    })

    return window.unisat.signPsbts(
      params.map(item => item.psbt),
      opts
    )
  }

  async signMessage(message: string, type?: string): Promise<string> {
    if (!window.unisat) {
      throw new Error(this.t('walletNotConnected', 'Wallet not connected'))
    }
    await this.checkNetwork()
    if (!(await this.getAccount())) {
      throw new Error(this.t('accountNotFound', 'Account not found'))
    }
    return window.unisat.signMessage(message, type)
  }

  disconnect(): void {
    // UniSat doesn't have a disconnect method
  }
}
