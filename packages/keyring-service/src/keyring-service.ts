import { ObservableStore } from '@metamask/obs-store'
import * as bip39 from 'bip39'
import { EventEmitter } from 'events'

import { bitcoin } from '@unisat/wallet-bitcoin'
import { AddressType } from '@unisat/wallet-types'
import {
  ColdWalletKeyring,
  HdKeyring,
  KeystoneKeyring,
  ReadonlyKeyring,
  SimpleKeyring,
} from './keyrings'
import { EmptyKeyring } from './keyrings/empty-keyring'
import {
  ADDRESS_TYPES,
  DisplayedKeyring,
  Encryptor,
  Keyring,
  KeyringServiceConfig,
  KeyringType,
  MemStoreState,
  ToSignInput,
} from './types'

import { BUS_EVENTS, BUS_METHODS, WalletKeyring } from '@unisat/wallet-shared'
import { ProxyStorageAdapter } from '@unisat/wallet-storage'

const KEYRING_SDK_TYPES = {
  SimpleKeyring,
  HdKeyring,
  KeystoneKeyring,
  ColdWalletKeyring,
  ReadonlyKeyring,
}

/**
 * Simple Mutex Lock for managing concurrent operations
 * Ensures only one operation can proceed at a time
 */
class SimpleMutex {
  private queue: (() => void)[] = []
  private locked: boolean = false

  async lock<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.locked = true
        try {
          const result = await fn()
          resolve(result)
        } catch (error) {
          reject(error)
        } finally {
          this.locked = false
          const next = this.queue.shift()
          if (next) {
            next()
          }
        }
      }

      if (!this.locked) {
        execute()
      } else {
        this.queue.push(execute)
      }
    })
  }

  isLocked(): boolean {
    return this.locked
  }
}

class DisplayKeyring {
  accounts: string[] = []
  type = ''
  hdPath = ''

  constructor(keyring: Keyring) {
    this.accounts = keyring.accounts || []
    this.type = keyring.type
    this.hdPath = (keyring as any).hdPath
  }
}

interface StoreState {
  booted: string
  vault: string | null
  boostValue: string
}

/**
 * KeyringService - Core service for managing multiple keyrings (wallets)
 * Aligned with unisat-extension keyring implementation
 */
export class KeyringService extends EventEmitter {
  private storage: ProxyStorageAdapter = undefined as any
  private logger: any
  private encryptor: Encryptor = undefined as any
  private t: any
  private eventBus: any

  // Core state - aligned with unisat-extension
  public keyringTypes: any[] = []
  public store!: ObservableStore<StoreState>
  public memStore: ObservableStore<MemStoreState> = undefined as any
  public keyrings: Keyring[] = []
  public addressTypes: AddressType[] = []
  public password: string | null = null
  private unlockingMutex: SimpleMutex = new SimpleMutex()
  private passwordChangeMutex: SimpleMutex = new SimpleMutex()
  private cachedDisplayedKeyring: DisplayedKeyring[] | null = null
  private initialBoostValue: string = 'true'
  private storageKey: string = 'keyringState'
  private cachedKey: string = 'cached_pubkeys'
  private readonly MAX_CACHE_ITEMS: number = 20

  constructor() {
    super()
  }

  /**
   * Generate a secure boost value for password verification
   * Uses a combination of timestamp and random string for better security
   */
  private generateSecureBoostValue(): string {
    const timestamp = Date.now().toString()
    const random = Math.random().toString(36).substring(2, 15)
    return `secure_${timestamp}_${random}`
  }

  /**
   * Upgrade boost value from initial 'true' to a more secure value
   * This enhances security by replacing the simple initial value
   */
  private upgradeBoostValueIfNeeded = async (): Promise<boolean> => {
    if (!this.password) {
      throw new Error(this.t('password_not_set'))
    }

    let boostValue = this.getBoostValue()
    // Only upgrade if still using the initial simple value
    if (boostValue === this.initialBoostValue) {
      try {
        // Generate new secure boost value
        const newBoostValue = this.generateSecureBoostValue()

        // Re-encrypt with the new boost value
        const upgradedEncryptBooted = await this.encryptor.encrypt(this.password, newBoostValue)

        // Persist the upgraded value
        this.store.updateState({ booted: upgradedEncryptBooted, boostValue: newBoostValue })

        this.logger.info('[KeyringService] Boost value upgraded to secure version')
        return true
      } catch (error) {
        this.logger.error('[KeyringService] Failed to upgrade boost value:', error)
        // Fallback: keep using the old value if upgrade fails
        throw new Error(this.t('boost_value_upgrade_failed'))
      }
    }

    return false
  }

