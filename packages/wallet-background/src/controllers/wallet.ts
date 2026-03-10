import { tapleafHash } from 'bitcoinjs-lib/src/payments/bip341.js'
import bitcore from 'bitcore-lib'

import {
  BabylonConfigV2,
  COSMOS_CHAINS_MAP,
  CosmosChainInfo,
  CosmosKeyring,
  DelegationV2StakingState,
  getDelegationsV2,
} from '@unisat/babylon-service'
import { ColdWalletKeyring, KeystoneKeyring } from '@unisat/keyring-service'
import { DisplayedKeyring, Keyring, KeyringType, ToSignInput } from '@unisat/keyring-service/types'
import * as txHelpers from '@unisat/tx-helpers'
import { signMessageOfBIP322Simple, UnspentOutput } from '@unisat/tx-helpers'
import {
  bitcoin,
  eccManager,
  genPsbtOfBIP322Simple,
  getSignatureFromPsbtOfBIP322Simple,
  isValidAddress,
  publicKeyToAddress,
  scriptPkToAddress,
  toPsbtNetwork,
  toXOnly,
  UTXO_DUST,
} from '@unisat/wallet-bitcoin'
import {
  Account,
  AddressUserToSignInput,
  bgI18n,
  BitcoinBalance,
  BRC20HistoryItem,
  BUS_EVENTS,
  BUS_METHODS,
  CAT_VERSION,
  CHAINS_MAP,
  ConnectedSite,
  CosmosBalance,
  CosmosSignDataType,
  DummyTxType,
  getLockTimeInfo,
  LocalPsbtSummary,
  PlatformEnv,
  PsbtActionDetailType,
  PsbtActionInfo,
  PsbtActionType,
  PublicKeyUserToSignInput,
  RateUsStatus,
  RiskType,
  SESSION_EVENTS,
  SignedData,
  SignedMessage,
  SignMessageType,
  SignPsbtOptions,
  t,
  ToSignData,
  ToSignMessage,
  UTXO,
  WalletKeyring,
} from '@unisat/wallet-shared'
import { AddressType, ChainType, NetworkType } from '@unisat/wallet-types'
import {
  contactBookService,
  keyringService,
  notificationService,
  permissionService,
  preferenceService,
  sessionService,
  walletApiService,
} from '../services'
import { getChainInfo } from '../shared/utils'
import { bgEventBus } from '../utils/eventBus'
import { getEstimateFee, psbtFromString } from '../utils/psbt-utils'

import { baseUtils, bnUtils, paramsUtils } from '@unisat/base-utils'
import {
  ADDRESS_TYPES,
  AddressFlagType,
  BRAND_ALIAN_TYPE_TEXT,
  KEYRING_TYPES,
  NETWORK_TYPES,
} from '@unisat/wallet-shared'
import log from 'loglevel'
import approvalService from 'src/services/approval'
import { ContactBookItem } from '../services/contactBook'
import BaseController from './base'

export type AccountAsset = {
  name: string
  symbol: string
  amount: string
  value: string
}

const caculateTapLeafHash = (input: any, pubkey: Buffer) => {
  if (input.tapInternalKey && !input.tapLeafScript) {
    return []
  }
  const tapLeafHashes = (input.tapLeafScript || []).map(tapLeaf => {
    const hash = tapleafHash({
      output: tapLeaf.script,
      version: tapLeaf.leafVersion,
    })
    return Object.assign({ hash }, tapLeaf)
  })

  return tapLeafHashes.map(each => each.hash)
}

export class WalletController extends BaseController {
  timer: any = null

  private _cacheCosmosKeyringKey: string | null = null
  private _cosmosKeyring: CosmosKeyring | null = null

  cosmosChainInfoMap: Record<string, CosmosChainInfo> = Object.assign({}, COSMOS_CHAINS_MAP)

  private backgroundInited = false

  setBackgroundInited = async (value: boolean) => {
    this.backgroundInited = value
  }
  getBackgroundInited = async () => {
    return this.backgroundInited
  }

  async init(adapters?: any): Promise<void> {
    console.log('[WalletController] Initialized')
  }

  protected override onInitialize(): Promise<void> {
    return Promise.resolve()
  }

  protected override onCleanup(): Promise<void> {
    return Promise.resolve()
  }

  getDesc = () => {
    return 'desc_test'
  }

  /* wallet */
  boot = (password: string) => keyringService.boot(password)
  isBooted = async () => keyringService.isBooted()

  getApproval = async () => {
    return approvalService.getApproval()
  }
  resolveApproval = approvalService.resolveApproval
  rejectApproval = approvalService.rejectApproval

  hasVault = () => keyringService.hasVault()
  verifyPassword = (password: string) => keyringService.verifyPassword(password)
  changePassword = (password: string, newPassword: string) =>
    keyringService.changePassword(password, newPassword)

  initAlianNames = async () => {
    preferenceService.changeInitAlianNameStatus()
  }

  isReady = () => {
    return true
  }

  unlock = async (password: string) => {
    const alianNameInited = preferenceService.getInitAlianNameStatus()
    const alianNames = contactBookService.listAlias()
    await keyringService.submitPassword(password)
    sessionService.broadcastEvent(SESSION_EVENTS.unlock)
    if (!alianNameInited && alianNames.length === 0) {
      this.initAlianNames()
    }

    this._resetTimeout()
  }
  isUnlocked = () => {
    return keyringService.memStore.getState().isUnlocked
  }

