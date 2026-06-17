import * as bip39 from 'bip39'
//@ts-ignore
import bitcore from 'bitcore-lib'
//@ts-ignore
import * as hdkey from 'hdkey'

import { ECPairInterface, bitcoin, eccManager, toXOnly, tweakSigner } from '@unisat/wallet-bitcoin'
import { isTaprootInput } from 'bitcoinjs-lib/src/psbt/bip371.js'
import { deriveContextHash, parseHexContext } from './derive-context-hash'
import { SimpleKeyring } from './simple-keyring'

const hdPathString = "m/44'/0'/0'/0"
// BIP-32 path for deriveContextHash IKM. Purpose index = trunc31_be(SHA-256("derive-context-hash")).
const DERIVE_CONTEXT_HASH_PATH = "m/73681862'"
const RGB_MAINNET_COIN_TYPE = 827166
const RGB_TESTNET_COIN_TYPE = 827167
const type = 'HD Key Tree'

interface DeserializeOption {
  hdPath?: string
  mnemonic?: string
  xpriv?: string
  activeIndexes?: number[]
  passphrase?: string
  accountIndexDerivation?: boolean
}

function normalizeHex(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value.toLowerCase()
  return Buffer.from(value as any)
    .toString('hex')
    .toLowerCase()
}

function xpubFingerprint(hdNode: any): string {
  const identifier = hdNode?._identifier || hdNode?.identifier
  if (identifier) {
    return Buffer.from(identifier).subarray(0, 4).toString('hex')
  }
  if (typeof hdNode?.fingerprint === 'number') {
    return hdNode.fingerprint.toString(16).padStart(8, '0')
  }
  throw new Error('HD Keyring - Unable to calculate master fingerprint.')
}

function normalizeDerivationPath(path: string): string {
  return path.startsWith('m/') ? path : `m/${path}`
}

function isNonHardenedIndex(segment: string | undefined): boolean {
  if (!segment || segment.endsWith("'")) return false
  const index = Number(segment)
  return Number.isInteger(index) && index >= 0
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

  async getRgbWalletContext(networkType: number) {
    if (!this.mnemonic && !this.xpriv) {
      throw new Error('RGB wallet context requires a mnemonic or master xpriv')
    }

    const isMainnet = networkType === 0
    const bitcoreNetwork = isMainnet ? bitcore.Networks.livenet : bitcore.Networks.testnet
    const root = this.mnemonic
      ? bitcore.HDPrivateKey.fromSeed(
          bip39.mnemonicToSeedSync(this.mnemonic, this.passphrase),
          bitcoreNetwork
        )
      : new bitcore.HDPrivateKey(this.xpriv)
    const coinType = isMainnet ? 0 : 1
    const rgbCoinType = isMainnet ? RGB_MAINNET_COIN_TYPE : RGB_TESTNET_COIN_TYPE

    return {
      xpubVan: root.deriveChild(`m/86'/${coinType}'/0'`).hdPublicKey.toString(),
      xpubCol: root.deriveChild(`m/86'/${rgbCoinType}'/0'`).hdPublicKey.toString(),
      masterFingerprint: root.hdPublicKey.fingerPrint.toString('hex'),
      vanillaKeychain: 0,
    }
  }

  override async signTransaction(psbt: bitcoin.Psbt, inputs: any[], opts?: any) {
    inputs.forEach(input => {
      const keyPair = this._getPrivateKeyForPsbtInput(
        psbt.data.inputs[input.index],
        input.publicKey
      )
      if (isTaprootInput(psbt.data.inputs[input.index] as any)) {
        let signer: bitcoin.Signer = keyPair
        let tweak = true
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
        let tweak = false
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

  // Build a path where account segment (index 3) is replaced by accountIndex
  // e.g. "m/84'/0'/0'/0" + accountIndex=2 → "m/84'/0'/2'/0"
  private _buildAccountLevelPath(hdPath: string, accountIndex: number): string {
    const segments = hdPath.split('/')
    segments[3] = `${accountIndex}'`
    return segments.join('/')
  }

  private _getPrivateKeyForPsbtInput(psbtInput: any, publicKey: string) {
    const wallet = this.wallets.find(wallet => {
      const walletPubkey = wallet.publicKey.toString('hex')
      return walletPubkey === publicKey || toXOnly(wallet.publicKey).toString('hex') === publicKey
    })
    if (wallet) {
      return wallet
    }

    const derivations = [
      ...(psbtInput?.tapBip32Derivation || []),
      ...(psbtInput?.bip32Derivation || []),
    ]
    for (const derivation of derivations) {
      const path = derivation?.path
      if (!path) continue
      if (!this._matchesDerivationFingerprint(derivation)) continue
      if (!this._isAllowedRgbPsbtPath(path)) continue
      const child = this.hdWallet?.derive(normalizeDerivationPath(path))
      if (!child?.privateKey) continue
      const derived = eccManager.eccPair.fromPrivateKey(child.privateKey, { network: this.network })
      const derivedPubkey = derived.publicKey.toString('hex')
      const derivedXOnly = toXOnly(derived.publicKey).toString('hex')
      const derivationPubkey = normalizeHex(derivation.pubkey)
      const requestedPubkey = publicKey.toLowerCase()
      if (
        derivationPubkey &&
        (requestedPubkey === derivedPubkey || requestedPubkey === derivedXOnly) &&
        (derivationPubkey === derivedPubkey || derivationPubkey === derivedXOnly)
      ) {
        return derived
      }
    }

    throw new Error('HD Keyring - Unable to find matching RGB PSBT publicKey.')
  }

  private _matchesDerivationFingerprint(derivation: any) {
    const fingerprint = normalizeHex(derivation?.masterFingerprint)
    return fingerprint === xpubFingerprint(this.hdWallet)
  }

  private _isAllowedRgbPsbtPath(path: string) {
    const segments = normalizeDerivationPath(path).split('/')
    if (segments.length !== 6 || segments[1] !== "86'") {
      return false
    }

    const coinType = segments[2]
    const allowedCoinTypes = new Set([
      "0'",
      "1'",
      `${RGB_MAINNET_COIN_TYPE}'`,
      `${RGB_TESTNET_COIN_TYPE}'`,
    ])
    if (!allowedCoinTypes.has(coinType as any)) {
      return false
    }

    const accountIndex = Number(segments[3]?.replace(/'$/, ''))
    if (!Number.isInteger(accountIndex) || accountIndex < 0 || !segments[3]?.endsWith("'")) {
      return false
    }

    if (!isNonHardenedIndex(segments[4]) || !isNonHardenedIndex(segments[5])) {
      return false
    }

    if (this.accountIndexDerivation) {
      return this.activeIndexes.includes(accountIndex)
    }
    return accountIndex === 0
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
    context: string
  ): Promise<string> {
    const contextBytes = parseHexContext(context)
    const pubkeyBytes = Uint8Array.from(Buffer.from(publicKey, 'hex'))
    if (!this.hdWallet) {
      throw new Error('deriveContextHash requires a mnemonic or xpriv-based keyring')
    }
    const child = this.hdWallet.derive(DERIVE_CONTEXT_HASH_PATH)
    const privKeyBytes = new Uint8Array(child.privateKey)
    try {
      return deriveContextHash(
        privKeyBytes,
        appName,
        canonicalNetworkName,
        pubkeyBytes,
        contextBytes
      )
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