  /**
   * Initialize the service - must be called before use
   */
  async init(config: KeyringServiceConfig): Promise<void> {
    if (config.storage) {
      this.storage = config.storage
    }

    if (config.logger) {
      this.logger = config.logger
    }

    if (config.t) {
      this.t = config.t
    }

    if (config.eventBus) {
      this.eventBus = config.eventBus
    }

    if (config.encryptor) {
      this.encryptor = config.encryptor
    }

    if (config.boostValue) {
      this.initialBoostValue = config.boostValue
    }

    // Initialize supported keyring types
    this.keyringTypes = Object.values(KEYRING_SDK_TYPES)

    // Initialize memory store - aligned with unisat-extension
    this.memStore = new ObservableStore<MemStoreState>({
      isUnlocked: false,
      keyringTypes: this.keyringTypes.map(krt => krt.type || krt.name),
      keyrings: [],
      preMnemonics: '',
      addressTypes: [],
      keystone: null,
    })

    this.keyrings = []
    this.addressTypes = []
    this.cachedDisplayedKeyring = null
    this.password = null

    this.logger.debug('[KeyringService] Initialized')

    const keyringState = await this.storage.get(this.storageKey)
    this.loadStore(keyringState)
    this.store.subscribe(value => this.storage.set(this.storageKey, value))
  }

  // reset total keyrings
  resetAllData = async () => {
    // Clear persistent storage
    await this.storage.set(this.storageKey, {
      booted: '',
      vault: null,
      boostValue: this.initialBoostValue,
    })

    await this.storage.set(this.cachedKey, null)

    // Reset stores
    this.store.updateState({
      booted: '',
      boostValue: this.initialBoostValue,
      vault: null,
    })

    this.memStore.updateState({
      isUnlocked: false,
      keyrings: [],
      preMnemonics: '',
      addressTypes: [],
    })

    this.keyrings = []
    this.addressTypes = []
    this.cachedDisplayedKeyring = null
    this.password = null
  }

  loadStore = (initState: StoreState) => {
    this.store = new ObservableStore(initState)
  }

  boot = async (password: string) => {
    this.password = password
    const boostValue = this.generateSecureBoostValue()
    const encryptBooted = await this.encryptor.encrypt(password, boostValue)

    // Update both in-memory and persistent storage
    this.store.updateState({ booted: encryptBooted, boostValue })
    this.memStore.updateState({ isUnlocked: true })

    // Upgrade boost value on first boot (when initial value is still 'true')
    await this.upgradeBoostValueIfNeeded()

    this.setUnlocked()
    this.fullUpdate()
  }

  isBooted = () => {
    return !!this.store.getState().booted
  }

  hasVault = () => {
    return !!this.store.getState().vault
  }

  /**
   * Get current memory store state
   */
  getMemStore(): MemStoreState {
    return this.memStore.getState()
  }

  /**
   * Full Update
   *
   * Emits the `update` event and @returns a Promise that resolves to
   * the current state.
   *
   * Frequently used to end asynchronous chains in this class,
   * indicating consumers can often either listen for updates,
   * or accept a state-resolving promise to consume their results.
   *
   * @returns {Object} The controller state.
   */
  fullUpdate = (): MemStoreState => {
    this.emit('update', this.memStore.getState())
    return this.memStore.getState()
  }

  /**
   * Import Keychain using Private key
   *
   * @emits KeyringController#unlock
   * @param  privateKey - The privateKey to generate address
   * @returns  A Promise that resolves to the state.
   */
  importPrivateKey = async (privateKey: string, addressType: AddressType) => {
    // await this.persistAllKeyrings();
    const keyring = await this.addNewKeyring('Simple Key Pair', [privateKey], addressType)
    // await this.persistAllKeyrings();
    this.setUnlocked()
    this.fullUpdate()
    return keyring
  }

  importPublicKeyOnly = async (pubkey: string, addressType: AddressType) => {
    // await this.persistAllKeyrings()
    const keyring = await this.addNewKeyring('Readonly', [pubkey], addressType)
    // await this.persistAllKeyrings()
    this.setUnlocked()
    this.fullUpdate()
    return keyring
  }

  generateMnemonic = (): string => {
    return bip39.generateMnemonic(128)
  }

  generatePreMnemonic = async (): Promise<string> => {
    if (!this.password) {
      throw new Error(this.t('you_need_to_unlock_wallet_first'))
    }
    const mnemonic = this.generateMnemonic()

    const preMnemonics = await this.encryptor.encrypt(this.password, mnemonic)
    this.memStore.updateState({ preMnemonics })
    return mnemonic
  }

