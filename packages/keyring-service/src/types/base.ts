import { AddressType } from '@unisat/wallet-types'

// Core service interfaces
export interface DisplayedKeyring {
  type: string
  accounts: {
    pubkey: string
    brandName: string
    type?: string
    keyring?: any
    alianName?: string
  }[]
  keyring: any
  addressType: AddressType
  index: number
}

// Store state interfaces - aligned with unisat-extension
export interface MemStoreState {
  isUnlocked: boolean
  keyringTypes: any[]
  keyrings: any[]
  preMnemonics: string
  addressTypes: AddressType[]
  keystone?: any
}

export interface KeyringStore {
  vault?: string
  booted?: string
}

// Keyring creation options
export interface CreateMnemonicKeyringOptions {
  mnemonic: string
  activeIndexes: number[]
  hdPath: string
  passphrase?: string
}

export interface CreateKeystoneKeyringOptions {
  urType: string
  urCbor: string
  addressType: AddressType
  hdPath: string
  accountCount: number
  connectionType?: 'USB' | 'QR'
}

// Storage adapter interface
export interface StorageAdapter {
  init(): Promise<void>
  get(key: string): Promise<any>
  set(key: string, value: any): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
}

// Encryptor interface for customizable encryption
export interface Encryptor {
  encrypt(password: string, data: any): Promise<string>
  decrypt(password: string, encryptedData: string): Promise<any>
}

// Keyring service configuration
export interface KeyringServiceConfig {
  storage: StorageAdapter
  logger?: any
  encryptor?: Encryptor
  t?: any
  eventBus?: any
}

// Account information
export interface AccountInfo {
  pubkey: string
  type: string
  brandName: string
}
