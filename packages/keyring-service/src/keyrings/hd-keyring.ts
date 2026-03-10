import * as bip39 from 'bip39'
//@ts-ignore
import bitcore from 'bitcore-lib'
//@ts-ignore
import * as hdkey from 'hdkey'

import { ECPairInterface, bitcoin, eccManager } from '@unisat/wallet-bitcoin'
import { deriveLamportKeypair, lamportPublicKey, lamportSign, LamportPublicKey } from './lamport'
import { SimpleKeyring } from './simple-keyring'

const hdPathString = "m/44'/0'/0'/0"
const type = 'HD Key Tree'

/** Validate and decode a hex-encoded context string. */
function parseHexContext(context: string): Uint8Array {
  if (typeof context !== 'string' || context.length === 0) {
    throw new Error('Lamport context must be a non-empty hex string')
  }
  if (context.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(context)) {
    throw new Error('Lamport context must be an even-length hex string')
  }
  return Buffer.from(context, 'hex')
}

interface DeserializeOption {
  hdPath?: string
  mnemonic?: string
  xpriv?: string
  activeIndexes?: number[]
  passphrase?: string
  accountIndexDerivation?: boolean
}

export class HdKeyring extends SimpleKeyring {
  static override type = type

  override type = type
  mnemonic: string = ''
  xpriv: string = ''
  passphrase: string = ''
  override network: bitcoin.Network = bitcoin.networks.bitcoin

  // m / purpose' / coin_type' / account' / change / address_index
  hdPath = hdPathString
  accountIndexDerivation = false
  root: bitcore.HDPrivateKey = null
  hdWallet?: any
  override wallets: ECPairInterface[] = []
  private _index2wallet: Record<number, [string, ECPairInterface]> = {}
  activeIndexes: number[] = []
  page = 0
  perPage = 5

  constructor(opts?: DeserializeOption) {
    super(null)
    if (opts) {
      this.deserialize(opts)
    }
  }

  override async serialize(): Promise<DeserializeOption> {
    return {
      mnemonic: this.mnemonic,
      xpriv: this.xpriv,
      activeIndexes: this.activeIndexes,
      hdPath: this.hdPath,
      passphrase: this.passphrase,
      accountIndexDerivation: this.accountIndexDerivation,
    }
  }

  override async deserialize(_opts: DeserializeOption = {}) {
    if (this.root) {
      throw new Error('Btc-Hd-Keyring: Secret recovery phrase already provided')
    }
    let opts = _opts as DeserializeOption
    this.wallets = []
    this.mnemonic = ''
    this.xpriv = ''
    this.root = null
    this.hdPath = opts.hdPath || hdPathString
    this.accountIndexDerivation = opts.accountIndexDerivation ?? false
    if (opts.passphrase) {
      this.passphrase = opts.passphrase
    }

    if (opts.mnemonic) {
      this.initFromMnemonic(opts.mnemonic)
    } else if (opts.xpriv) {
      this.initFromXpriv(opts.xpriv)
    }

    if (opts.activeIndexes) {
      this.activeAccounts(opts.activeIndexes)
    }
  }

  initFromXpriv(xpriv: string) {
    if (this.root) {
      throw new Error('Btc-Hd-Keyring: Secret recovery phrase already provided')
    }

    this.xpriv = xpriv
    this._index2wallet = {}

    this.hdWallet = hdkey.fromJSON({ xpriv })
    this.root = this.hdWallet
  }

  initFromMnemonic(mnemonic: string) {
    if (this.root) {
      throw new Error('Btc-Hd-Keyring: Secret recovery phrase already provided')
    }

    this.mnemonic = mnemonic
    this._index2wallet = {}

    let seed
    if (bip39.mnemonicToSeedSync) {
      seed = bip39.mnemonicToSeedSync(mnemonic, this.passphrase)
    } else {
      seed = bip39.mnemonicToSeed(mnemonic, this.passphrase)
    }
    this.hdWallet = hdkey.fromMasterSeed(seed)
    this.root = this.hdWallet.derive(this.hdPath)
  }

  changeHdPath(hdPath: string) {
    if (!this.mnemonic) {
      throw new Error('Btc-Hd-Keyring: Not support')
    }

    this.hdPath = hdPath

    this.root = this.hdWallet.derive(this.hdPath)

    const indexes = this.activeIndexes
    this._index2wallet = {}
    this.activeIndexes = []
    this.wallets = []
    this.activeAccounts(indexes)
  }

  getAccountByHdPath(hdPath: string, index: number) {
    if (!this.mnemonic) {
      throw new Error('Btc-Hd-Keyring: Not support')
    }
    let derivePath: string
    let deriveIndex: number
    if (this.accountIndexDerivation) {
      derivePath = this._buildAccountLevelPath(hdPath, index)
      deriveIndex = 0
    } else {
      derivePath = hdPath
      deriveIndex = index
    }
    const root = this.hdWallet.derive(derivePath)
    const child = root.deriveChild(deriveIndex)
    const ecpair = eccManager.eccPair.fromPrivateKey(child.privateKey, {
      network: this.network,
    })
    const address = ecpair.publicKey.toString('hex')
    return address
  }