  getKeyringByType = (type: string) => {
    const keyring = this.keyrings.find(keyring => keyring.type === type)

    return keyring
  }

  removePreMnemonics = () => {
    this.memStore.updateState({ preMnemonics: '' })
  }

  getPreMnemonics = async (): Promise<any> => {
    if (!this.memStore.getState().preMnemonics) {
      return ''
    }

    if (!this.password) {
      throw new Error(this.t('you_need_to_unlock_wallet_first'))
    }

    return await this.encryptor.decrypt(this.password, this.memStore.getState().preMnemonics)
  }

  // Alias for compatibility
  getPreMnemonic = this.getPreMnemonics

  /**
   * CreateNewVaultAndRestore Mnenoic
   *
   * Destroys any old encrypted storage,
   * creates a new HD wallet from the given seed with 1 account.
   *
   * @emits KeyringController#unlock
   * @param  seed - The BIP44-compliant seed phrase.
   * @returns  A Promise that resolves to the state.
   */
  createKeyringWithMnemonics = async (
    seed: string,
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount: number
  ) => {
    if (accountCount < 1) {
      throw new Error(this.t('keyring_error_account_count'))
    }
    if (!bip39.validateMnemonic(seed)) {
      return Promise.reject(new Error(this.t('mnemonic_phrase_is_invalid')))
    }

    // await this.persistAllKeyrings();
    const activeIndexes: number[] = []
    for (let i = 0; i < accountCount; i++) {
      activeIndexes.push(i)
    }

    const keyring = await this.addNewKeyring(
      'HD Key Tree',
      {
        mnemonic: seed,
        activeIndexes,
        hdPath,
        passphrase,
      },
      addressType
    )
    const accounts = await keyring.getAccounts()
    if (!accounts[0]) {
      throw new Error(this.t('first_account_not_found'))
    }
    // this.persistAllKeyrings();
    this.setUnlocked()
    this.fullUpdate()
    return keyring
  }

  createKeyringWithKeystone = async (
    urType: string,
    urCbor: string,
    addressType: AddressType,
    hdPath: string,
    accountCount: number,
    connectionType: 'USB' | 'QR' = 'USB'
  ) => {
    if (accountCount < 1) {
      throw new Error(this.t('keyring_error_account_count'))
    }
    // await this.persistAllKeyrings();
    const tmpKeyring = new KeystoneKeyring()
    await tmpKeyring.initFromUR(urType, urCbor, connectionType)
    if (hdPath.length >= 13) {
      tmpKeyring.changeChangeAddressHdPath(hdPath)
      tmpKeyring.addAccounts(accountCount)
    } else {
      const typeConfig = ADDRESS_TYPES[addressType]
      tmpKeyring.changeHdPath(typeConfig ? typeConfig.hdPath : '')
      tmpKeyring.addAccounts(accountCount)
    }

    const opts = await tmpKeyring.serialize()
    const keyring = await this.addNewKeyring(KeyringType.KeystoneKeyring, opts, addressType)
    const accounts = await keyring.getAccounts()

    if (!accounts[0]) {
      throw new Error(this.t('keyringcontroller_first_account_not_found'))
    }
    this.setUnlocked()
    return keyring
  }

  addKeyring = async (keyring: Keyring, addressType: AddressType) => {
    const accounts = await keyring.getAccounts()
    await this.checkForDuplicate(keyring.type, accounts)

    this.keyrings.push(keyring)
    this.addressTypes.push(addressType)
    this.cachedDisplayedKeyring = null

    await this.persistAllKeyrings()
    await this._updateMemStoreKeyrings()
    await this.fullUpdate()

    return keyring
  }

  changeAddressType = async (keyringIndex: number, addressType: AddressType) => {
    const keyring: Keyring = this.keyrings[keyringIndex] as Keyring

    if (keyring.type === KeyringType.HdKeyring || keyring.type === KeyringType.KeystoneKeyring) {
      const hdPath = ADDRESS_TYPES[addressType]?.hdPath
      if ((keyring as any).hdPath !== hdPath && keyring.changeHdPath) {
        keyring.changeHdPath(hdPath || '')
      }
    }
    this.addressTypes[keyringIndex] = addressType
    this.cachedDisplayedKeyring = null

    await this.persistAllKeyrings()
    await this._updateMemStoreKeyrings()
    await this.fullUpdate()
    return keyring
  }

