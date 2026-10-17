import type { OkxWalletProvider } from '../providers'
import type { Account, BtcBalance, ToSignInput, WalletConfig, WalletListenerParams } from '../types'
import { ChainType, WalletType, getChainFlags } from '../types'
import { sleep } from '../utils'
import { BaseWallet } from './BaseWallet'

/**
 * OKX Wallet implementation
 * @see https://www.okx.com/web3
 */
export class OkxWallet extends BaseWallet {
  readonly config: WalletConfig = {
    name: 'OKX Wallet',
    icon: 'https://next-cdn.unisat.space/_/2025-v2374/img/wallet/okx_wallet_icon.svg',
    type: WalletType.Okx,
    downloadUrl: 'https://www.okx.com/download',
    supportChain: [
      ChainType.BITCOIN_MAINNET,
      ChainType.BITCOIN_TESTNET,
      ChainType.FRACTAL_BITCOIN_MAINNET,
      // ChainType.FRACTAL_BITCOIN_TESTNET - not supported
    ],
  }

  /**
   * Get the appropriate OKX provider based on chain type
   */
  private getProvider(): OkxWalletProvider {
    if (!window.okxwallet) {
      throw new Error(this.t('walletNotInstalled', 'OKX Wallet not installed'))
    }

    if (!this.chainType) {
      throw new Error(this.t('chainTypeNotSet', 'Chain type not set'))
    }

    const flags = getChainFlags(this.chainType)

    if (flags.isFractalMainnet) {
      return window.okxwallet.fractalBitcoin
    }
    if (flags.isBitcoinTestnet) {
      return window.okxwallet.bitcoinTestnet
    }
    if (flags.isBitcoinMainnet) {
      return window.okxwallet.bitcoin
    }

    throw new Error(
      this.t('networkNotSupported', `${this.chainType} not supported`, {
        chain: this.chainType,
      })
    )
  }

  async init(): Promise<void> {
    this.installed = !!window.okxwallet

    // Retry check for slow extension loading
    for (let i = 0; i < 10 && !this.installed; i += 1) {
      await sleep(100 + i * 100)
      this.installed = !!window.okxwallet
      if (this.installed) break
    }
  }

  async requestAccount(): Promise<Account | undefined> {
    if (!this.installed) {
      this.showNotInstalledWarning()
      return undefined
    }

    const provider = this.getProvider()
    const account = await provider.connect()

    return this.assertAccountNetwork({
      address: account.address,
      pubKey: account.compressedPublicKey,
    })
  }

  async getAccount(): Promise<Account | undefined> {
    const provider = this.getProvider()
    let account = provider.selectedAccount

    if (!account) {
      account = await provider.connect()
    }

    if (!account?.address || !account?.compressedPublicKey) {
      return undefined
    }

    return this.assertAccountNetwork({
      address: account.address,
      pubKey: account.compressedPublicKey,
    })
  }

  addListener(params: WalletListenerParams): void {
    try {
      this.getProvider().on('accountChanged', params.onAccountChange)
    } catch {
      // Provider might not be available
    }
  }

  removeListener(params: WalletListenerParams): void {
    try {
      this.getProvider().removeListener('accountChanged', params.onAccountChange)
    } catch {
      // Provider might not be available
    }
  }

  getBalance(): Promise<BtcBalance> {
    return this.getProvider().getBalance()
  }

  async signPsbt(psbt: string, opt?: { toSignInputs?: ToSignInput[] }): Promise<string> {
    if (!(await this.getAccount())) {
      throw new Error(this.t('accountNotFound', 'Account not found'))
    }
    const params: { autoFinalized: boolean; toSignInputs?: ToSignInput[] } = {
      autoFinalized: false,
    }
    if (opt?.toSignInputs) {
      params.toSignInputs = opt.toSignInputs
    }
    return this.getProvider().signPsbt(psbt, params)
  }

  async signPsbts(params: { psbt: string; toSignInputs?: ToSignInput[] }[]): Promise<string[]> {
    // OKX doesn't support batch signing, sign one by one
    const result: string[] = []
    for (const p of params) {
      result.push(
        await this.signPsbt(p.psbt, p.toSignInputs ? { toSignInputs: p.toSignInputs } : undefined)
      )
    }
    return result
  }

  async signMessage(message: string, type?: string): Promise<string> {
    const account = await this.getAccount()
    if (!account) {
      throw new Error(this.t('accountNotFound', 'Account not found'))
    }
    const opts: { from: string; type?: string } = { from: account.address }
    if (type) {
      opts.type = type
    }
    return this.getProvider().signMessage(message, opts)
  }

  disconnect(): void {
    // OKX doesn't have a disconnect method
  }
}
