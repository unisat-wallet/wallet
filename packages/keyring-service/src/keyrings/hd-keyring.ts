import * as bip39 from 'bip39'
//@ts-ignore
import bitcore from 'bitcore-lib'
//@ts-ignore
import * as hdkey from 'hdkey'

import { ECPairInterface, bitcoin, eccManager } from '@unisat/wallet-bitcoin'
import { deriveContextHash, parseHexContext } from './derive-context-hash'
import { SimpleKeyring } from './simple-keyring'

const hdPathString = "m/44'/0'/0'/0"
// BIP-32 path for deriveContextHash IKM. Purpose index = trunc31_be(SHA-256("derive-context-hash")).
const DERIVE_CONTEXT_HASH_PATH = "m/73681862'"
const type = 'HD Key Tree'

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

    if (!bip39.mnemonicToSeedSync) {
      throw new Error('Btc-Hd-Keyring: mnemonicToSeedSync is required')
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic, this.passphrase)
    try {
      this.hdWallet = hdkey.fromMasterSeed(seed)
      this.root = this.hdWallet.derive(this.hdPath)
    } finally {
      seed?.fill?.(0)
    }
  }

  clearRecoveryData() {
    this.mnemonic = ''
    this.xpriv = ''
    this.passphrase = ''
  }

  /**
   * Watch-only descriptor material: master fingerprint + account-level xpub.
   * UniSat hdPath is typically m/purpose'/coin'/account'/change — account path drops change.
   * Short paths (e.g. Ordinals Wallet `m/86'/0'/0'` with no change segment) use xpubLevel
   * `chain` so export is `…xpub/*` (children = wallet addresses), not wrong `…/0/*`.
   *
   * Fingerprint is only returned for mnemonic-rooted keyrings (true master fpr).
   * xpriv-only roots omit fingerprint — never emit a wrong `[fpr/…]` origin.
   */
  getAccountXpubMaterial(accountIndex = 0): {
    fingerprint?: string
    accountPath: string
    xpub: string
    /** `account` → descriptor `xpub/0/*`; `chain` → `xpub/*` (no separate change) */
    xpubLevel: 'account' | 'chain'
  } {
    if (!this.hdWallet) {
      throw new Error('Btc-Hd-Keyring: Not support')
    }

    // m / purpose' / coin' / account' [/ change]
    const hasChangeSegment = this.hdPath.split('/').length >= 5
    const xpubLevel: 'account' | 'chain' = hasChangeSegment ? 'account' : 'chain'

    // Multi-account short path: wallet only uses /0 per account', but chain-level
    // export would advertise xpub/* — refuse rather than misrepresent the address set.
    if (this.accountIndexDerivation && xpubLevel === 'chain') {
      throw new Error(
        'Cannot export a ranged descriptor for multi-account short-path wallets; use a standard BIP path that includes a change segment'
      )
    }

    let accountPath: string
    if (this.accountIndexDerivation) {
      accountPath = this._buildAccountLevelPath(this.hdPath, accountIndex)
      // drop trailing change segment if present
      const parts = accountPath.split('/')
      if (parts.length >= 5) {
        accountPath = parts.slice(0, 4).join('/')
      }
    } else {
      const parts = this.hdPath.split('/')
      if (parts.length >= 5) {
        accountPath = parts.slice(0, 4).join('/')
      } else {
        accountPath = this.hdPath
      }
    }

    const accountNode = this.hdWallet.derive(accountPath)

    // Master fingerprint only when rooted at mnemonic seed (hdWallet = master).
    // xpriv-imported nodes expose the node's own identifier — not the master fpr.
    let fingerprint: string | undefined
    if (this.mnemonic) {
      const identifier: Buffer = this.hdWallet.identifier || this.hdWallet._identifier
      if (!identifier || identifier.length < 4) {
        throw new Error('Btc-Hd-Keyring: master fingerprint unavailable')
      }
      fingerprint = Buffer.from(identifier).subarray(0, 4).toString('hex')
    }

    return {
      ...(fingerprint ? { fingerprint } : {}),
      accountPath,
      xpub: accountNode.publicExtendedKey,
      xpubLevel,
    }
  }

  changeHdPath(hdPath: string) {
    if (!this.hdWallet) {
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
    if (!this.hdWallet) {
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

  override clearSensitiveData() {
    super.clearSensitiveData()

    const wipeHdNode = (node: any) => {
      node?.privateKey?.fill(0)
      node?._privateKey?.fill(0)
      node?.chainCode?.fill(0)
    }

    wipeHdNode(this.root)
    wipeHdNode(this.hdWallet)
    this._index2wallet = {}
    this.activeIndexes = []
    this.root = null
    this.hdWallet = undefined
    this.clearRecoveryData()
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
   * Derive a deterministic context hash from the wallet's key material.
   * Uses BIP-32 derivation at m/73681862' from the HD wallet root.
   *
   * @param publicKey            - The connected pubkey (66-char compressed hex) to inject into HKDF info per spec v2.0.
   * @param appName              - Application identifier.
   * @param canonicalNetworkName - Canonical Bitcoin network name (e.g. "bitcoin-mainnet").
   * @param context              - Hex-encoded context string.
   */
  override async deriveContextHash(
    publicKey: string,
    appName: string,
    canonicalNetworkName: string,
    context: string,
  ): Promise<string> {
    const contextBytes = parseHexContext(context)
    const pubkeyBytes = Uint8Array.from(Buffer.from(publicKey, 'hex'))
    if (!this.hdWallet) {
      throw new Error('deriveContextHash requires a mnemonic or xpriv-based keyring')
    }
    const child = this.hdWallet.derive(DERIVE_CONTEXT_HASH_PATH)
    const privKeyBytes = new Uint8Array(child.privateKey)
    try {
      return deriveContextHash(privKeyBytes, appName, canonicalNetworkName, pubkeyBytes, contextBytes)
    } finally {
      privKeyBytes.fill(0)
      // Zero the original BIP-32 node's key buffer as well
      if (child.privateKey) {
        child.privateKey.fill(0)
      }
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