  /**
   * Set Locked
   * This method deallocates all secrets, and effectively locks MetaMask.
   *
   * @emits KeyringController#lock
   * @returns {Promise<Object>} A Promise that resolves to the state.
   */
  setLocked = async (): Promise<MemStoreState> => {
    // set locked
    this.password = null
    this.memStore.updateState({ isUnlocked: false })

    // remove keyrings
    this.keyrings = []
    this.addressTypes = []
    this.cachedDisplayedKeyring = null

    await this._updateMemStoreKeyrings()
    this.emit('lock')
    return this.fullUpdate()
  }

  /**
   * Submit Password
   *
   * Attempts to decrypt the current vault and load its keyrings
   * into memory.
   *
   * Temporarily also migrates any old-style vaults first, as well.
   * (Pre MetaMask 3.0.0)
   *
   * @emits KeyringController#unlock
   * @param {string} password - The keyring controller password.
   * @returns {Promise<Object>} A Promise that resolves to the state.
   */
  submitPassword = async (password: string): Promise<MemStoreState> => {
    return this.unlockingMutex.lock(async () => {
      const isValidPassword = await this.verifyPassword(password)
      if (!isValidPassword) {
        throw new Error(this.t('password_error'))
      }

      this.password = password

      if (this.hasVault()) {
        this.keyrings = await this.unlockKeyrings(password)
      }

      // Upgrade boost value if needed (on first unlock after initialization)
      await this.upgradeBoostValueIfNeeded()

      this.cachedDisplayedKeyring = null

      this.setUnlocked()
      return this.fullUpdate()
    })
  }

  changePassword = async (oldPassword: string, newPassword: string) => {
    return this.passwordChangeMutex
      .lock(async () => {
        const isValidPassword = await this.verifyPassword(oldPassword)
        if (!isValidPassword) {
          throw new Error(this.t('password_error'))
        }
        await this.unlockKeyrings(oldPassword)
        this.password = newPassword

        const boostValue = this.getBoostValue()
        // Re-encrypt with current boost value (upgraded if applicable)
        const encryptBooted = await this.encryptor.encrypt(newPassword, boostValue)
        this.store.updateState({ booted: encryptBooted, boostValue })

        if (this.memStore.getState().preMnemonics) {
          const mnemonic = await this.encryptor.decrypt(
            oldPassword,
            this.memStore.getState().preMnemonics
          )
          const preMnemonics = await this.encryptor.encrypt(newPassword, mnemonic)
          this.memStore.updateState({ preMnemonics })
        }

        await this.persistAllKeyrings()
        await this._updateMemStoreKeyrings()
        await this.fullUpdate()
      })
      .catch(e => {
        throw new Error(this.t('change_password_failed'))
      })
  }

  private getBoostValue = (): string => {
    return this.store.getState().boostValue || this.initialBoostValue
  }

  /**
   * Verify Password
   *
   * Attempts to decrypt the current vault with a given password
   * to verify its validity.
   *
   * Security: Only accepts upgraded boost values. Initial 'true' value
   * is rejected to prevent dictionary/collision attacks.
   *
   * @param {string} password
   */
  verifyPassword = async (password: string): Promise<boolean> => {
    const encryptedBooted = this.store.getState().booted
    if (!encryptedBooted) {
      throw new Error(this.t('cannot_unlock_without_a_previous_vault'))
    }
    try {
      const val = await this.encryptor.decrypt(password, encryptedBooted)
      // SECURITY: Only accept the current boost value
      // Reject initial 'true' value to prevent weak value attacks
      if (val === this.getBoostValue()) {
        return true
      }

      return false
    } catch {
      return false
    }
  }

  /**
   * Add New Keyring
   *
   * Adds a new Keyring of the given `type` to the vault
   * and the current decrypted Keyrings array.
   *
   * All Keyring classes implement a unique `type` string,
   * and this is used to retrieve them from the keyringTypes array.
   *
   * @param  type - The type of keyring to add.
   * @param  opts - The constructor options for the keyring.
   * @returns  The new keyring.
   */
  addNewKeyring = async (
    type: string,
    opts: unknown,
    addressType: AddressType
  ): Promise<Keyring> => {
    const Keyring = this.getKeyringClassForType(type)
    const keyring = new Keyring(opts)
    return await this.addKeyring(keyring, addressType)
  }

  createTmpKeyring = (type: string, opts: unknown) => {
    const Keyring = this.getKeyringClassForType(type)
    if (!Keyring) {
      throw new Error(`Unknown keyring type: ${type}`)
    }

    const keyring = new Keyring(opts)
    return keyring
  }

