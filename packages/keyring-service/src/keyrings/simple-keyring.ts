import {
  ECPairInterface,
  bitcoin,
  eccManager,
  signMessageOfDeterministicECDSA,
  tweakSigner,
  verifyMessageOfECDSA,
} from '@unisat/wallet-bitcoin'
import { isTaprootInput } from 'bitcoinjs-lib/src/psbt/bip371.js'
import { decode } from 'bs58check'
import { EventEmitter } from 'events'
import { ToSignInput } from '../types'
import { deriveContextHash, parseHexContext } from './derive-context-hash'

const type = 'Simple Key Pair'

export class SimpleKeyring extends EventEmitter {
  static type = type
  type = type
  network: bitcoin.Network = bitcoin.networks.bitcoin
  wallets: ECPairInterface[] = []

  constructor(opts?: any) {
    super()
    if (opts) {
      this.deserialize(opts)
    }
  }

  async serialize(): Promise<any> {
    return this.wallets.map(wallet => wallet.privateKey?.toString('hex'))
  }

  async deserialize(opts: any) {
    const privateKeys = opts as string[]

    this.wallets = privateKeys.map(key => {
      let buf: Buffer
      if (key.length === 64) {
        // privateKey
        buf = Buffer.from(key, 'hex')
      } else {
        // base58
        buf = Buffer.from(decode(key).slice(1, 33))
      }

      return eccManager.eccPair.fromPrivateKey(buf as any)
    })
  }

  async addAccounts(n = 1) {
    const newWallets: ECPairInterface[] = []
    for (let i = 0; i < n; i++) {
      newWallets.push(eccManager.eccPair.makeRandom())
    }
    this.wallets = this.wallets.concat(newWallets)
    const hexWallets = newWallets.map(({ publicKey }) => publicKey.toString('hex'))
    return hexWallets
  }

  async getAccounts() {
    return this.wallets.map(({ publicKey }) => publicKey.toString('hex'))
  }

  async signTransaction(psbt: bitcoin.Psbt, inputs: ToSignInput[], opts?: any) {
    inputs.forEach(input => {
      const keyPair = this._getPrivateKeyFor(input.publicKey)
      if (isTaprootInput(psbt.data.inputs[input.index] as any)) {
        let signer: bitcoin.Signer = keyPair
        let tweak = true // default to use tweaked signer
        if (typeof input.useTweakedSigner === 'boolean') {
          tweak = input.useTweakedSigner
        } else if (typeof input.disableTweakSigner === 'boolean') {
          tweak = !input.disableTweakSigner
        }

        if (tweak) {
          signer = tweakSigner(keyPair, opts)
        }
        psbt.signTaprootInput(
          input.index,
          signer,
          input.tapLeafHashToSign as any,
          input.sighashTypes
        )
      } else {
        let signer: bitcoin.Signer = keyPair
        let tweak = false // default not to use tweaked signer
        if (typeof input.useTweakedSigner === 'boolean') {
          tweak = input.useTweakedSigner
        }
        if (tweak) {
          signer = tweakSigner(keyPair, opts)
        }
        psbt.signInput(input.index, signer, input.sighashTypes)
      }
    })
    return psbt
  }

  async signMessage(publicKey: string, text: string) {
    const keyPair = this._getPrivateKeyFor(publicKey)
    return signMessageOfDeterministicECDSA(keyPair, text)
  }

  async verifyMessage(publicKey: string, text: string, sig: string) {
    return verifyMessageOfECDSA(publicKey, text, sig)
  }

  private _getPrivateKeyFor(publicKey: string) {
    if (!publicKey) {
      throw new Error('Must specify publicKey.')
    }
    const wallet = this._getWalletForAccount(publicKey)
    return wallet
  }

  async exportAccount(publicKey: string) {
    const wallet = this._getWalletForAccount(publicKey)
    return wallet.privateKey?.toString('hex')
  }

  removeAccount(publicKey: string) {
    if (!this.wallets.map(wallet => wallet.publicKey.toString('hex')).includes(publicKey)) {
      throw new Error(`PublicKey ${publicKey} not found in this keyring`)
    }

    this.wallets = this.wallets.filter(wallet => wallet.publicKey.toString('hex') !== publicKey)
  }

  async deriveContextHash(publicKey: string, appName: string, context: string): Promise<string> {
    const wallet = this._getWalletForAccount(publicKey)
    if (!wallet.privateKey) {
      throw new Error('deriveContextHash requires access to the private key')
    }
    const contextBytes = parseHexContext(context)
    const privKeyBytes = new Uint8Array(wallet.privateKey)
    try {
      return deriveContextHash(privKeyBytes, appName, contextBytes)
    } finally {
      privKeyBytes.fill(0)
    }
  }

  private _getWalletForAccount(publicKey: string) {
    let wallet = this.wallets.find(wallet => wallet.publicKey.toString('hex') == publicKey)
    if (!wallet) {
      throw new Error('Simple Keyring - Unable to find matching publicKey.')
    }
    return wallet
  }
}