  lockWallet = async () => {
    await keyringService.setLocked()
    // sessionService.broadcastEvent(SESSION_EVENTS.accountsChanged, [])
    sessionService.broadcastEvent(SESSION_EVENTS.lock)
    bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
      method: BUS_METHODS.LOCKED,
      params: {},
    })
  }

  setPopupOpen = (isOpen: boolean) => {
    preferenceService.setPopupOpen(isOpen)
  }

  getAddressBalance = async (address: string) => {
    const data = await walletApiService.bitcoin.getAddressBalance(address)
    preferenceService.updateAddressBalance(address, data)
    return data
  }

  getAddressBalanceV2 = async (address: string) => {
    const chainType = this.getChainType()
    const data = await walletApiService.bitcoin.getAddressBalanceV2(address)
    return { ...data, chainType }
  }

  getMultiAddressAssets = async (addresses: string) => {
    return walletApiService.bitcoin.getMultiAddressAssets(addresses)
  }

  findGroupAssets = (groups: { type: number; address_arr: string[]; pubkey_arr: string[] }[]) => {
    return walletApiService.bitcoin.findGroupAssets(groups)
  }

  getAddressCacheBalance = (address: string | undefined): BitcoinBalance => {
    const defaultBalance: BitcoinBalance = {
      confirm_amount: '0',
      pending_amount: '0',
      amount: '0',
      usd_value: '0',
      confirm_btc_amount: '0',
      pending_btc_amount: '0',
      btc_amount: '0',
      confirm_inscription_amount: '0',
      pending_inscription_amount: '0',
      inscription_amount: '0',
    }
    if (!address) return defaultBalance
    return preferenceService.getAddressBalance(address) || defaultBalance
  }

  getAddressHistory = async (params: { address: string; start: number; limit: number }) => {
    const data = await walletApiService.bitcoin.getAddressRecentHistory(params)
    // preferenceService.updateAddressHistory(address, data);
    // return data;
    //   todo
    return data
  }

  getAddressInscriptions = async (address: string, cursor: number, size: number) => {
    const data = await walletApiService.inscriptions.getAddressInscriptions(address, cursor, size)
    return data
  }

  getAddressCacheHistory = (address: string | undefined) => {
    if (!address) return []
    return preferenceService.getAddressHistory(address)
  }

  getExternalLinkAck = () => {
    preferenceService.getExternalLinkAck()
  }

  setExternalLinkAck = ack => {
    preferenceService.setExternalLinkAck(ack)
  }

  getLocale = () => {
    return preferenceService.getLocale()
  }

  setLocale = async (locale: string) => {
    preferenceService.setLocale(locale)
    await bgI18n.changeLanguage(locale)
    bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
      method: BUS_METHODS.LOCALE_CHANGED,
      params: locale,
    })
  }

  getCurrency = () => {
    return preferenceService.getCurrency()
  }

  setCurrency = (currency: string) => {
    preferenceService.setCurrency(currency)
  }

  /* keyrings */

  clearKeyrings = () => keyringService.clearKeyrings()

  resetAllData = async () => {
    await keyringService.resetAllData()
    await preferenceService.resetAllData()
    await permissionService.resetAllData()
    await contactBookService.resetAllData()
    await walletApiService.resetAllData()

    this._resetTimeout()
  }

  getPrivateKey = async (password: string, { pubkey, type }: { pubkey: string; type: string }) => {
    const isValidPassword = await this.verifyPassword(password)
    if (!isValidPassword) {
      throw new Error(t('password_error'))
    }
    const keyring = await keyringService.getKeyringForAccount(pubkey, type)
    if (!keyring) return null
    const privateKey = await keyring.exportAccount(pubkey)
    const networkType = this.getNetworkType()
    const network = toPsbtNetwork(networkType)
    const hex = privateKey
    const wif = eccManager.eccPair
      .fromPrivateKey(Buffer.from(privateKey, 'hex'), { network })
      .toWIF()
    return {
      hex,
      wif,
    }
  }

  getMnemonics = async (password: string, keyring: WalletKeyring) => {
    const isValidPassword = await this.verifyPassword(password)
    if (!isValidPassword) {
      throw new Error(t('password_error'))
    }
    const originKeyring = keyringService.keyrings[keyring.index]!
    const serialized = await originKeyring.serialize()
    return {
      mnemonic: serialized.mnemonic,
      hdPath: serialized.hdPath,
      passphrase: serialized.passphrase,
    }
  }

  createKeyringWithPrivateKey = async (
    data: string,
    addressType: AddressType,
    alianName?: string
  ) => {
    let originKeyring: Keyring
    try {
      originKeyring = await keyringService.importPrivateKey(data, addressType)
    } catch (e) {
      log.error(e)
      throw e
    }

    const displayedKeyring = await keyringService.displayForKeyring(
      originKeyring,
      addressType,
      keyringService.keyrings.length - 1
    )
    const keyring = this.displayedKeyringToWalletKeyring(
      displayedKeyring,
      keyringService.keyrings.length - 1
    )
    await this.changeKeyring(keyring)
  }

  getPreMnemonics = () => keyringService.getPreMnemonics()
  generatePreMnemonic = async () => {
    return await keyringService.generatePreMnemonic()
  }
  removePreMnemonics = () => keyringService.removePreMnemonics()
  createKeyringWithMnemonics = async (
    mnemonic: string,
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount: number,
    accountIndexDerivation = false
  ) => {
    const originKeyring = await keyringService.createKeyringWithMnemonics(
      mnemonic,
      hdPath,
      passphrase,
      addressType,
      accountCount,
      accountIndexDerivation
    )
    keyringService.removePreMnemonics()

    const displayedKeyring = await keyringService.displayForKeyring(
      originKeyring,
      addressType,
      keyringService.keyrings.length - 1
    )
    const keyring = this.displayedKeyringToWalletKeyring(
      displayedKeyring,
      keyringService.keyrings.length - 1
    )

    await this.changeKeyring(keyring)
  }

  createTmpKeyringWithMnemonics = async (
    mnemonic: string,
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount = 1,
    accountIndexDerivation = false
  ) => {
    const activeIndexes: number[] = []
    for (let i = 0; i < accountCount; i++) {
      activeIndexes.push(i)
    }
    const originKeyring = keyringService.createTmpKeyring('HD Key Tree', {
      mnemonic,
      activeIndexes,
      hdPath,
      passphrase,
      accountIndexDerivation,
    })
    const displayedKeyring = await keyringService.displayForKeyring(originKeyring, addressType, -1)
    return this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
  }

  createTmpKeyringWithMnemonics2 = async (
    mnemonic: string,
    passphrase: string,
    hdPaths: string[],
    addressTypes: AddressType[]
  ) => {
    const keyrings: WalletKeyring[] = []
    const activeIndexes: number[] = [0]
    let originKeyring
    for (let i = 0; i < hdPaths.length; i++) {
      if (!originKeyring) {
        originKeyring = await keyringService.createTmpKeyring('HD Key Tree', {
          mnemonic,
          activeIndexes,
          hdPath: hdPaths[0],
          passphrase,
        })
      }
      originKeyring.changeHdPath(hdPaths[i])
      const displayedKeyring = await keyringService.displayForKeyring(
        originKeyring,
        addressTypes[i]!,
        -1
      )
      const keyring = this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
      keyrings.push(keyring)
    }
    return keyrings
  }

  createTmpKeyringWithMnemonicsScan = async (
    mnemonic: string,
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount = 1,
    accountIndexDerivation = false
  ) => {
    const activeIndexes: number[] = []
    for (let i = 0; i < accountCount; i++) {
      activeIndexes.push(i)
    }
    const originKeyring = await keyringService.createTmpKeyring('HD Key Tree', {
      mnemonic,
      activeIndexes,
      hdPath,
      passphrase,
      accountIndexDerivation,
    })
    const displayedKeyring = await keyringService.displayForKeyring(originKeyring, addressType, -1)
    return this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
  }

  createTmpKeyringWithPrivateKey = async (privateKey: string, addressType: AddressType) => {
    const originKeyring = keyringService.createTmpKeyring(KeyringType.SimpleKeyring, [privateKey])
    const displayedKeyring = await keyringService.displayForKeyring(originKeyring, addressType, -1)
    return this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
  }

  createTmpKeyringWithKeystone = async (
    urType: string,
    urCbor: string,
    addressType: AddressType,
    hdPath: string,
    accountCount: number
  ) => {
    const tmpKeyring = new KeystoneKeyring()
    await tmpKeyring.initFromUR(urType, urCbor)
    if (hdPath.length >= 13) {
      tmpKeyring.changeChangeAddressHdPath(hdPath)
      tmpKeyring.addAccounts(accountCount)
    } else {
      tmpKeyring.changeHdPath(ADDRESS_TYPES[addressType]!.hdPath)
      accountCount && tmpKeyring.addAccounts(accountCount)
    }

    const opts = await tmpKeyring.serialize()
    const originKeyring = keyringService.createTmpKeyring(KeyringType.KeystoneKeyring, opts)
    const displayedKeyring = await keyringService.displayForKeyring(originKeyring, addressType, -1)
    return this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
  }

  createKeyringWithKeystone = async (
    urType: string,
    urCbor: string,
    addressType: AddressType,
    hdPath: string,
    accountCount = 1,
    filterPubkey: string[] = [],
    connectionType: 'USB' | 'QR' = 'USB'
  ) => {
    const originKeyring = await keyringService.createKeyringWithKeystone(
      urType,
      urCbor,
      addressType,
      hdPath,
      accountCount,
      connectionType
    )

    if (filterPubkey !== null && filterPubkey !== undefined && filterPubkey.length > 0) {
      const accounts = await originKeyring.getAccounts()
      accounts.forEach(account => {
        if (!filterPubkey.includes(account)) {
          originKeyring.removeAccount(account)
        }
      })
    }
    const account = await originKeyring.getAccounts()
    const displayedKeyring = await keyringService.displayForKeyring(
      originKeyring,
      addressType,
      keyringService.keyrings.length - 1
    )
    const keyring = this.displayedKeyringToWalletKeyring(
      displayedKeyring,
      keyringService.keyrings.length - 1
    )
    await this.changeKeyring(keyring)
  }

  createKeyringWithColdWallet = async (
    xpub: string,
    addressType: AddressType,
    alianName?: string,
    hdPath?: string,
    accountCount = 1
  ) => {
    const accounts = await this.deriveAccountsFromXpub(xpub, addressType, hdPath, accountCount)
    const addresses = accounts.map(acc => acc.address)
    const publicKeys = accounts.map(acc => acc.pubkey)

    const coldWalletKeyring = new ColdWalletKeyring({
      xpub,
      addresses,
      connectionType: 'QR',
      hdPath: hdPath!,
      publicKeys,
    })

    const originKeyring = await keyringService.addKeyring(coldWalletKeyring, addressType)
    const displayedKeyring = await keyringService.displayForKeyring(
      originKeyring,
      addressType,
      keyringService.keyrings.length - 1
    )

    const keyring = this.displayedKeyringToWalletKeyring(
      displayedKeyring,
      keyringService.keyrings.length - 1
    )

    if (alianName) {
      this.setKeyringAlianName(keyring, alianName)
    }

    await this.changeKeyring(keyring)

    return keyring
  }

  /**
   * Derive accounts from extended public key (receive chain level only)
   * For paths like m/84'/0'/0'/0, derives m/84'/0'/0'/0/i addresses
   */
  deriveAccountsFromXpub = async (
    xpub: string,
    addressType: AddressType,
    hdPath?: string,
    accountCount = 1
  ): Promise<{ pubkey: string; address: string }[]> => {
    // Validate xpub format
    const validPrefixes = ['xpub', 'tpub', 'ypub', 'zpub']
    if (!validPrefixes.some(prefix => xpub?.startsWith(prefix))) {
      throw new Error('Invalid xpub format')
    }

    const hdPublicKey = new bitcore.HDPublicKey(xpub)
    const networkType = this.getNetworkType()
    const accounts: { pubkey: string; address: string }[] = []

    // Derive addresses: m/84'/0'/0'/0/i
    for (let i = 0; i < accountCount; i++) {
      const addressKey = hdPublicKey.deriveChild(i)
      const publicKeyHex = addressKey.publicKey.toString('hex')
      const address = publicKeyToAddress(publicKeyHex, addressType, networkType)
      accounts.push({ pubkey: publicKeyHex, address })
    }

    return accounts
  }

  removeKeyring = async (keyring: WalletKeyring) => {
    await keyringService.removeKeyring(keyring.index)
    const keyrings = await this.getKeyrings()
    const nextKeyring = keyrings[keyrings.length - 1]
    if (nextKeyring && nextKeyring.accounts[0]) {
      await this.changeKeyring(nextKeyring)
      return nextKeyring
    }
    return
  }

  getKeyringByType = (type: string) => {
    return keyringService.getKeyringByType(type)
  }

  deriveNewAccountFromMnemonic = async (keyring: WalletKeyring, alianName?: string) => {
    const _keyring = keyringService.keyrings[keyring.index]!
    await keyringService.addNewAccount(_keyring)

    const displayedKeyring = await keyringService.displayForKeyring(
      _keyring,
      keyring.addressType,
      keyring.index
    )
    const newKeyring = this.displayedKeyringToWalletKeyring(displayedKeyring, keyring.index)

    await this.changeKeyring(newKeyring, newKeyring.accounts.length - 1)

    if (alianName) {
      const account = preferenceService.getCurrentAccount() as Account
      preferenceService.setAccountAlianName(account.key, alianName)
      account.alianName = alianName
    }
  }

  getAccountsCount = async () => {
    const accounts = await keyringService.getAccounts()
    return accounts.filter(x => x).length
  }

  changeKeyring = async (keyring: WalletKeyring, accountIndex = 0) => {
    preferenceService.setCurrentKeyringIndex(keyring.index)
    const account = keyring.accounts[accountIndex]!
    preferenceService.setCurrentAccount(account)
    if (account) {
      sessionService.broadcastEvent(SESSION_EVENTS.accountsChanged, [account.address])

      bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
        method: BUS_METHODS.ACCOUNTS_CHANGED,
        params: account,
      })
    }

    await walletApiService.setClientAddress(keyring.accounts[accountIndex]!.address)
  }

  getAllAddresses = async (keyring: WalletKeyring, index: number) => {
    const networkType = this.getNetworkType()
    const pubkeys = await keyringService.getAllPubkeysByDerivedIndex(keyring, index)
    const addresses = pubkeys.map(v => {
      return publicKeyToAddress(v.pubkey, v.type, networkType)
    })
    return addresses
  }

  changeAddressType = async (addressType: AddressType) => {
    const currentAccount = await this.getCurrentAccount()
    const currentKeyringIndex = preferenceService.getCurrentKeyringIndex()
    await keyringService.changeAddressType(currentKeyringIndex, addressType)
    const keyring = await this.getCurrentKeyring()
    if (!keyring) throw new Error('no current keyring')
    await this.changeKeyring(keyring, currentAccount?.index)
  }

  formatOptionsToSignInputs = async (_psbt: string | bitcoin.Psbt, options?: SignPsbtOptions) => {
    const account = await this.getCurrentAccount()
    if (!account) throw null

    let toSignInputs: ToSignInput[] = []
    if (options && options.toSignInputs) {
      // We expect userToSignInputs objects to be similar to ToSignInput interface,
      // but we allow address to be specified in addition to publicKey for convenience.
      toSignInputs = options.toSignInputs.map(input => {
        const index = Number(input.index)
        if (isNaN(index)) throw new Error('invalid index in toSignInput')

        if (
          !(input as AddressUserToSignInput).address &&
          !(input as PublicKeyUserToSignInput).publicKey
        ) {
          throw new Error('no address or public key in toSignInput')
        }

        if (
          (input as AddressUserToSignInput).address &&
          (input as AddressUserToSignInput).address != account.address
        ) {
          throw new Error('invalid address in toSignInput')
        }

        if (
          (input as PublicKeyUserToSignInput).publicKey &&
          (input as PublicKeyUserToSignInput).publicKey != account.pubkey
        ) {
          throw new Error('invalid public key in toSignInput')
        }

        const sighashTypes = input.sighashTypes?.map(Number)
        if (sighashTypes?.some(isNaN)) throw new Error('invalid sighash type in toSignInput')

        let tapLeafHashToSign: string | Buffer | undefined
        if (input.tapLeafHashToSign) {
          if (typeof input.tapLeafHashToSign !== 'string') {
            tapLeafHashToSign = Buffer.from(input.tapLeafHashToSign, 'hex')
          } else if ((input.tapLeafHashToSign as any) instanceof Uint8Array) {
            tapLeafHashToSign = Buffer.from(input.tapLeafHashToSign)
          } else {
            tapLeafHashToSign = input.tapLeafHashToSign
          }

          tapLeafHashToSign = tapLeafHashToSign.toString('hex')
        }
        return {
          index,
          publicKey: account.pubkey,
          sighashTypes,
          useTweakedSigner: input.useTweakedSigner,
          disableTweakSigner: input.disableTweakSigner,
          tapLeafHashToSign,
        } as any
      })
    } else {
      const networkType = this.getNetworkType()
      const psbtNetwork = toPsbtNetwork(networkType)

      const psbt =
        typeof _psbt === 'string'
          ? bitcoin.Psbt.fromHex(_psbt as string, { network: psbtNetwork })
          : (_psbt as bitcoin.Psbt)
      psbt.data.inputs.forEach((v, index) => {
        let script: any = null
        let value = 0
        if (v.witnessUtxo) {
          script = v.witnessUtxo.script
          value = v.witnessUtxo.value
        } else if (v.nonWitnessUtxo) {
          const tx = bitcoin.Transaction.fromBuffer(v.nonWitnessUtxo)
          const output = tx.outs[psbt.txInputs[index]!.index]!
          script = output.script
          value = output.value
        }
        const isSigned =
          v.finalScriptSig || v.finalScriptWitness || v.tapKeySig || v.partialSig || v.tapScriptSig
        if (script && !isSigned) {
          const address = scriptPkToAddress(script, networkType)
          if (account.address === address) {
            toSignInputs.push({
              index,
              publicKey: account.pubkey,
              sighashTypes: v.sighashType ? [v.sighashType] : undefined,
            })
          }
        }
      })

      if (toSignInputs.length === 0) {
        psbt.data.inputs.forEach((input, index) => {
          // if no toSignInputs, sign all inputs
          toSignInputs.push({
            index: index,
            publicKey: account.pubkey,
          })
        })
      }
    }

    return toSignInputs
  }

  formatPsbt = async (psbt: bitcoin.Psbt, toSignInputs: ToSignInput[], autoFinalized?: boolean) => {
    const account = await this.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const keyring = await this.getCurrentKeyring()
    if (!keyring) throw new Error('no current keyring')
    const _keyring = keyringService.keyrings[keyring.index]!

    const networkType = this.getNetworkType()
    const psbtNetwork = toPsbtNetwork(networkType)

    if (!toSignInputs) {
      // Compatibility with legacy code.
      toSignInputs = await this.formatOptionsToSignInputs(psbt)
    }

    const isKeystone = keyring.type === KeyringType.KeystoneKeyring
    const isColdWallet = keyring.type === KeyringType.ColdWalletKeyring
    let bip32Derivation: any = undefined

    if (isKeystone) {
      if (!_keyring.mfp) {
        throw new Error('no mfp in keyring')
      }
      bip32Derivation = {
        masterFingerprint: Buffer.from(_keyring.mfp as string, 'hex'),
        path: `${keyring.hdPath}/${account.index}`,
        pubkey: Buffer.from(account.pubkey, 'hex'),
      }

      const chainType = this.getChainType()
      const chain = CHAINS_MAP[chainType]!

      // use the unknown keyValue to indicate FB tx in psbt for keystone
      if (chain.isFractal && account.type === KeyringType.KeystoneKeyring) {
        const keysString = 'chain'
        // use ff as the keyType in the psbt global unknown
        const key = Buffer.from('ff' + Buffer.from(keysString).toString('hex'), 'hex')

        // check if already added
        const existing =
          psbt.data.globalMap.unknownKeyVals &&
          psbt.data.globalMap.unknownKeyVals.find(ukv => {
            return ukv.key.toString('hex') === key.toString('hex')
          })
        if (existing) {
          // already added
          // ignore
        } else {
          psbt.addUnknownKeyValToGlobal({ key, value: Buffer.from(chain.unit.toLowerCase()) })
        }
      }
    }

    let willBeSignedInputCount = 0
    psbt.data.inputs.forEach((input, index) => {
      const isSigned =
        input.finalScriptSig ||
        input.finalScriptWitness ||
        input.tapKeySig ||
        input.partialSig ||
        input.tapScriptSig
      if (isSigned) {
        willBeSignedInputCount++
        return
      }

      const isToBeSigned = toSignInputs.some(v => v.index === index)
      if (!isToBeSigned) {
        return
      }
      willBeSignedInputCount++

      let isP2TR = false
      try {
        bitcoin.payments.p2tr({ output: input.witnessUtxo?.script!, network: psbtNetwork })
        isP2TR = true
      } catch (e) {
        // skip
      }

      if (isP2TR) {
        // fix p2tr input data
        let isKeyPathP2TR = false

        try {
          const originXPubkey = toXOnly(Buffer.from(account.pubkey, 'hex')).toString('hex')
          const tapInternalKey = toXOnly(Buffer.from(account.pubkey, 'hex'))
          const { output } = bitcoin.payments.p2tr({
            internalPubkey: tapInternalKey,
            network: psbtNetwork,
          })
          if (input.witnessUtxo?.script.toString('hex') == output?.toString('hex')) {
            isKeyPathP2TR = true
          }
          if (isKeyPathP2TR) {
            input.tapInternalKey = tapInternalKey
          } else {
            // only keypath p2tr can have tapInternalKey
            delete input.tapInternalKey
          }

          if (isKeyPathP2TR) {
            // keypath p2tr should be signed with origin signer
          } else {
            const isToBeSigned: any = toSignInputs.find(v => v.index === index)
            if (
              isToBeSigned.useTweakedSigner == undefined &&
              isToBeSigned.disableTweakSigner == undefined
            ) {
              if (input.tapLeafScript && input.tapLeafScript.length > 0) {
                const script = input.tapLeafScript[0]!.script.toString('hex')
                if (script.includes(originXPubkey)) {
                  // if tapLeafScript contains origin pubkey, use origin signer
                  isToBeSigned.useTweakedSigner = false
                } else {
                  // if tapLeafScript not contains origin pubkey, use tweaked signer
                  isToBeSigned.useTweakedSigner = true
                }
              } else {
                // if no tapLeafScript, use origin signer
                isToBeSigned.useTweakedSigner = false
              }
            }
          }
        } catch (e) {
          // skip
        }
      }

      if (isKeystone) {
        if (isP2TR) {
          input.tapBip32Derivation = [
            {
              ...bip32Derivation,
              pubkey: bip32Derivation.pubkey.slice(1),
              leafHashes: caculateTapLeafHash(input, bip32Derivation.pubkey),
            },
          ]
        } else {
          input.bip32Derivation = [bip32Derivation]
        }
      }
    })

    if (autoFinalized !== false && willBeSignedInputCount === psbt.inputCount) {
      autoFinalized = true
    } else {
      autoFinalized = false
    }

    return {
      psbt,
      toSignInputs,
      autoFinalized,
    }
  }

  _signPsbt = async (psbt: bitcoin.Psbt, toSignInputs: ToSignInput[], autoFinalized: boolean) => {
    const account = await this.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const keyring = await this.getCurrentKeyring()
    if (!keyring) throw new Error('no current keyring')
    const _keyring = keyringService.keyrings[keyring.index]!

    toSignInputs.forEach(v => {
      if (v.tapLeafHashToSign) {
        v.tapLeafHashToSign = Buffer.from(v.tapLeafHashToSign as string, 'hex')
      }
    })
    psbt = await keyringService.signTransaction(_keyring, psbt, toSignInputs as any)

    if (autoFinalized) {
      try {
        toSignInputs.forEach(v => {
          // psbt.validateSignaturesOfInput(v.index, validator);
          psbt.finalizeInput(v.index)
        })
      } catch (e) {
        // ignore
      }
    }
    return psbt
  }

  // abstract wallet function
  signPsbt = async (psbt: bitcoin.Psbt, opts?: SignPsbtOptions): Promise<bitcoin.Psbt> => {
    const res = await this.formatPsbt(psbt, opts?.toSignInputs as any, opts?.autoFinalized as any)
    const signedPsbt = await this._signPsbt(res.psbt, res.toSignInputs, res.autoFinalized)
    return signedPsbt
  }

  // local sign function
  signPsbtV2 = async (toSignData: ToSignData): Promise<SignedData> => {
    const psbt = psbtFromString(toSignData.psbtHex)
    await this._signPsbt(psbt, toSignData.toSignInputs, toSignData.autoFinalized!)
    return {
      psbtHex: psbt.toHex(),
    }
  }

  signMessage = async (params: ToSignMessage): Promise<SignedMessage> => {
    if (!params.text || params.text.length > 10000) {
      throw new Error('Invalid message length')
    }

    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const networkType = this.getNetworkType()
    if (params.type === SignMessageType.BIP322_SIMPLE) {
      const signature = await signMessageOfBIP322Simple({
        message: params.text,
        address: account.address,
        networkType,
        wallet: this as any,
      })
      return {
        signature,
      }
    } else {
      const signature = await keyringService.signMessage(account.pubkey, account.type, params.text)
      return {
        signature,
      }
    }
  }

  addContact = (data: ContactBookItem) => {
    contactBookService.addContact(data)
  }

  updateContact = (data: ContactBookItem) => {
    contactBookService.updateContact(data)
  }

  getContactByAddress = (address: string): ContactBookItem | undefined => {
    return contactBookService.getContactByAddress(address)
  }

  getContactByAddressAndChain = (
    address: string,
    chain: ChainType
  ): ContactBookItem | undefined => {
    return contactBookService.getContactByAddressAndChain(address, chain)
  }

  private _generateAlianName = (type: string, index: number) => {
    return `${BRAND_ALIAN_TYPE_TEXT[type]} ${index}`
  }

  removeContact = (address: string, chain?: ChainType) => {
    if (chain) {
      contactBookService.removeContact(address, chain)
    } else {
      console.warn('removeContact called without chain parameter, using old method')
      const contact = contactBookService.getContactByAddress(address)
      if (contact) {
        contactBookService.removeContact(address, contact.chain)
      }
    }
  }

  listContact = (includeAlias = true): ContactBookItem[] => {
    const list = contactBookService.listContacts()
    if (includeAlias) {
      return list
    } else {
      return list.filter(item => !item.isAlias)
    }
  }

  listContacts = (): ContactBookItem[] => {
    return contactBookService.listContacts()
  }

  saveContactsOrder = (contacts: ContactBookItem[]) => {
    return contactBookService.saveContactsOrder(contacts)
  }

  getContactsByMap = (): Record<string, ContactBookItem> => {
    return contactBookService.getContactsByMap()
  }

  getNextAlianName = (keyring: WalletKeyring) => {
    return this._generateAlianName(keyring.type, keyring.accounts.length + 1)
  }

  getHighlightWalletList = () => {
    return preferenceService.getWalletSavedList()
  }

  updateHighlightWalletList = list => {
    return preferenceService.updateWalletSavedList(list)
  }

  getAllAlianName = (): (ContactBookItem | undefined)[] => {
    return contactBookService.listAlias()
  }

  getInitAlianNameStatus = () => {
    return preferenceService.getInitAlianNameStatus()
  }

  updateInitAlianNameStatus = () => {
    preferenceService.changeInitAlianNameStatus()
  }

  getIsFirstOpen = () => {
    return preferenceService.getIsFirstOpen()
  }

  updateIsFirstOpen = () => {
    return preferenceService.updateIsFirstOpen()
  }

  reportErrors = (error: string) => {
    console.error('report not implemented')
  }

  getNetworkType = () => {
    const chainType = this.getChainType()
    return CHAINS_MAP[chainType]!.networkType
  }

  setNetworkType = async (networkType: NetworkType) => {
    if (networkType === NetworkType.MAINNET) {
      this.setChainType(ChainType.BITCOIN_MAINNET)
    } else {
      this.setChainType(ChainType.BITCOIN_TESTNET)
    }
  }

  getNetworkName = () => {
    const networkType = this.getNetworkType()
    return NETWORK_TYPES[networkType]!.name
  }

  getLegacyNetworkName = () => {
    const chainType = this.getChainType()
    if (
      chainType === ChainType.BITCOIN_MAINNET ||
      chainType === ChainType.BITCOIN_TESTNET ||
      chainType === ChainType.BITCOIN_TESTNET4
    ) {
      return NETWORK_TYPES[CHAINS_MAP[chainType]!.networkType]!.name
    } else {
      return 'unknown'
    }
  }

  setChainType = async (chainType: ChainType) => {
    const currentChainType = preferenceService.getChainType()
    if (currentChainType === chainType) {
      return
    }

    preferenceService.setChainType(chainType)
    walletApiService.setEndpoint(CHAINS_MAP[chainType]!.endpoints[0]!)

    const currentAccount = await this.getCurrentAccount()
    const keyring = await this.getCurrentKeyring()
    if (!keyring) throw new Error('no current keyring')
    await this.changeKeyring(keyring, currentAccount?.index)

    const chainInfo = getChainInfo(chainType)
    sessionService.broadcastEvent(SESSION_EVENTS.chainChanged, chainInfo)

    const network = this.getLegacyNetworkName()
    sessionService.broadcastEvent(SESSION_EVENTS.networkChanged, {
      network,
    })

    bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
      method: BUS_METHODS.CHAIN_CHANGED,
      params: {
        type: chainType,
      },
    })
  }

  getChainType = () => {
    return preferenceService.getChainType()
  }

  getBTCUtxos = async () => {
    // getBTCAccount
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const utxos = await walletApiService.bitcoin.getBTCUtxos(account.address)

    const btcUtxos = utxos.map(v => {
      return {
        txid: v.txid,
        vout: v.vout,
        satoshis: v.satoshis,
        scriptPk: v.scriptPk,
        addressType: v.addressType,
        pubkey: account.pubkey,
        inscriptions: v.inscriptions,
        atomicals: [],
      }
    })
    return btcUtxos
  }

  createSendBTCPsbt = async ({
    to,
    amount,
    feeRate,
    btcUtxos,
    memo,
    memos,
  }: {
    to: string
    amount: number
    feeRate?: number
    btcUtxos?: UnspentOutput[]
    memo?: string
    memos?: string[]
  }): Promise<{
    psbtHex: string
    toSignInputs: ToSignInput[]
  }> => {
    amount = paramsUtils.formatAmount(amount)

    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const networkType = this.getNetworkType()

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos()
    }

    if (btcUtxos!.length == 0) {
      throw new Error('Insufficient balance.')
    }

    if (!isValidAddress(to, networkType)) {
      throw new Error('Invalid address.')
    }

    if (!feeRate) {
      const feeSummary = await this.getFeeSummary()
      feeRate = feeSummary.list[1]?.feeRate! // use normal fee rate
    }

    const { psbt, toSignInputs } = await txHelpers.sendBTC({
      btcUtxos: btcUtxos!,
      tos: [{ address: to, satoshis: amount }],
      networkType,
      changeAddress: account.address,
      feeRate: feeRate!,
      memo: memo!,
      memos: memos!,
    })

    const title = `${t('send')} ${this.getBTCUnit()}`

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
      action: {
        name: title,
        description: '',
        details: [
          {
            label: t('to'),
            value: to,
            type: PsbtActionDetailType.ADDRESS,
          },
          {
            label: t('amount'),
            value: amount,
            type: PsbtActionDetailType.SATOSHIS,
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  createSendAllBTCPsbt = async ({
    to,
    feeRate,
    btcUtxos,
  }: {
    to: string
    feeRate: number
    btcUtxos?: UnspentOutput[]
  }): Promise<{
    psbtHex: string
    toSignInputs: ToSignInput[]
  }> => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const networkType = this.getNetworkType()

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos()
    }

    if (btcUtxos!.length == 0) {
      throw new Error('Insufficient balance.')
    }

    const { psbt, toSignInputs } = await txHelpers.sendAllBTC({
      btcUtxos: btcUtxos!,
      toAddress: to,
      networkType,
      feeRate,
    })

    let totalInput = 0
    btcUtxos.forEach(v => {
      totalInput += v.satoshis
    })

    const title = `${t('send')} ${this.getBTCUnit()}`
    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
      action: {
        name: title,
        description: '',
        details: [
          {
            label: t('to'),
            value: to,
            type: PsbtActionDetailType.ADDRESS,
          },
          {
            label: t('amount'),
            value: totalInput,
            type: PsbtActionDetailType.SATOSHIS,
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  createSendInscriptionPsbt = async ({
    to,
    inscriptionId,
    feeRate,
    outputValue,
    btcUtxos,
  }: {
    to: string
    inscriptionId: string
    feeRate?: number
    outputValue?: number
    btcUtxos?: txHelpers.UnspentOutput[]
  }): Promise<ToSignData> => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const networkType = this.getNetworkType()

    const utxo = await walletApiService.inscriptions.getInscriptionUtxo(inscriptionId)
    if (!utxo) {
      throw new Error('UTXO not found.')
    }

    const assetUtxo = Object.assign(utxo, { pubkey: account.pubkey })

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos()
    }

    if (btcUtxos!.length == 0) {
      throw new Error('Insufficient balance.')
    }

    if (!outputValue) {
      outputValue = assetUtxo.satoshis
    }

    if (!feeRate) {
      const feeSummary = await this.getFeeSummary()
      feeRate = feeSummary.list[1]?.feeRate! // use normal fee rate
    }

    const { psbt, toSignInputs } = await txHelpers.sendInscription({
      assetUtxo,
      btcUtxos: btcUtxos!,
      toAddress: to,
      networkType,
      changeAddress: account.address,
      feeRate,
      outputValue: outputValue || assetUtxo.satoshis,
      enableMixed: true,
    })

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
      action: {
        name: t('send_inscription2'),
        description: '',
        details: [
          {
            label: t('to'),
            type: PsbtActionDetailType.ADDRESS,
            value: baseUtils.shortAddress(to),
          },
          {
            label: t('Approval_SpendInscription'),
            type: PsbtActionDetailType.INSCRIPTION,
            value: inscriptionId,
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  createSendMultipleInscriptionsPsbt = async ({
    to,
    inscriptionIds,
    feeRate,
    btcUtxos,
  }: {
    to: string
    inscriptionIds: string[]
    utxos: UTXO[]
    feeRate: number
    btcUtxos?: txHelpers.UnspentOutput[]
  }): Promise<ToSignData> => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const networkType = this.getNetworkType()

    const inscription_utxos =
      await walletApiService.inscriptions.getInscriptionUtxos(inscriptionIds)
    if (!inscription_utxos) {
      throw new Error('UTXO not found.')
    }

    if (inscription_utxos.find(v => v.inscriptions.length > 1)) {
      throw new Error('Multiple inscriptions are mixed together. Please split them first.')
    }

    const assetUtxos = inscription_utxos.map(v => {
      return Object.assign(v, { pubkey: account.pubkey })
    })

    const toDust = txHelpers.getAddressUtxoDust(to)

    assetUtxos.forEach(v => {
      if (v.satoshis < toDust) {
        throw new Error(
          'Unable to send inscriptions to this address in batches, please send them one by one.'
        )
      }
    })

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos()
    }

    if (btcUtxos!.length == 0) {
      throw new Error('Insufficient balance.')
    }

    const { psbt, toSignInputs } = await txHelpers.sendInscriptions({
      assetUtxos,
      btcUtxos: btcUtxos!,
      toAddress: to,
      networkType,
      changeAddress: account.address,
      feeRate,
    })

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
      action: {
        name: t('send_inscription2'),
        description: '',
        details: [
          {
            label: t('to'),
            value: to,
            type: PsbtActionDetailType.ADDRESS,
          },
          {
            label: t('spending_assets'),
            value: `${inscriptionIds.length} ${t('inscription')}`,
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  createSplitInscriptionPsbt = async ({
    inscriptionId,
    feeRate,
    outputValue,
    btcUtxos,
  }: {
    to: string
    inscriptionId: string
    feeRate: number
    outputValue: number
    btcUtxos?: txHelpers.UnspentOutput[]
  }): Promise<ToSignData> => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const networkType = this.getNetworkType()

    const utxo = await walletApiService.inscriptions.getInscriptionUtxo(inscriptionId)
    if (!utxo) {
      throw new Error('UTXO not found.')
    }

    const assetUtxo = Object.assign(utxo, { pubkey: account.pubkey })

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos()
    }

    const { psbt, toSignInputs, splitedCount } = await txHelpers.splitInscriptionUtxo({
      assetUtxo,
      btcUtxos: btcUtxos!,
      networkType,
      changeAddress: account.address,
      feeRate,
      outputValue,
    })

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: false,
      },
      action: {
        name: t('Split inscriptions'),
        description: '',
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  pushTx = async (txData: string) => {
    let rawtx = txData
    if (txData.startsWith('70')) {
      // psbthex
      const psbt = psbtFromString(txData)
      try {
        psbt.finalizeAllInputs()
      } catch (e) {
        // skip
      }
      rawtx = psbt.extractTransaction(true).toHex()
    }
    const txid = await walletApiService.bitcoin.pushTx(rawtx)
    return txid
  }

  getAccounts = async () => {
    const keyrings = await this.getKeyrings()
    const accounts: Account[] = keyrings.reduce<Account[]>(
      (pre, cur) => pre.concat(cur.accounts),
      []
    )
    return accounts
  }

  displayedKeyringToWalletKeyring = (
    displayedKeyring: DisplayedKeyring,
    index: number,
    initName = true
  ) => {
    const networkType = this.getNetworkType()
    const addressType = displayedKeyring.addressType
    const key = 'keyring_' + index
    const type = displayedKeyring.type
    const accounts: Account[] = []

    for (let j = 0; j < displayedKeyring.accounts.length; j++) {
      let pubkey: string
      let address: string

      if (type === KeyringType.ColdWalletKeyring) {
        // For cold wallets, we might not have pubkey, so we use the address directly
        // The account might be just an address string for cold wallets
        if (typeof displayedKeyring.accounts[j] === 'string') {
          address = displayedKeyring.accounts[j] as unknown as string
          pubkey = ''
        } else {
          const account = displayedKeyring.accounts[j] as any
          pubkey = account.pubkey || ''
          address = account.address || publicKeyToAddress(pubkey, addressType, networkType)
        }
      } else {
        const { pubkey: accountPubkey } = displayedKeyring.accounts[j]!
        pubkey = accountPubkey
        address = publicKeyToAddress(pubkey, addressType, networkType)
      }

      const accountKey = key + '#' + j
      const defaultName = this._generateAlianName(type, j + 1)
      const alianName = preferenceService.getAccountAlianName(accountKey, defaultName)!
      const flag = preferenceService.getAddressFlag(address)
      accounts.push({
        type,
        pubkey,
        address,
        alianName,
        index: j,
        key: accountKey,
        flag,
      })
    }
    const hdPath =
      type === KeyringType.HdKeyring || type === KeyringType.KeystoneKeyring
        ? displayedKeyring.keyring.hdPath
        : ''
    const accountIndexDerivation: boolean =
      type === KeyringType.HdKeyring
        ? (displayedKeyring.keyring.accountIndexDerivation ?? false)
        : false
    const alianName = preferenceService.getKeyringAlianName(
      key,
      initName ? `${KEYRING_TYPES[type]!.alianName} #${index + 1}` : ''
    )!
    const keyring: WalletKeyring = {
      index,
      key,
      type,
      addressType,
      accounts,
      alianName,
      hdPath,
      accountIndexDerivation,
    }
    return keyring
  }

  getKeyrings = async (): Promise<WalletKeyring[]> => {
    const displayedKeyrings = await keyringService.getAllDisplayedKeyrings()
    const keyrings: WalletKeyring[] = []
    for (let index = 0; index < displayedKeyrings.length; index++) {
      const displayedKeyring = displayedKeyrings[index]!
      if (displayedKeyring.type !== KeyringType.Empty) {
        const keyring = this.displayedKeyringToWalletKeyring(
          displayedKeyring,
          displayedKeyring.index
        )
        keyrings.push(keyring)
      }
    }

    return keyrings
  }

  getTotalKeyringCount = async () => {
    const displayedKeyrings = await keyringService.getAllDisplayedKeyrings()
    return displayedKeyrings.length
  }

  getCurrentKeyring = async () => {
    let currentKeyringIndex = preferenceService.getCurrentKeyringIndex()
    const displayedKeyrings = await keyringService.getAllDisplayedKeyrings()
    if (currentKeyringIndex === undefined) {
      const currentAccount = preferenceService.getCurrentAccount()
      for (let i = 0; i < displayedKeyrings.length; i++) {
        if (displayedKeyrings[i]!.type !== currentAccount?.type) {
          continue
        }
        const found = displayedKeyrings[i]!.accounts.find(v => v.pubkey === currentAccount?.pubkey)
        if (found) {
          currentKeyringIndex = i
          break
        }
      }
      if (currentKeyringIndex === undefined) {
        currentKeyringIndex = 0
      }
    }

    if (
      !displayedKeyrings[currentKeyringIndex] ||
      displayedKeyrings[currentKeyringIndex]!.type === KeyringType.Empty ||
      !displayedKeyrings[currentKeyringIndex]!.accounts[0]
    ) {
      for (let i = 0; i < displayedKeyrings.length; i++) {
        if (displayedKeyrings[i]!.type !== KeyringType.Empty) {
          currentKeyringIndex = i
          preferenceService.setCurrentKeyringIndex(currentKeyringIndex)
          break
        }
      }
    }
    const displayedKeyring = displayedKeyrings[currentKeyringIndex]
    if (!displayedKeyring) return null
    return this.displayedKeyringToWalletKeyring(displayedKeyring, currentKeyringIndex)
  }

  getCurrentAccount = async () => {
    const currentKeyring = await this.getCurrentKeyring()
    if (!currentKeyring) return null
    const account = preferenceService.getCurrentAccount()
    let currentAccount: Account | undefined = undefined
    currentKeyring.accounts.forEach(v => {
      if (v.pubkey === account?.pubkey) {
        currentAccount = v
      }
    })
    if (!currentAccount) {
      currentAccount = currentKeyring.accounts[0]
    }
    if (currentAccount) {
      currentAccount.flag = preferenceService.getAddressFlag(currentAccount.address)
      walletApiService.setClientAddress(currentAccount.address)
    }

    return currentAccount
  }

  getEditingKeyring = async () => {
    const editingKeyringIndex = preferenceService.getEditingKeyringIndex()
    const displayedKeyrings = await keyringService.getAllDisplayedKeyrings()
    const displayedKeyring = displayedKeyrings[editingKeyringIndex]!
    return this.displayedKeyringToWalletKeyring(displayedKeyring, editingKeyringIndex)
  }

  setEditingKeyring = async (index: number) => {
    preferenceService.setEditingKeyringIndex(index)
  }

  getEditingAccount = async () => {
    const account = preferenceService.getEditingAccount()
    return account
  }

  setEditingAccount = async (account: Account) => {
    preferenceService.setEditingAccount(account as any)
  }

  queryDomainInfo = async (domain: string) => {
    const data = await walletApiService.domain.getDomainInfo(domain)
    return data
  }

  getInscriptionSummary = async () => {
    const data = await walletApiService.inscriptions.getInscriptionSummary()
    return data
  }

  getAppSummary = async () => {
    const appTab = preferenceService.getAppTab()
    try {
      const data = await walletApiService.utility.getAppSummary()
      const readTabTime = appTab.readTabTime
      data.apps.forEach(w => {
        const readAppTime = appTab.readAppTime[w.id]
        if (w.time) {
          if (Date.now() > w.time + 1000 * 60 * 60 * 24 * 7) {
            w.new = false
          } else if (readAppTime && readAppTime > w.time) {
            w.new = false
          } else {
            w.new = true
          }
        } else {
          w.new = false
        }
      })
      data.readTabTime = readTabTime
      preferenceService.setAppSummary(data)
      return data
    } catch (e) {
      console.log('getAppSummary error:', e)
      return appTab.summary
    }
  }

  readTab = async () => {
    return preferenceService.setReadTabTime(Date.now())
  }

  readApp = async (appid: number) => {
    return preferenceService.setReadAppTime(appid, Date.now())
  }

  getAddressUtxo = async (address: string) => {
    const data = await walletApiService.bitcoin.getBTCUtxos(address)
    return data
  }

  getConnectedSites = (): ConnectedSite[] => {
    const data = permissionService.getConnectedSites()
    return data
  }
  setRecentConnectedSites = (sites: ConnectedSite[]) => {
    permissionService.setRecentConnectedSites(sites)
  }
  getRecentConnectedSites = (): ConnectedSite[] => {
    return permissionService.getRecentConnectedSites()
  }
  getCurrentSite = (tabId: number): ConnectedSite | null => {
    const { origin, name, icon } = sessionService.getSession(tabId) || {}
    if (!origin) {
      return null
    }
    const site = permissionService.getSite(origin)
    if (site) {
      return site
    }
    return {
      origin,
      name: name!,
      icon: icon!,
      chain: ChainType.BITCOIN_MAINNET,
      isConnected: false,
      isSigned: false,
      isTop: false,
    }
  }
  getCurrentConnectedSite = (tabId: number): ConnectedSite | undefined => {
    const { origin } = sessionService.getSession(tabId) || {}
    return permissionService.getWithoutUpdate(origin!)
  }
  setSite = (data: ConnectedSite) => {
    permissionService.setSite(data)
    if (data.isConnected) {
      const network = this.getLegacyNetworkName()
      sessionService.broadcastEvent(
        SESSION_EVENTS.networkChanged,
        {
          network,
        },
        data.origin
      )
    }
  }
  updateConnectSite = (origin: string, data: ConnectedSite) => {
    permissionService.updateConnectSite(origin, data, true)
    const network = this.getLegacyNetworkName()
    sessionService.broadcastEvent(
      SESSION_EVENTS.networkChanged,
      {
        network,
      },
      data.origin
    )
  }

  removeConnectedSite = (origin: string) => {
    sessionService.broadcastEvent(SESSION_EVENTS.accountsChanged, [], origin)
    permissionService.removeConnectedSite(origin)
  }

  setKeyringAlianName = (keyring: WalletKeyring, name: string) => {
    preferenceService.setKeyringAlianName(keyring.key, name)
    const newKeyring = Object.assign({}, keyring, { alianName: name })
    return newKeyring
  }

  setAccountAlianName = (account: Account, name: string) => {
    preferenceService.setAccountAlianName(account.key, name)
    account.alianName = name
    return account
  }

  addAddressFlag = (account: Account, flag: AddressFlagType) => {
    account.flag = preferenceService.addAddressFlag(account.address, flag)
    walletApiService.setClientAddress(account.address)
    return account
  }
  removeAddressFlag = (account: Account, flag: AddressFlagType) => {
    account.flag = preferenceService.removeAddressFlag(account.address, flag)
    walletApiService.setClientAddress(account.address)
    return account
  }

  getFeeSummary = async () => {
    return walletApiService.bitcoin.getFeeSummary()
  }

  getLowFeeSummary = async () => {
    return walletApiService.bitcoin.getLowFeeSummary()
  }

  getCoinPrice = async () => {
    return walletApiService.market.getCoinPrice()
  }

  getBrc20sPrice = async (ticks: string[]) => {
    return walletApiService.market.getBrc20sPrice(ticks)
  }

  getRunesPrice = async (ticks: string[]) => {
    return walletApiService.market.getRunesPrice(ticks)
  }

  getCAT20sPrice = async (tokenIds: string[]) => {
    return walletApiService.market.getCAT20sPrice(tokenIds)
  }

  getAlkanesPrice = async (alkaneids: string[]) => {
    return walletApiService.market.getAlkanesPrice(alkaneids)
  }

  inscribeBRC20Transfer = (
    address: string,
    tick: string,
    amount: string,
    feeRate: number,
    outputValue: number
  ) => {
    amount = paramsUtils.formatAmount(amount)

    return walletApiService.brc20.inscribeBRC20Transfer(address, tick, amount, feeRate, outputValue)
  }

  getInscribeResult = (orderId: string) => {
    return walletApiService.brc20.getInscribeResult(orderId)
  }

  decodePsbt = (psbtHex: string, website: string) => {
    return walletApiService.bitcoin.decodePsbt(psbtHex, website)
  }

  analyzeLocalPsbts = async (toSignDatas: ToSignData[]): Promise<LocalPsbtSummary> => {
    const networkType = this.getNetworkType()
    let totalFee = 0
    let totalInput = 0
    let completedCount = 0
    let hasSighashNone = false
    let parseErrorCount = 0
    const items: LocalPsbtSummary['items'] = []

    // Fetch network fee rates once for all PSBTs
    let feeRateThresholds: txHelpers.FeeRateThresholds | undefined
    try {
      const feeSummary = await walletApiService.bitcoin.getFeeSummary()
      const rates = feeSummary.list.map(f => f.feeRate)
      if (rates.length >= 3) {
        const mid = rates[1]!
        const [low, , high] = rates as [number, number, number]
        feeRateThresholds = {
          tooLow: Math.max(1, low - 2),
          tooHigh: high + 50,
          recommended: mid,
        }
      }
    } catch (e) {
      log.warn('Failed to fetch fee summary for local PSBT analysis:', e)
    }

    // Phase 1: local decode — no network, collect outpoints + per-PSBT info
    const outpointSet = new Set<string>()
    for (const toSignData of toSignDatas) {
      try {
        const decoder = new txHelpers.PsbtDecoder({
          toSignData,
          networkType,
          ...(feeRateThresholds !== undefined ? { feeRateThresholds } : {}),
        })
        const result = await decoder.decode()

        const itemHasSighashNone = result.risks.some(r => r.type === RiskType.SIGHASH_NONE)
        if (itemHasSighashNone) hasSighashNone = true

        const itemTotalInput = result.inputInfos.reduce((sum, v) => sum + v.value, 0)
        if (result.isCompleted) {
          totalFee += result.fee
          totalInput += itemTotalInput
          completedCount++
        }
        for (const input of result.inputInfos) {
          outpointSet.add(`${input.txid}:${input.vout}`)
        }

        items.push({
          inputCount: result.inputInfos.length,
          outputCount: result.outputInfos.length,
          feeRate: result.feeRate,
          fee: result.fee,
          totalInput: itemTotalInput,
          isCompleted: result.isCompleted,
          hasSighashNone: itemHasSighashNone,
          parseError: false,
        })
      } catch (e) {
        log.error('Local PSBT analysis failed:', e)
        parseErrorCount++
        items.push({
          inputCount: 0,
          outputCount: 0,
          feeRate: '-',
          fee: 0,
          totalInput: 0,
          isCompleted: false,
          hasSighashNone: false,
          parseError: true,
        })
      }
    }

    // Phase 2: one batch API call to check asset coverage on inputs
    let hasAssets = false
    if (outpointSet.size > 0) {
      try {
        const utxoAssets = await walletApiService.bitcoin.getUtxoAssetsByOutpoints(
          Array.from(outpointSet)
        )
        hasAssets = utxoAssets.some(
          u => u.inscriptions.length > 0 || u.runes.length > 0 || u.alkanes.length > 0
        )
      } catch (e) {
        log.warn('Failed to fetch UTXO assets for PSBT analysis:', e)
      }
    }

    return {
      totalFee,
      totalInput,
      completedCount,
      hasSighashNone,
      parseErrorCount,
      hasAssets,
      items,
    }
  }

  decodeContracts = (contracts: any[], account) => {
    return walletApiService.bitcoin.decodeContracts(contracts, account)
  }

  getBRC20List = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize

    const { total, list } = await walletApiService.brc20.getBRC20List(address, cursor, size)

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAllInscriptionList = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize

    const { total, list } = await walletApiService.inscriptions.getAddressInscriptions(
      address,
      cursor,
      size
    )
    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getBRC20Summary = async (address: string, ticker: string) => {
    const tokenSummary = await walletApiService.brc20.getAddressTokenSummary(address, ticker)
    return tokenSummary
  }

  getBRC20TransferableList = async (
    address: string,
    ticker: string,
    currentPage: number,
    pageSize: number
  ) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize

    const { total, list } = await walletApiService.brc20.getTokenTransferableList(
      address,
      ticker,
      cursor,
      size
    )

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  expireUICachedData = async (address: string) => {
    return preferenceService.expireUICachedData(address)
  }

  getWalletConfig = async () => {
    return walletApiService.config.getWalletConfig()
  }

  getSkippedVersion = async () => {
    return preferenceService.getSkippedVersion()
  }

  setSkippedVersion = async (version: string) => {
    return preferenceService.setSkippedVersion(version)
  }

  getInscriptionUtxoDetail = async (inscriptionId: string) => {
    const utxo = await walletApiService.inscriptions.getInscriptionUtxoDetail(inscriptionId)
    if (!utxo) {
      throw new Error('UTXO not found.')
    }
    return utxo
  }

  getUtxoByInscriptionId = async (inscriptionId: string) => {
    const utxo = await walletApiService.inscriptions.getInscriptionUtxo(inscriptionId)
    if (!utxo) {
      throw new Error('UTXO not found.')
    }
    return utxo
  }

  getInscriptionInfo = async (inscriptionId: string) => {
    const utxo = await walletApiService.inscriptions.getInscriptionInfo(inscriptionId)
    if (!utxo) {
      throw new Error('Inscription not found.')
    }
    return utxo
  }

  /**
   * Check if a website is a known phishing site
   * @param website Website URL or origin to check
   * @returns Object containing check results with isScammer flag and optional warning message
   */
  checkWebsite = async (
    website: string
  ): Promise<{ isScammer: boolean; warning: string; allowQuickMultiSign?: boolean }> => {
    let isLocalPhishing = false

    // try {
    //   let hostname = ''
    //   try {
    //     hostname = new URL(website).hostname
    //   } catch (e) {
    //     hostname = website
    //   }

    //   const phishingService = await import('@/background/service/phishing')
    //   isLocalPhishing = phishingService.default.checkPhishing(hostname)
    // } catch (error) {
    //   console.error('[Phishing] Local check error:', error)
    // }

    const apiResult = await walletApiService.utility.checkWebsite(website)

    if (isLocalPhishing) {
      return {
        ...apiResult,
        isScammer: true,
      }
    }

    return apiResult
  }

  getOrdinalsInscriptions = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize

    const { total, list } = await walletApiService.inscriptions.getOrdinalsInscriptions(
      address,
      cursor,
      size
    )
    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAddressSummary = async (address: string) => {
    const data = await walletApiService.bitcoin.getAddressSummary(address)
    // preferenceService.updateAddressBalance(address, data);
    return data
  }

  setPsbtSignNonSegwitEnable(psbt: bitcoin.Psbt, enabled: boolean) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore
    psbt.__CACHE.__UNSAFE_SIGN_NONSEGWIT = enabled
  }

  getShowSafeNotice = () => {
    return preferenceService.getShowSafeNotice()
  }

  setShowSafeNotice = (show: boolean) => {
    return preferenceService.setShowSafeNotice(show)
  }

  getVersionDetail = (version: string) => {
    return walletApiService.config.getVersionDetail(version)
  }

  checkKeyringMethod = async (method: string) => {
    const account = await this.getCurrentAccount()
    if (!account) throw new Error('no current account')
    const keyring = await keyringService.getKeyringForAccount(account.pubkey)
    if (!keyring) {
      throw new Error('keyring does not exist')
    }
    if (!keyring[method]) {
      throw new Error(`keyring does not have ${method} method`)
    }
    return { account, keyring }
  }

  // Keystone related functions
  // genSignPsbtUr, parseSignPsbtUr, genSignMsgUr, parseSignMsgUr, getKeystoneConnectionType
  genSignPsbtUr = async (psbtHex: string) => {
    const { keyring } = await this.checkKeyringMethod('genSignPsbtUr')
    return await keyring.genSignPsbtUr!(psbtHex)
  }

  parseSignPsbtUr = async (type: string, cbor: string, isFinalize = true) => {
    const { keyring } = await this.checkKeyringMethod('parseSignPsbtUr')
    const psbtHex = await keyring.parseSignPsbtUr!(type, cbor)
    const psbt = bitcoin.Psbt.fromHex(psbtHex)
    try {
      isFinalize && psbt.finalizeAllInputs()
    } catch (e) {
      //skip
    }
    return {
      psbtHex: psbt.toHex(),
      rawtx: isFinalize ? psbt.extractTransaction().toHex() : undefined,
    }
  }

  genSignMsgUr = async (text: string, msgType?: string) => {
    if (msgType === 'bip322-simple') {
      const account = await this.getCurrentAccount()
      if (!account) throw new Error('no current account')
      const psbt = genPsbtOfBIP322Simple({
        message: text,
        address: account.address,
        networkType: this.getNetworkType(),
      })
      const toSignData = await this.getToSignData({ psbtHex: psbt.toHex() })
      return await this.genSignPsbtUr(toSignData.psbtHex)
    }
    const { account, keyring } = await this.checkKeyringMethod('genSignMsgUr')
    return await keyring.genSignMsgUr!(account.pubkey, text)
  }

  parseSignMsgUr = async (type: string, cbor: string, msgType: string) => {
    if (msgType === 'bip322-simple') {
      const res = await this.parseSignPsbtUr(type, cbor, false)
      const psbt = bitcoin.Psbt.fromHex(res.psbtHex)
      psbt.finalizeAllInputs()
      return {
        signature: getSignatureFromPsbtOfBIP322Simple(psbt),
      }
    }
    const { keyring } = await this.checkKeyringMethod('parseSignMsgUr')
    const sig = await keyring.parseSignMsgUr!(type, cbor)
    sig.signature = Buffer.from(sig.signature, 'hex').toString('base64')

    return sig
  }

  getKeystoneConnectionType = async () => {
    if (PlatformEnv.PLATFORM === 'extension') {
      // QR | USB
      const { keyring } = await this.checkKeyringMethod('getConnectionType')
      return keyring.getConnectionType!()
    } else {
      return 'QR'
    }
  }

  getEnableSignData = async () => {
    return preferenceService.getEnableSignData()
  }

  setEnableSignData = async (enable: boolean) => {
    return preferenceService.setEnableSignData(enable)
  }

  getRunesList = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize
    const { total, list } = await walletApiService.runes.getRunesList(address, cursor, size)

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAssetUtxosRunes = async (runeid: string) => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    const runes_utxos = await walletApiService.runes.getRunesUtxos(account.address, runeid)

    const assetUtxos = runes_utxos.map(v => {
      return Object.assign(v, { pubkey: account.pubkey })
    }) as any

    assetUtxos.forEach(v => {
      v.inscriptions = []
    })

    assetUtxos.sort((a, b) => {
      const bAmount = b.runes.find(v => v.runeid == runeid)?.amount || '0'
      const aAmount = a.runes.find(v => v.runeid == runeid)?.amount || '0'
      return bnUtils.compareAmount(bAmount, aAmount)
    })

    return assetUtxos
  }

  getAddressRunesTokenSummary = async (address: string, runeid: string) => {
    const tokenSummary = await walletApiService.runes.getAddressRunesTokenSummary(address, runeid)
    return tokenSummary
  }

  createSendRunesPsbt = async ({
    to,
    runeid,
    runeAmount,
    feeRate,
    btcUtxos,
    assetUtxos,
    outputValue,
  }: {
    to: string
    runeid: string
    runeAmount: string
    feeRate?: number
    btcUtxos?: UnspentOutput[]
    assetUtxos?: UnspentOutput[]
    outputValue?: number
  }): Promise<ToSignData> => {
    runeAmount = paramsUtils.formatAmount(runeAmount)
    if (runeAmount === '0') {
      throw new Error('Amount must be greater than 0')
    }

    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const networkType = this.getNetworkType()

    if (!assetUtxos) {
      assetUtxos = await this.getAssetUtxosRunes(runeid)
    }

    if (!feeRate) {
      const feeSummary = await this.getFeeSummary()
      feeRate = feeSummary.list[1]?.feeRate! // use normal fee rate
    }

    const _assetUtxos: UnspentOutput[] = []

    // find the utxo that has the exact amount to split
    for (let i = 0; i < assetUtxos!.length; i++) {
      const v = assetUtxos![i]!
      if (v.runes && v.runes.length > 1) {
        const balance = v.runes.find(r => r.runeid == runeid)
        if (balance && balance.amount == runeAmount) {
          _assetUtxos.push(v)
          break
        }
      }
    }

    if (_assetUtxos.length == 0) {
      for (let i = 0; i < assetUtxos!.length; i++) {
        const v = assetUtxos![i]!
        if (v.runes) {
          const balance = v.runes.find(r => r.runeid == runeid)
          if (balance && balance.amount == runeAmount) {
            _assetUtxos.push(v)
            break
          }
        }
      }
    }

    if (_assetUtxos.length == 0) {
      let total = BigInt(0)
      for (let i = 0; i < assetUtxos!.length; i++) {
        const v = assetUtxos![i]!
        v.runes?.forEach(r => {
          if (r.runeid == runeid) {
            total = total + BigInt(r.amount)
          }
        })
        _assetUtxos.push(v)
        if (total >= BigInt(runeAmount)) {
          break
        }
      }
    }

    assetUtxos = _assetUtxos

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos()
    }

    const { psbt, toSignInputs } = await txHelpers.sendRunes({
      assetUtxos,
      assetAddress: account.address,
      btcUtxos: btcUtxos!,
      btcAddress: account.address,
      toAddress: to,
      networkType,
      feeRate,
      runeid,
      runeAmount,
      outputValue: outputValue || UTXO_DUST,
    })

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
      action: {
        name: t('send_runes'),
        description: '',
        details: [
          {
            label: t('to'),
            type: PsbtActionDetailType.ADDRESS,
            value: to,
          },
          {
            label: t('runes'),
            type: PsbtActionDetailType.RUNES,
            value: {
              runeid,
              runeAmount,
            },
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  getToSignData = async ({
    psbtHex,
    options,
    action,
  }: {
    psbtHex: string
    options?: SignPsbtOptions
    action?: PsbtActionInfo
  }): Promise<ToSignData> => {
    const toSignInputs = await this.formatOptionsToSignInputs(psbtHex, options)
    const result = await this.formatPsbt(
      bitcoin.Psbt.fromHex(psbtHex),
      toSignInputs,
      options?.autoFinalized
    )
    return {
      psbtHex: result.psbt.toHex(),
      toSignInputs: result.toSignInputs,
      autoFinalized: result.autoFinalized,
      action: action
        ? action
        : {
            name: '',
            description: '',
            type: PsbtActionType.DEFAULT,
          },
    }
  }

  getSignedResult = async (psbt: bitcoin.Psbt, toSignInputs: ToSignInput[]) => {
    this.setPsbtSignNonSegwitEnable(psbt, true)
    await this._signPsbt(psbt, toSignInputs, true)
    this.setPsbtSignNonSegwitEnable(psbt, false)

    const psbtHex = psbt.toHex()
    let rawtx = ''
    let fee = 0
    try {
      rawtx = psbt.extractTransaction(true).toHex()
      fee = psbt.getFee()
    } catch (e) {
      // ignore
    }

    return {
      psbtHex,
      rawtx,
      fee,
    }
  }

  getAutoLockTimeId = async () => {
    return preferenceService.getAutoLockTimeId()
  }

  setAutoLockTimeId = async (timeId: number) => {
    preferenceService.setAutoLockTimeId(timeId)
    this._resetTimeout()
  }

  getOpenInSidePanel = async () => {
    return preferenceService.getOpenInSidePanel()
  }

  getDeveloperMode = async () => {
    return preferenceService.getDeveloperMode()
  }

  setDeveloperMode = async (developerMode: boolean) => {
    preferenceService.setDeveloperMode(developerMode)
  }

  setOpenInSidePanel = async (openInSidePanel: boolean) => {
    preferenceService.setOpenInSidePanel(openInSidePanel)

    try {
      const chromeWithSidePanel = chrome as any
      if (chromeWithSidePanel.sidePanel) {
        chromeWithSidePanel.sidePanel.setPanelBehavior({ openPanelOnActionClick: openInSidePanel })
      }
    } catch (error) {
      console.error('Failed to update side panel behavior:', error)
    }
  }

  setLastActiveTime = async () => {
    this._resetTimeout()
  }

  private _resetTimeout = () => {
    if (this.timer) {
      clearTimeout(this.timer)
    }

    const timeId = preferenceService.getAutoLockTimeId()
    const timeConfig = getLockTimeInfo(timeId)
    this.timer = setTimeout(() => {
      this.lockWallet()
      bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
        method: BUS_METHODS.AUTO_LOCKED,
        params: {},
      })
    }, timeConfig.time)
  }

  getCAT20List = async (
    version: CAT_VERSION,
    address: string,
    currentPage: number,
    pageSize: number
  ) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize
    const { total, list } = await walletApiService.cat.getCAT20List(version, address, cursor, size)

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAddressCAT20TokenSummary = async (version: CAT_VERSION, address: string, tokenId: string) => {
    const tokenSummary = await walletApiService.cat.getAddressCAT20TokenSummary(
      version,
      address,
      tokenId
    )
    return tokenSummary
  }

  getAddressCAT20UtxoSummary = async (version: CAT_VERSION, address: string, tokenId: string) => {
    const tokenSummary = await walletApiService.cat.getAddressCAT20UtxoSummary(
      version,
      address,
      tokenId
    )
    return tokenSummary
  }

  transferCAT20Step1ByMerge = async (version: CAT_VERSION, mergeId: string) => {
    return await walletApiService.cat.transferCAT20Step1ByMerge(version, mergeId)
  }

  transferCAT20Step1 = async (
    version: CAT_VERSION,
    to: string,
    tokenId: string,
    tokenAmount: string,
    feeRate: number
  ) => {
    tokenAmount = paramsUtils.formatAmount(tokenAmount)

    const currentAccount = await this.getCurrentAccount()
    if (!currentAccount) {
      return
    }

    const _res = await walletApiService.cat.transferCAT20Step1(
      version,
      currentAccount.address,
      currentAccount.pubkey,
      to,
      tokenId,
      tokenAmount,
      feeRate
    )

    const toSignData = await this.getToSignData({
      psbtHex: bitcoin.Psbt.fromBase64(_res.commitTx).toHex(),
      options: {
        toSignInputs: _res.toSignInputs,
        autoFinalized: false,
      },
      action: {
        name: t('send_cat20'),
        description: '',
        type: PsbtActionType.CUSTOM,
      },
    })

    return {
      toSignData,
      feeRate: _res.feeRate,
      id: _res.id,
    }
  }

  transferCAT20Step2 = async (version: CAT_VERSION, transferId: string, psbtHex: string) => {
    const psbt = psbtFromString(psbtHex)
    try {
      psbt.finalizeAllInputs()
    } catch (e) {
      // skip
    }
    const psbtBase64 = psbt.toBase64()
    const _res = await walletApiService.cat.transferCAT20Step2(version, transferId, psbtBase64)
    const toSignData = await this.getToSignData({
      psbtHex: bitcoin.Psbt.fromBase64(_res.revealTx).toHex(),
      options: {
        toSignInputs: _res.toSignInputs,
        autoFinalized: false,
      },
    })

    return {
      toSignData,
    }
  }

  transferCAT20Step3 = async (version: CAT_VERSION, transferId: string, psbtHex: string) => {
    const psbt = psbtFromString(psbtHex)
    const psbtBase64 = psbt.toBase64()
    const _res = await walletApiService.cat.transferCAT20Step3(version, transferId, psbtBase64)
    return {
      txid: _res.txid,
    }
  }

  mergeCAT20Prepare = async (
    version: CAT_VERSION,
    tokenId: string,
    utxoCount: number,
    feeRate: number
  ) => {
    const currentAccount = await this.getCurrentAccount()
    if (!currentAccount) {
      return
    }

    const _res = await walletApiService.cat.mergeCAT20Prepare(
      version,
      currentAccount.address,
      currentAccount.pubkey,
      tokenId,
      utxoCount,
      feeRate
    )
    return _res
  }

  getMergeCAT20Status = async (version: CAT_VERSION, mergeId: string) => {
    const _res = await walletApiService.cat.getMergeCAT20Status(version, mergeId)
    return _res
  }

  getAppList = async () => {
    const data = await walletApiService.utility.getAppList()
    return data
  }

  getBannerList = async () => {
    const data = await walletApiService.utility.getBannerList()
    return data
  }

  getBlockActiveInfo = () => {
    return walletApiService.utility.getBlockActiveInfo()
  }

  getCAT721List = async (
    version: CAT_VERSION,
    address: string,
    currentPage: number,
    pageSize: number
  ) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize
    const { total, list } = await walletApiService.cat.getCAT721CollectionList(
      version,
      address,
      cursor,
      size
    )

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAddressCAT721CollectionSummary = async (
    version: CAT_VERSION,
    address: string,
    collectionId: string
  ) => {
    const collectionSummary = await walletApiService.cat.getAddressCAT721CollectionSummary(
      version,
      address,
      collectionId
    )
    return collectionSummary
  }

  transferCAT721Step1 = async (
    version: CAT_VERSION,
    to: string,
    collectionId: string,
    localId: string,
    feeRate: number
  ) => {
    const currentAccount = await this.getCurrentAccount()
    if (!currentAccount) {
      return
    }

    const _res = await walletApiService.cat.transferCAT721Step1(
      version,
      currentAccount.address,
      currentAccount.pubkey,
      to,
      collectionId,
      localId,
      feeRate
    )

    const toSignData = await this.getToSignData({
      psbtHex: bitcoin.Psbt.fromBase64(_res.commitTx).toHex(),
      options: {
        toSignInputs: _res.toSignInputs,
        autoFinalized: false,
      },
      action: {
        name: t('send_CAT721'),
        description: '',
        details: [],
        type: PsbtActionType.CUSTOM,
      },
    })

    return {
      toSignData,
      feeRate: _res.feeRate,
      id: _res.id,
    }
  }

  transferCAT721Step2 = async (version: CAT_VERSION, transferId: string, psbtHex: string) => {
    const psbt = psbtFromString(psbtHex)
    try {
      psbt.finalizeAllInputs()
    } catch (e) {
      // skip
    }
    const psbtBase64 = psbt.toBase64()
    const _res = await walletApiService.cat.transferCAT721Step2(version, transferId, psbtBase64)
    const toSignData = await this.getToSignData({
      psbtHex: bitcoin.Psbt.fromBase64(_res.revealTx).toHex(),
      options: {
        toSignInputs: _res.toSignInputs,
        autoFinalized: false,
      },
    })

    return {
      toSignData,
    }
  }

  transferCAT721Step3 = async (version: CAT_VERSION, transferId: string, psbtHex: string) => {
    const psbt = psbtFromString(psbtHex)
    const psbtBase64 = psbt.toBase64()
    const _res = await walletApiService.cat.transferCAT721Step3(version, transferId, psbtBase64)
    return {
      txid: _res.txid,
    }
  }

  getBuyCoinChannelList = async (coin: 'FB' | 'BTC') => {
    return walletApiService.utility.getBuyCoinChannelList(coin)
  }

  createBuyCoinPaymentUrl = (coin: 'FB' | 'BTC', address: string, channel: string) => {
    return walletApiService.utility.createBuyCoinPaymentUrl(coin, address, channel)
  }

  //  ----------- lamport support --------

  getLamportPublicKey = async (context: string) => {
    const account = await this.getCurrentAccount()
    if (!account) throw new Error('No current account')
    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring?.getLamportPublicKey) {
      throw new Error('Current keyring does not support Lamport signatures')
    }
    return keyring.getLamportPublicKey(context)
  }

  signWithLamport = async (context: string, proofBits: number[]) => {
    const account = await this.getCurrentAccount()
    if (!account) throw new Error('No current account')
    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring?.signWithLamport) {
      throw new Error('Current keyring does not support Lamport signatures')
    }
    return keyring.signWithLamport(context, proofBits)
  }

  //  ----------- cosmos support --------

  getCosmosKeyring = async (chainId: string) => {
    if (!this.cosmosChainInfoMap[chainId]) {
      throw new Error('Not supported chainId')
    }

    const currentAccount = await this.getCurrentAccount()
    if (!currentAccount) return null

    const key = `${currentAccount.pubkey}-${currentAccount.type}-${chainId}`

    if (key === this._cacheCosmosKeyringKey) {
      return this._cosmosKeyring
    }

    const keyring = await keyringService.getKeyringForAccount(
      currentAccount.pubkey,
      currentAccount.type
    )
    if (!keyring) return null

    let cosmosKeyring: CosmosKeyring | null = null
    const name = `${currentAccount.alianName}-${chainId}`
    let privateKey

    if (currentAccount.type !== KeyringType.KeystoneKeyring) {
      privateKey = await keyring.exportAccount(currentAccount.pubkey)
    }

    cosmosKeyring = await CosmosKeyring.createCosmosKeyring({
      privateKey,
      publicKey: currentAccount.pubkey,
      name,
      chainId,
      provider: this,
    })

    this._cacheCosmosKeyringKey = key
    this._cosmosKeyring = cosmosKeyring
    return cosmosKeyring
  }

  getBabylonAddress = async (chainId: string) => {
    const cosmosKeyring = await this.getCosmosKeyring(chainId)
    if (!cosmosKeyring) return null
    const address = cosmosKeyring.getKey().bech32Address
    return address
  }

  getBabylonAddressSummary = async (babylonChainId: string, babylonConfig: BabylonConfigV2) => {
    const chainType = this.getChainType()
    const chain = CHAINS_MAP[chainType]

    const cosmosKeyring = await this.getCosmosKeyring(babylonChainId)
    if (!cosmosKeyring) return null
    const address = cosmosKeyring.getKey().bech32Address
    let balance: CosmosBalance = {
      amount: '0',
      denom: 'ubbn',
    }
    let rewardBalance = 0
    try {
      balance = await cosmosKeyring.getBalance()
      if (babylonConfig) {
        rewardBalance = await cosmosKeyring.getBabylonStakingRewards()
      }
    } catch (e) {
      console.error('getBabylonAddressSummary:getBalance error:', e)
    }

    let stakedBalance = 0
    if (babylonConfig) {
      try {
        const currentAccount = await this.getCurrentAccount()
        if (!currentAccount) return null
        const pubkey = toXOnly(Buffer.from(currentAccount.pubkey, 'hex')).toString('hex')
        let pagination_key = ''

        do {
          const response = await getDelegationsV2(
            babylonConfig.phase2.stakingApi || '',
            pubkey,
            pagination_key
          )
          stakedBalance += response.delegations
            .filter(v => v.state === DelegationV2StakingState.ACTIVE)
            .reduce((pre, cur) => pre + cur.stakingAmount, 0)
          if (response.pagination.next_key) {
            pagination_key = response.pagination.next_key
          }
        } while (pagination_key)
      } catch (e) {
        console.error('getBabylonAddressSummary:getDelegationsV2 error:', e)
      }
    }

    return { address, balance, rewardBalance, stakedBalance }
  }

  genSignCosmosUr = async (cosmosSignRequest: {
    requestId?: string
    signData: string
    dataType: CosmosSignDataType
    path: string
    chainId?: string
    accountNumber?: string
    address?: string
  }) => {
    if (!cosmosSignRequest.signData) {
      throw new Error('signData is required for Cosmos signing')
    }

    if (!cosmosSignRequest.dataType) {
      throw new Error('dataType is required for Cosmos signing')
    }

    if (!cosmosSignRequest.path) {
      throw new Error('path is required for Cosmos signing')
    }

    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error(t('no_current_account'))

    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring.genSignCosmosUr) {
      throw new Error(t('current_keyring_does_not_support_gensigncosmosur'))
    }

    const { requestId, signData, dataType, path, chainId, accountNumber, address } =
      cosmosSignRequest

    const signRequest = {
      requestId,
      signData,
      dataType,
      path,
      extra: {
        chainId,
        accountNumber,
        address,
      },
    }

    const result = await keyring.genSignCosmosUr(signRequest as any)
    return result
  }

  parseCosmosSignUr = async (type: string, cbor: string) => {
    if (!type) {
      throw new Error('UR type is required for parsing Cosmos signature')
    }

    if (!cbor) {
      throw new Error('CBOR data is required for parsing Cosmos signature')
    }

    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring.parseSignCosmosUr) {
      throw new Error(t('current_keyring_does_not_support_parsesigncosmosur'))
    }
    return await keyring.parseSignCosmosUr(type, cbor)
  }

  cosmosSignData = async (chainId: string, signBytesHex: string) => {
    const keyring = await this.getCosmosKeyring(chainId)
    if (!keyring) return null
    const result = await keyring.cosmosSignData(signBytesHex)
    return result
  }

  createSendTokenStep1 = async (
    chainId: string,
    tokenBalance: CosmosBalance,
    recipient: string,
    memo: string,
    {
      gasLimit,
      gasPrice,
      gasAdjustment,
    }: {
      gasLimit: number
      gasPrice: string
      gasAdjustment: number
    }
  ) => {
    const keyring = await this.getCosmosKeyring(chainId)
    if (!keyring) return null
    const result = await keyring.createSendTokenStep1(tokenBalance, recipient, memo, {
      gasLimit,
      gasPrice,
      gasAdjustment,
    })
    return result
  }

  createSendTokenStep2 = async (chainId: string, signature: string) => {
    const keyring = await this.getCosmosKeyring(chainId)
    if (!keyring) return null
    const result = await keyring.createSendTokenStep2(signature)
    return result
  }

  /**
   * Simulate the gas for the send tokens transaction
   * @param chainId
   * @param tokenBalance
   * @param recipient
   * @param memo
   * @returns
   */
  simulateBabylonGas = async (
    chainId: string,
    recipient: string,
    amount: { denom: string; amount: string },
    memo: string
  ) => {
    const keyring = await this.getCosmosKeyring(chainId)
    if (!keyring) return null
    const result = await keyring.simulateBabylonGas(recipient, amount, memo)
    return result
  }

  getBabylonConfig = async () => {
    return walletApiService.config.getBabylonConfig()
  }

  singleStepTransferBRC20Step1 = async (params: {
    userAddress: string
    userPubkey: string
    receiver: string
    ticker: string
    amount: string
    feeRate: number
  }) => {
    params.amount = paramsUtils.formatAmount(params.amount)

    const result = await walletApiService.brc20.singleStepTransferBRC20Step1(params)
    const toSignData = await this.getToSignData({
      psbtHex: result.psbtHex,
      options: {
        toSignInputs: result.toSignInputs as any,
        autoFinalized: true,
      },
    })
    return {
      orderId: result.orderId,
      toSignData,
    }
  }

  singleStepTransferBRC20Step2 = async (params: { orderId: string; commitTx: string }) => {
    const networkType = this.getNetworkType()
    const psbtNetwork = toPsbtNetwork(networkType)
    const psbt = bitcoin.Psbt.fromHex(params.commitTx, { network: psbtNetwork })

    const result = await walletApiService.brc20.singleStepTransferBRC20Step2({
      orderId: params.orderId,
      psbt: psbt.toBase64(),
    })

    const toSignData = await this.getToSignData({
      psbtHex: result.psbtHex,
      options: {
        toSignInputs: result.toSignInputs as any,
        autoFinalized: false,
      },
    })
    return {
      toSignData,
    }
  }

  singleStepTransferBRC20Step3 = async (params: { orderId: string; revealTx: string }) => {
    const networkType = this.getNetworkType()
    const psbtNetwork = toPsbtNetwork(networkType)
    const psbt = bitcoin.Psbt.fromHex(params.revealTx, { network: psbtNetwork })

    const result = await walletApiService.brc20.singleStepTransferBRC20Step3({
      orderId: params.orderId,
      psbt: psbt.toBase64(),
    })

    return result
  }

  createSendBTCOffsetPsbt = async (
    tos: { address: string; satoshis: number }[],
    feeRate: number
  ): Promise<ToSignData> => {
    const currentAccount = await this.getCurrentAccount()
    if (!currentAccount) throw new Error('no current account')

    const { psbtBase64, toSignInputs } =
      await walletApiService.bitcoin.createSendCoinBypassHeadOffsets(
        currentAccount.address,
        currentAccount.pubkey,
        tos,
        feeRate
      )

    const psbt = bitcoin.Psbt.fromBase64(psbtBase64)

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
    })

    const estimatedFee = getEstimateFee(psbt, currentAccount.address, currentAccount.pubkey)
    toSignData.estimatedFee = estimatedFee

    return toSignData
  }

  getAlkanesList = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize
    const { total, list } = await walletApiService.alkanes.getAlkanesList(address, cursor, size)

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAssetUtxosAlkanes = async (alkaneid: string) => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    const runes_utxos = await walletApiService.alkanes.getAlkanesUtxos(account.address, alkaneid)

    const assetUtxos = runes_utxos.map(v => {
      return Object.assign(v, { pubkey: account.pubkey })
    })

    assetUtxos.forEach(v => {
      v.inscriptions = []
    })

    return assetUtxos
  }

  getAddressAlkanesTokenSummary = async (
    address: string,
    runeid: string,
    fetchAvailable: boolean
  ) => {
    const tokenSummary = await walletApiService.alkanes.getAddressAlkanesTokenSummary(
      address,
      runeid,
      fetchAvailable
    )
    return tokenSummary
  }

  createSendAlkanesPsbt = async ({
    to,
    alkaneid,
    amount,
    feeRate,
    type,
  }: {
    to: string
    alkaneid: string
    amount: string
    feeRate: number
    type: 'ft' | 'nft'
  }): Promise<ToSignData> => {
    amount = paramsUtils.formatAmount(amount)

    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const txData = await walletApiService.alkanes.createAlkanesSendTx({
      userAddress: account.address,
      userPubkey: account.pubkey,
      receiver: to,
      alkaneid,
      amount,
      feeRate,
    })

    const toSignData = await this.getToSignData({
      psbtHex: txData.psbtHex,
      options: {
        toSignInputs: txData.toSignInputs,
        autoFinalized: false,
      },
      action: {
        name: t('send_alkanes'),
        description: '',
        details: [
          {
            label: t('to'),
            value: to,
            type: PsbtActionDetailType.ADDRESS,
          },
          {
            label: t('alkanes'),
            value: {
              alkaneid,
              amount,
              type,
            },
            type: PsbtActionDetailType.ALKANES,
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  getAlkanesCollectionList = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize
    const { total, list } = await walletApiService.alkanes.getAlkanesCollectionList(
      address,
      cursor,
      size
    )

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAlkanesCollectionItems = async (
    address: string,
    collectionId: string,
    currentPage: number,
    pageSize: number
  ) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize
    const { total, list } = await walletApiService.alkanes.getAlkanesCollectionItems(
      address,
      collectionId,
      cursor,
      size
    )

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getBRC20RecentHistory(address: string, ticker: string): Promise<BRC20HistoryItem[]> {
    return walletApiService.brc20.getBRC20RecentHistory(address, ticker)
  }

  getBRC20ProgList = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize
    const { total, list } = await walletApiService.brc20.getBRC20ProgList(address, cursor, size)

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  // Rate Us Status
  getRateUsStatus = (): RateUsStatus => {
    return preferenceService.getRateUsStatus()
  }

  setHasRated = (hasRated: boolean) => {
    return preferenceService.setHasRated(hasRated)
  }

  setRatePromptDismissedAt = (timestamp: number | null) => {
    return preferenceService.setRatePromptDismissedAt(timestamp)
  }

  setHasShownSecondPrompt = (hasShown: boolean) => {
    return preferenceService.setHasShownSecondPrompt(hasShown)
  }

  resetRateUsStatus = async () => {
    return preferenceService.resetRateUsStatus()
  }

  getGuideReaded = async () => {
    return preferenceService.getGuideReaded()
  }

  setGuideReaded = async () => {
    preferenceService.setGuideReaded(true)
  }

  getAnnouncements = async (cursor: number, size: number) => {
    return walletApiService.utility.getAnnouncements(cursor, size)
  }

  // get the notifications
  getNotifications = async () => {
    return notificationService.getNotifications()
  }

  // mark the notification as read
  readNotification = async (id: string) => {
    return notificationService.markAsRead(id)
  }

  // mark all notifications as read
  readAllNotifications = async () => {
    return notificationService.readAll()
  }

  // delete the notification
  deleteNotification = async (id: string) => {
    return notificationService.deleteNotification(id)
  }

  getNotificationUnreadCount = (): number => {
    return notificationService.getUnreadCount()
  }

  getAcceptLowFeeMode = async () => {
    return preferenceService.getAcceptLowFeeMode()
  }

  setAcceptLowFeeMode = async (accept: boolean) => {
    preferenceService.setAcceptLowFeeMode(accept)
  }

  createTmpKeyringWithPublicKey = async (publicKey: string, addressType: AddressType) => {
    const originKeyring = keyringService.createTmpKeyring(KeyringType.ReadonlyKeyring, [publicKey])
    const displayedKeyring = await keyringService.displayForKeyring(originKeyring, addressType, -1)
    preferenceService.setShowSafeNotice(true)
    return this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
  }

  createKeyringWithPublicKey = async (
    data: string,
    addressType: AddressType,
    alianName?: string
  ) => {
    let originKeyring: Keyring

    try {
      originKeyring = await keyringService.importPublicKeyOnly(data, addressType as AddressType)
    } catch (e) {
      throw e
    }

    const displayedKeyring = await keyringService.displayForKeyring(
      originKeyring,
      addressType,
      keyringService.keyrings.length - 1
    )
    const keyring = this.displayedKeyringToWalletKeyring(
      displayedKeyring,
      keyringService.keyrings.length - 1
    )
    await this.changeKeyring(keyring)
  }

  createDummyPsbt = async ({
    txType,
  }: {
    txType: DummyTxType
  }): Promise<{
    psbtHex: string
    toSignInputs: ToSignInput[]
  }> => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const { psbt, toSignInputs } = txHelpers.createDummyTx({
      txType,
      address: account.address,
      pubkey: account.pubkey,
    })

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: false,
      },
    })
    return toSignData
  }

  getBTCUnit() {
    const chainType = this.getChainType()
    return CHAINS_MAP[chainType]!.unit
  }
}
export default new WalletController()