  /**
   * Checks for duplicate keypairs, using the the first account in the given
   * array. Rejects if a duplicate is found.
   *
   * Only supports 'Simple Key Pair'.
   *
   * @param {string} type - The key pair type to check for.
   * @param {Array<string>} newAccountArray - Array of new accounts.
   * @returns {Promise<Array<string>>} The account, if no duplicate is found.
   */
  checkForDuplicate = async (type: string, newAccountArray: string[]): Promise<string[]> => {
    const keyrings = this.getKeyringsByType(type)
    const _accounts = await Promise.all(keyrings.map(keyring => keyring.getAccounts()))

    const accounts: string[] = _accounts.reduce((m, n) => m.concat(n), [] as string[])

    const isIncluded = newAccountArray.some(account => {
      return accounts.find(key => key === account)
    })

    return isIncluded
      ? Promise.reject(new Error(this.t('wallet_existed')))
      : Promise.resolve(newAccountArray)
  }

  /**
   * Add New Account
   *
   * Calls the `addAccounts` method on the given keyring,
   * and then saves those changes.
   *
   * @param {Keyring} selectedKeyring - The currently selected keyring.
   * @returns {Promise<Object>} A Promise that resolves to the state.
   */
  addNewAccount = async (selectedKeyring: Keyring): Promise<string[]> => {
    const accounts = await selectedKeyring.addAccounts(1)
    this.cachedDisplayedKeyring = null

    accounts.forEach(hexAccount => {
      this.emit('newAccount', hexAccount)
    })
    await this.persistAllKeyrings()
    await this._updateMemStoreKeyrings()
    await this.fullUpdate()
    return accounts
  }

  /**
   * Export Account
   *
   * Requests the private key from the keyring controlling
   * the specified address.
   *
   * Returns a Promise that may resolve with the private key string.
   *
   * @param {string} address - The address of the account to export.
   * @returns {Promise<string>} The private key of the account.
   */
  exportAccount = async (address: string): Promise<string> => {
    const keyring = await this.getKeyringForAccount(address)
    const privkey = await keyring.exportAccount(address)
    return privkey
  }

  /**
   *
   * Remove Account
   *
   * Removes a specific account from a keyring
   * If the account is the last/only one then it also removes the keyring.
   *
   * @param {string} address - The address of the account to remove.
   * @returns {Promise<void>} A Promise that resolves if the operation was successful.
   */
  removeAccount = async (address: string, type: string, brand?: string): Promise<any> => {
    const keyring = await this.getKeyringForAccount(address, type)

    // Not all the keyrings support this, so we have to check
    if (typeof keyring.removeAccount != 'function') {
      throw new Error(
        `Keyring ${keyring.type} ${this.t('does_not_support_account_removal_operations')}`
      )
    }
    keyring.removeAccount(address)
    this.cachedDisplayedKeyring = null

    this.emit('removedAccount', address)
    await this.persistAllKeyrings()
    await this._updateMemStoreKeyrings()
    await this.fullUpdate()
  }

  removeKeyring = async (keyringIndex: number): Promise<any> => {
    delete this.keyrings[keyringIndex]
    this.keyrings[keyringIndex] = new EmptyKeyring()
    this.cachedDisplayedKeyring = null

    await this.persistAllKeyrings()
    await this._updateMemStoreKeyrings()
    await this.fullUpdate()
  }

  //
  // SIGNING METHODS
  //

  /**
   * Sign BTC Transaction
   *
   * Signs an BTC transaction object.
   *
   * @param btcTx - The transaction to sign.
   * @param fromAddress - The transaction 'from' address.
   * @returns  The signed transactio object.
   */
  signTransaction = (keyring: Keyring, psbt: bitcoin.Psbt, inputs: ToSignInput[]) => {
    return keyring.signTransaction(psbt, inputs)
  }

  /**
   * Sign Message
   *
   * Attempts to sign the provided message parameters.
   */
  signMessage = async (address: string, keyringType: string, data: string) => {
    const keyring = await this.getKeyringForAccount(address, keyringType)
    const sig = await keyring.signMessage(address, data)
    return sig
  }

  /**
   * Decrypt Message
   *
   * Attempts to verify the provided message parameters.
   */
  verifyMessage = async (address: string, data: string, sig: string) => {
    const keyring = await this.getKeyringForAccount(address)
    const result = await keyring.verifyMessage(address, data, sig)
    return result
  }

  /**
   * Sign Data
   *
   * Sign any content, but note that the content signed by this method is unreadable, so use it with caution.
   *
   */
  signData = async (address: string, data: string, type: string) => {
    const keyring = await this.getKeyringForAccount(address)
    const result = await keyring.signData(address, data, type)
    return result
  }

  //
  // PRIVATE METHODS
  //