  // Build a path where account segment (index 3) is replaced by accountIndex
  // e.g. "m/84'/0'/0'/0" + accountIndex=2 → "m/84'/0'/2'/0"
  private _buildAccountLevelPath(hdPath: string, accountIndex: number): string {
    const segments = hdPath.split('/')
    segments[3] = `${accountIndex}'`
    return segments.join('/')
  }

  override addAccounts(numberOfAccounts = 1) {
    let count = numberOfAccounts
    let currentIdx = 0
    const newWallets: ECPairInterface[] = []

    while (count) {
      const [, wallet] = this._addressFromIndex(currentIdx)
      if (this.wallets.includes(wallet)) {
        currentIdx++
      } else {
        this.wallets.push(wallet)
        newWallets.push(wallet)
        this.activeIndexes.push(currentIdx)
        count--
      }
    }

    const hexWallets = newWallets.map(w => {
      return w.publicKey.toString('hex')
    })

    return Promise.resolve(hexWallets)
  }

  activeAccounts(indexes: number[]) {
    const accounts: string[] = []
    for (const index of indexes) {
      const [address, wallet] = this._addressFromIndex(index)
      this.wallets.push(wallet)
      this.activeIndexes.push(index)

      accounts.push(address)
    }

    return accounts
  }

  getFirstPage() {
    this.page = 0
    return this.__getPage(1)
  }

  getNextPage() {
    return this.__getPage(1)
  }

  getPreviousPage() {
    return this.__getPage(-1)
  }

  getAddresses(start: number, end: number) {
    const from = start
    const to = end
    const accounts: { address: string; index: number }[] = []
    for (let i = from; i < to; i++) {
      const [address] = this._addressFromIndex(i)
      accounts.push({
        address,
        index: i + 1,
      })
    }
    return accounts
  }

  async __getPage(increment: number) {
    this.page += increment

    if (!this.page || this.page <= 0) {
      this.page = 1
    }

    const from = (this.page - 1) * this.perPage
    const to = from + this.perPage

    const accounts: { address: string; index: number }[] = []

    for (let i = from; i < to; i++) {
      const [address] = this._addressFromIndex(i)
      accounts.push({
        address,
        index: i + 1,
      })
    }

    return accounts
  }

  override async getAccounts() {
    return this.wallets.map(w => {
      return w.publicKey.toString('hex')
    })
  }

  getIndexByAddress(address: string) {
    for (const key in this._index2wallet) {
      if (this._index2wallet[key]?.[0] === address) {
        return Number(key)
      }
    }
    return null
  }

  /**
   * Derive a deterministic Lamport public key from this keyring's seed
   * and an opaque context byte string.
   *
   * @param context - Hex-encoded context bytes (caller-defined).
   * @returns The Lamport public key as two arrays of hex-encoded Hash160 hashes.
   */
  async getLamportPublicKey(context: string): Promise<LamportPublicKey> {
    if (!this.mnemonic) {
      throw new Error('Lamport signatures require a mnemonic-based keyring')
    }
    const contextBytes = parseHexContext(context)
    const seedBuf = bip39.mnemonicToSeedSync(this.mnemonic, this.passphrase)
    const seed = new Uint8Array(seedBuf.buffer, seedBuf.byteOffset, seedBuf.byteLength)
    try {
      const keypair = deriveLamportKeypair(seed, contextBytes)
      return lamportPublicKey(keypair)
    } finally {
      seed.fill(0)
    }
  }

  /**
   * Sign with a Lamport keypair derived from this keyring's seed.
   *
   * @param context   - Hex-encoded context bytes (same as used for public key).
   * @param proofBits - Array of 508 values, each 0 or 1.
   * @returns Array of 508 hex-encoded preimages.
   */
  async signWithLamport(context: string, proofBits: number[]): Promise<string[]> {
    if (!this.mnemonic) {
      throw new Error('Lamport signatures require a mnemonic-based keyring')
    }
    const contextBytes = parseHexContext(context)
    const seedBuf = bip39.mnemonicToSeedSync(this.mnemonic, this.passphrase)
    const seed = new Uint8Array(seedBuf.buffer, seedBuf.byteOffset, seedBuf.byteLength)
    try {
      return lamportSign(seed, contextBytes, proofBits)
    } finally {
      seed.fill(0)
    }
  }

  private _addressFromIndex(i: number) {
    if (!this._index2wallet[i]) {
      let ecpair: ECPairInterface
      if (this.accountIndexDerivation) {
        // MagicEden style: m/84'/0'/i'/0/0 — vary account index, address index = 0
        const path = this._buildAccountLevelPath(this.hdPath, i)
        const root = this.hdWallet.derive(path)
        const child = root.deriveChild(0)
        ecpair = eccManager.eccPair.fromPrivateKey(child.privateKey, { network: this.network })
      } else {
        const child = this.root.deriveChild(i)
        ecpair = eccManager.eccPair.fromPrivateKey(child.privateKey, { network: this.network })
      }
      const address = ecpair.publicKey.toString('hex')
      this._index2wallet[i] = [address, ecpair]
    }

    return this._index2wallet[i] as [string, ECPairInterface]
  }
}
