import type { Account, BtcBalance, ToSignInput, WalletConfig, WalletListenerParams } from '../types'
import { ChainType, WalletType, getChainFlags } from '../types'
import { hexToBase64, sleep } from '../utils'
import { BaseWallet } from './BaseWallet'

// Types for sats-connect responses
interface GetAddressResponse {
  addresses: Array<{ address: string; publicKey: string }>
}

interface SignTransactionResponse {
  psbtBase64: string
}

/**
 * Xverse Wallet implementation
 * Uses sats-connect library for communication
 * @see https://www.xverse.app
 */
export class XverseWallet extends BaseWallet {
  readonly config: WalletConfig = {
    name: 'Xverse',
    icon: 'https://next-cdn.unisat.space/_/2025-v2374/img/wallet/xverse_icon_whitecolor.svg',
    type: WalletType.Xverse,
    logoPadding: 6,
    downloadUrl: 'https://www.xverse.app/download',
    supportChain: [ChainType.BITCOIN_MAINNET, ChainType.BITCOIN_TESTNET],
  }

  private account: Account | undefined

  /**
   * Get the sats-connect network type
   */
  private getNetwork(): 'Mainnet' | 'Testnet' {
    if (!this.chainType) {
      throw new Error(this.t('chainTypeNotSet', 'Chain type not set'))
    }

    const flags = getChainFlags(this.chainType)

    if (flags.isBitcoinMainnet) {
      return 'Mainnet'
    }
    if (flags.isBitcoinTestnet) {
      return 'Testnet'
    }

    throw new Error(
      this.t('networkNotSupported', `${this.chainType} not supported`, {
        chain: this.chainType,
      })
    )
  }

  async init(): Promise<void> {
    this.installed = !!window.BitcoinProvider

    // Retry check for slow extension loading
    for (let i = 0; i < 10 && !this.installed; i += 1) {
      await sleep(100 + i * 100)
      this.installed = !!window.BitcoinProvider
      if (this.installed) break
    }
  }

  async requestAccount(): Promise<Account | undefined> {
    if (!this.installed) {
      this.showNotInstalledWarning()
      return undefined
    }

    // Dynamic import sats-connect to keep it optional
    let satsConnect: typeof import('sats-connect')
    try {
      satsConnect = await import('sats-connect')
    } catch {
      throw new Error(
        this.t('satsConnectNotInstalled', 'sats-connect library is required for Xverse wallet')
      )
    }

    const { getAddress, AddressPurpose, BitcoinNetworkType } = satsConnect

    return new Promise((resolve, reject) => {
      getAddress({
        payload: {
          purposes: [AddressPurpose.Ordinals, AddressPurpose.Payment],
          message: this.t('addressForOrdinals', 'Address for receiving Ordinals'),
          network: {
            type:
              this.getNetwork() === 'Mainnet'
                ? BitcoinNetworkType.Mainnet
                : BitcoinNetworkType.Testnet,
          },
        },
        onFinish: (response: GetAddressResponse) => {
          const ordinals = response.addresses[0]
          const payment = response.addresses[1]
          if (!ordinals || !payment) {
            reject(new Error(this.t('invalidResponse', 'Invalid response from wallet')))
            return
          }
          this.account = this.assertAccountNetwork({
            address: ordinals.address,
            pubKey: ordinals.publicKey,
            paymentAccount: {
              address: payment.address,
              pubKey: payment.publicKey,
            },
          })
          resolve(this.account)
        },
        onCancel: () => {
          reject(new Error(this.t('requestCanceled', 'Request canceled')))
        },
      }).catch(reject)
    })
  }

  async getAccount(): Promise<Account | undefined> {
    // Xverse doesn't support getting account without user interaction
    return undefined
  }

  addListener(_params: WalletListenerParams): void {
    // Xverse doesn't support event listeners
  }

  removeListener(_params: WalletListenerParams): void {
    // Xverse doesn't support event listeners
  }

  async getBalance(): Promise<BtcBalance> {
    // Xverse doesn't have a balance API, would need external API
    return { confirmed: 0, unconfirmed: 0, total: 0 }
  }

  async signPsbt(psbt: string, opt?: { toSignInputs?: ToSignInput[] }): Promise<string> {
    if (!this.account) {
      throw new Error(this.t('accountNotFound', 'Account not found'))
    }
    this.assertAccountNetwork(this.account)
    // Dynamic import sats-connect
    let satsConnect: typeof import('sats-connect')
    try {
      satsConnect = await import('sats-connect')
    } catch {
      throw new Error(
        this.t('satsConnectNotInstalled', 'sats-connect library is required for Xverse wallet')
      )
    }

    const { signTransaction, BitcoinNetworkType } = satsConnect

    return new Promise((resolve, reject) => {
      signTransaction({
        payload: {
          network: {
            type:
              this.getNetwork() === 'Mainnet'
                ? BitcoinNetworkType.Mainnet
                : BitcoinNetworkType.Testnet,
          },
          message: this.t('signPsbt', 'Sign PSBT'),
          psbtBase64: hexToBase64(psbt),
          broadcast: false,
          inputsToSign:
            opt?.toSignInputs?.map(input => ({
              address: input.address,
              signingIndexes: [input.index],
            })) || [],
        },
        onFinish: (response: SignTransactionResponse) => {
          resolve(response.psbtBase64)
        },
        onCancel: () => {
          reject(new Error(this.t('requestCanceled', 'Request canceled')))
        },
      }).catch(reject)
    })
  }

  async signPsbts(_params: { psbt: string; toSignInputs?: ToSignInput[] }[]): Promise<string[]> {
    throw new Error(this.t('methodNotImplemented', 'Batch PSBT signing not supported by Xverse'))
  }

  async signMessage(message: string, _type?: string): Promise<string> {
    if (!this.account) {
      throw new Error(this.t('accountNotFound', 'Account not found'))
    }
    this.assertAccountNetwork(this.account)

    // Dynamic import sats-connect
    let satsConnect: typeof import('sats-connect')
    try {
      satsConnect = await import('sats-connect')
    } catch {
      throw new Error(
        this.t('satsConnectNotInstalled', 'sats-connect library is required for Xverse wallet')
      )
    }

    const { signMessage: satsSignMessage, BitcoinNetworkType } = satsConnect

    return new Promise((resolve, reject) => {
      satsSignMessage({
        payload: {
          address: this.account?.address || '',
          message,
          network: {
            type:
              this.getNetwork() === 'Mainnet'
                ? BitcoinNetworkType.Mainnet
                : BitcoinNetworkType.Testnet,
          },
        },
        onFinish: resolve,
        onCancel: () => {
          reject(new Error(this.t('requestCanceled', 'Request canceled')))
        },
      }).catch(reject)
    })
  }

  disconnect(): void {
    this.account = undefined
  }
}