  /**
   * Persist All Keyrings
   *
   * Iterates the current `keyrings` array,
   * serializes each one into a serialized array,
   * encrypts that array with the provided `password`,
   * and persists that encrypted string to storage.
   *
   * @param {string} password - The keyring controller password.
   * @returns {Promise<boolean>} Resolves to true once keyrings are persisted.
   */
  persistAllKeyrings = (): Promise<boolean> => {
    if (!this.password || typeof this.password !== 'string') {
      return Promise.reject(new Error(this.t('keyringcontroller_password_is_not_a_string')))
    }
    return Promise.all(
      this.keyrings.map((keyring, index) => {
        return Promise.all([keyring.type, keyring.serialize()]).then(serializedKeyringArray => {
          // Label the output values on each serialized Keyring:
          return {
            type: serializedKeyringArray[0],
            data: serializedKeyringArray[1],
            addressType: this.addressTypes[index],
          }
        })
      })
    )
      .then(serializedKeyrings => {
        return this.encryptor.encrypt(
          this.password as string,
          serializedKeyrings as unknown as Buffer
        )
      })
      .then(encryptedString => {
        this.store.updateState({ vault: encryptedString })
        return true
      })
  }

  /**
   * Unlock Keyrings
   *
   * Attempts to unlock the persisted encrypted storage,
   * initializing the persisted keyrings to RAM.
   *
   * @param {string} password - The keyring controller password.
   * @returns {Promise<Array<Keyring>>} The keyrings.
   */
  unlockKeyrings = async (password: string): Promise<any[]> => {
    const encryptedVault = this.store.getState().vault
    if (!encryptedVault) {
      throw new Error(this.t('cannot_unlock_without_a_previous_vault'))
    }

    await this.clearKeyrings()
    const vault = await this.encryptor.decrypt(password, encryptedVault)

    const arr = Array.from(vault)
    for (let i = 0; i < arr.length; i++) {
      const { keyring, addressType } = await this._restoreKeyring(arr[i])
      this.keyrings.push(keyring)
      this.addressTypes.push(addressType)
    }
    this.cachedDisplayedKeyring = null

    await this._updateMemStoreKeyrings()
    return this.keyrings
  }

  /**
   * Restore Keyring
   *
   * Attempts to initialize a new keyring from the provided serialized payload.
   * On success, updates the memStore keyrings and returns the resulting
   * keyring instance.
   *
   * @param {Object} serialized - The serialized keyring.
   * @returns {Promise<Keyring>} The deserialized keyring.
   */
  restoreKeyring = async (serialized: any) => {
    const { keyring } = await this._restoreKeyring(serialized)
    await this._updateMemStoreKeyrings()
    return keyring
  }

  /**
   * Restore Keyring Helper
   *
   * Attempts to initialize a new keyring from the provided serialized payload.
   * On success, returns the resulting keyring instance.
   *
   * @param {Object} serialized - The serialized keyring.
   * @returns {Promise<Keyring>} The deserialized keyring.
   */
  _restoreKeyring = async (
    serialized: any
  ): Promise<{ keyring: Keyring; addressType: AddressType }> => {
    const { type, data, addressType } = serialized
    if (type === KeyringType.Empty) {
      const keyring = new EmptyKeyring()
      return {
        keyring,
        addressType: addressType,
      }
    }

    const Keyring = this.getKeyringClassForType(type)
    if (!Keyring) {
      throw new Error(`Unknown keyring type: ${type}`)
    }
    const keyring = new Keyring()
    await keyring.deserialize(data)

    // getAccounts also validates the accounts for some keyrings
    await keyring.getAccounts()
    return {
      keyring,
      addressType: addressType,
    }
  }

  /**
   * Get Keyring Class For Type
   *
   * Searches the current `keyringTypes` array
   * for a Keyring class whose unique `type` property
   * matches the provided `type`,
   * returning it if it exists.
   *
   * @param {string} type - The type whose class to get.
   * @returns {Keyring|undefined} The class, if it exists.
   */
  getKeyringClassForType = (type: string) => {
    return this.keyringTypes.find(kr => kr.type === type)
  }

  /**
   * Get Keyrings by Type
   *
   * Gets all keyrings of the given type.
   *
   * @param {string} type - The keyring types to retrieve.
   * @returns {Array<Keyring>} The keyrings.
   */
  getKeyringsByType = (type: string): Keyring[] => {
    return this.keyrings.filter(keyring => keyring.type === type)
  }

  /**
   * Get Accounts
   *
   * Returns the public addresses of all current accounts
   * managed by all currently unlocked keyrings.
   *
   * @returns {Promise<Array<string>>} The array of accounts.
   */
  getAccounts = async (): Promise<string[]> => {
    const keyrings = this.keyrings || []
    let addrs: string[] = []
    for (let i = 0; i < keyrings.length; i++) {
      const keyring = keyrings[i]
      if (!keyring) {
        continue
      }
      const accounts = await keyring.getAccounts()
      addrs = addrs.concat(accounts)
    }
    return addrs
  }

  /**
   * Get Keyring For Account
   *
   * Returns the currently initialized keyring that manages
   * the specified `address` if one exists.
   *
   * @param {string} address - An account address.
   * @returns {Promise<Keyring>} The keyring of the account, if it exists.
   */
  getKeyringForAccount = async (
    address: string,
    type?: string,
    start?: number,
    end?: number,
    includeWatchKeyring = true
  ): Promise<Keyring> => {
    this.logger.debug(`KeyringController - getKeyringForAccount: ${address}`)
    const keyrings = type ? this.keyrings.filter(keyring => keyring.type === type) : this.keyrings
    for (let i = 0; i < keyrings.length; i++) {
      const keyring = keyrings[i]
      if (!keyring) {
        continue
      }
      const accounts = await keyring.getAccounts()
      if (accounts.includes(address)) {
        return keyring
      }
    }
    throw new Error(this.t('no_keyring_found_for_the_requested_account'))
  }

  /**
   * Display For Keyring
   *
   * Is used for adding the current keyrings to the state object.
   * @param {Keyring} keyring
   * @returns {Promise<Object>} A keyring display object, with type and accounts properties.
   */
  displayForKeyring = async (
    keyring: Keyring,
    addressType: AddressType,
    index: number
  ): Promise<DisplayedKeyring> => {
    const accounts = await keyring.getAccounts()
    const all_accounts: { pubkey: string; brandName: string }[] = []
    for (let i = 0; i < accounts.length; i++) {
      const pubkey = accounts[i]
      if (!pubkey) continue
      all_accounts.push({
        pubkey,
        brandName: keyring.type,
      })
    }
    return {
      type: keyring.type,
      accounts: all_accounts,
      keyring: new DisplayKeyring(keyring),
      addressType,
      index,
    }
  }

  getAllDisplayedKeyrings = async (resetCache?: boolean): Promise<DisplayedKeyring[]> => {
    if (resetCache || !this.cachedDisplayedKeyring) {
      this.cachedDisplayedKeyring = await Promise.all(
        this.keyrings.map((keyring, index) =>
          this.displayForKeyring(keyring, this.addressTypes[index]!, index)
        )
      )
    }
    return this.cachedDisplayedKeyring
  }

  getAllVisibleAccountsArray = async () => {
    const typedAccounts = await this.getAllDisplayedKeyrings()
    const result: { pubkey: string; type: string; brandName: string }[] = []
    typedAccounts.forEach(accountGroup => {
      result.push(
        ...accountGroup.accounts.map(account => ({
          pubkey: account.pubkey,
          brandName: account.brandName,
          type: accountGroup.type,
        }))
      )
    })

    return result
  }

  getAllPubkeys = async () => {
    const keyrings = await this.getAllDisplayedKeyrings()
    const result: { pubkey: string; type: string; brandName: string }[] = []
    keyrings.forEach(accountGroup => {
      result.push(
        ...accountGroup.accounts.map(account => ({
          pubkey: account.pubkey,
          brandName: account.brandName,
          type: accountGroup.type,
        }))
      )
    })

    return result
  }

  hasPubkey = async (pubkey: string) => {
    const addresses = await this.getAllPubkeys()
    return !!addresses.find(item => item.pubkey === pubkey)
  }

  /**
   * Clear Keyrings
   *
   * Deallocates all currently managed keyrings and accounts.
   * Used before initializing a new vault.
   */
  /* eslint-disable require-await */
  clearKeyrings = async (): Promise<void> => {
    // clear keyrings from memory

    this.keyrings = []
    this.addressTypes = []
    this.cachedDisplayedKeyring = null

    this.memStore.updateState({
      keyrings: [],
    })
  }

  /**
   * Update Memstore Keyrings
   *
   * Updates the in-memory keyrings, without persisting.
   */
  _updateMemStoreKeyrings = async (): Promise<void> => {
    const keyrings = await Promise.all(
      this.keyrings.map((keyring, index) =>
        this.displayForKeyring(keyring, this.addressTypes[index] || AddressType.P2WPKH, index)
      )
    )
    return this.memStore.updateState({ keyrings })
  }

  /**
   * Unlock Keyrings
   *
   * Unlocks the keyrings.
   *
   * @emits KeyringController#unlock
   */
  setUnlocked = () => {
    this.memStore.updateState({ isUnlocked: true })
    this.emit('unlock')
    if (this.eventBus) {
      this.eventBus.emit(BUS_EVENTS.broadcastToUI, {
        method: BUS_METHODS.UNLOCKED,
        params: {},
      })
    }
  }

  /**
   * Clean up cache to keep only the most recently accessed items
   * Uses LRU (Least Recently Used) strategy to limit cache size
   */
  private cleanupCache = async (cachedPubkeyData: any): Promise<any> => {
    if (!cachedPubkeyData) return cachedPubkeyData

    // Collect all cache entries with their access times
    const allEntries: {
      keyringIndex: string
      derivedIndex: string
      timestamp: number
      data: any
    }[] = []

    for (const keyringIndex in cachedPubkeyData) {
      if (!cachedPubkeyData[keyringIndex]) continue

      for (const derivedIndex in cachedPubkeyData[keyringIndex]) {
        const entry = cachedPubkeyData[keyringIndex][derivedIndex]
        if (entry && typeof entry === 'object') {
          allEntries.push({
            keyringIndex,
            derivedIndex,
            timestamp: entry.timestamp || 0,
            data: entry,
          })
        }
      }
    }

    // If total entries <= MAX_CACHE_ITEMS, no cleanup needed
    if (allEntries.length <= this.MAX_CACHE_ITEMS) {
      return cachedPubkeyData
    }

    // Sort by timestamp descending (most recent first)
    allEntries.sort((a, b) => b.timestamp - a.timestamp)

    // Keep only the most recent MAX_CACHE_ITEMS
    const toKeep = allEntries.slice(0, this.MAX_CACHE_ITEMS)

    // Rebuild cache with only kept items
    const cleanedCache: any = {}
    toKeep.forEach(entry => {
      if (!cleanedCache[entry.keyringIndex]) {
        cleanedCache[entry.keyringIndex] = {}
      }
      cleanedCache[entry.keyringIndex][entry.derivedIndex] = entry.data
    })

    this.logger?.debug(
      `[KeyringService] Cache cleanup: removed ${allEntries.length - toKeep.length} old entries, kept ${toKeep.length}`
    )

    return cleanedCache
  }

  getAllPubkeysByDerivedIndex = async (
    keyring: WalletKeyring,
    derivedIndex: number
  ): Promise<{ pubkey: string; type: AddressType }[]> => {
    const cachedPubkeys: {
      pubkey: string
      type: AddressType
    }[] = []

    let cachedPubkeyData: CachedPubkeyData = await this.storage.get(this.cachedKey)
    if (
      cachedPubkeyData &&
      cachedPubkeyData[keyring.index] &&
      cachedPubkeyData[keyring.index]![derivedIndex]
    ) {
      const cachedEntry = cachedPubkeyData[keyring.index]![derivedIndex]!

      // Update timestamp for LRU
      cachedEntry.timestamp = Date.now()
      await this.storage.set(this.cachedKey, cachedPubkeyData)

      return cachedEntry.data
    }

    const _keyring = this.keyrings[keyring.index]!

    if (_keyring.type === KeyringType.HdKeyring || _keyring.type === KeyringType.KeystoneKeyring) {
      const pathPubkey: { [path: string]: string } = {}
      ADDRESS_TYPES.filter(v => v.displayIndex >= 0).forEach(v => {
        let pubkey = pathPubkey[v.hdPath]
        if (!pubkey && _keyring.getAccountByHdPath) {
          pubkey = _keyring.getAccountByHdPath(v.hdPath, derivedIndex)
        }
        cachedPubkeys.push({
          pubkey: pubkey || '',
          type: v.value,
        })
      })
    } else {
      ADDRESS_TYPES.filter(v => v.displayIndex >= 0 && v.isUnisatLegacy === false).forEach(v => {
        const pubkey = keyring.accounts[derivedIndex]!.pubkey
        cachedPubkeys.push({
          pubkey: pubkey || '',
          type: v.value,
        })
      })
    }

    cachedPubkeyData = cachedPubkeyData || {}
    cachedPubkeyData[keyring.index] = cachedPubkeyData[keyring.index] || {}

    // Store with timestamp for LRU tracking
    cachedPubkeyData[keyring.index]![derivedIndex] = {
      data: cachedPubkeys,
      timestamp: Date.now(),
    }

    // Clean up cache to keep only recent items
    cachedPubkeyData = await this.cleanupCache(cachedPubkeyData)

    await this.storage.set(this.cachedKey, cachedPubkeyData)

    return cachedPubkeys
  }
}

interface CachedPubkeyData {
  [keyringIndex: string]: {
    [derivedIndex: string]: {
      data: { pubkey: string; type: AddressType }[]
      timestamp: number
    }
  }
}
