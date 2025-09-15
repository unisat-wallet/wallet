import { AddressType } from '@unisat/wallet-types'
import { CosmosSignDataType } from './cosmos'

// ToSignInput interface defined here to avoid circular imports
export interface ToSignInput {
  index: number
  publicKey: string
  useTweakedSigner?: boolean
  disableTweakSigner?: boolean
  tapLeafHashToSign?: Buffer
  sighashTypes?: number[] | undefined
}

export interface Keyring {
  type: string
  mfp?: string
  accounts?: string[]

  serialize(): Promise<any>
  deserialize(opts: any): Promise<void>
  addAccounts(n: number): Promise<string[]>
  getAccounts(): Promise<string[]>
  signTransaction(psbt: any, inputs: ToSignInput[]): Promise<any>
  signMessage(address: string, message: string): Promise<string>
  signData(address: string, data: string, type: string): Promise<string>
  verifyMessage(address: string, message: string, sig: string): Promise<boolean>
  exportAccount(address: string): Promise<string>
  removeAccount(address: string): void

  // Optional methods for different keyring types
  unlock?(): Promise<void>
  getFirstPage?(): Promise<{ address: string; index: number }[]>
  getNextPage?(): Promise<{ address: string; index: number }[]>
  getPreviousPage?(): Promise<{ address: string; index: number }[]>
  getAddresses?(start: number, end: number): { address: string; index: number }[]
  getIndexByAddress?(address: string): number

  getAccountsWithBrand?(): { address: string; index: number }[]
  activeAccounts?(indexes: number[]): string[]

  changeHdPath?(hdPath: string): void
  getAccountByHdPath?(hdPath: string, index: number): string

  // Keystone specific methods
  genSignPsbtUr?(psbtHex: string): Promise<{ type: string; cbor: string }>
  parseSignPsbtUr?(type: string, cbor: string): Promise<string>
  genSignMsgUr?(
    publicKey: string,
    text: string
  ): Promise<{ type: string; cbor: string; requestId: string }>
  parseSignMsgUr?(
    type: string,
    cbor: string
  ): Promise<{ requestId: string; publicKey: string; signature: string }>
  getConnectionType?(): 'USB' | 'QR'
  genSignCosmosUr?(cosmosSignRequest: {
    requestId?: string
    signData: string
    dataType: CosmosSignDataType
    path: string
    chainId?: string
    accountNumber?: string
    address?: string
  }): Promise<{ type: string; cbor: string; requestId: string }>
  parseSignCosmosUr?(type: string, cbor: string): Promise<any>
}

// Keyring types
export enum KeyringType {
  HdKeyring = 'HD Key Tree',
  SimpleKeyring = 'Simple Key Pair',
  KeystoneKeyring = 'Keystone',
  ColdWalletKeyring = 'Cold Wallet',
  ReadonlyKeyring = 'Readonly',
  Empty = 'Empty',
}

export const ADDRESS_TYPES: {
  value: AddressType
  label: string
  name: string
  hdPath: string
  displayIndex: number
  isUnisatLegacy?: boolean
}[] = [
  {
    value: AddressType.P2PKH,
    label: 'P2PKH',
    name: 'Legacy (P2PKH)',
    hdPath: "m/44'/0'/0'/0",
    displayIndex: 3,
    isUnisatLegacy: false,
  },
  {
    value: AddressType.P2WPKH,
    label: 'P2WPKH',
    name: 'Native Segwit (P2WPKH)',
    hdPath: "m/84'/0'/0'/0",
    displayIndex: 0,
    isUnisatLegacy: false,
  },
  {
    value: AddressType.P2TR,
    label: 'P2TR',
    name: 'Taproot (P2TR)',
    hdPath: "m/86'/0'/0'/0",
    displayIndex: 2,
    isUnisatLegacy: false,
  },
  {
    value: AddressType.P2SH_P2WPKH,
    label: 'P2SH-P2WPKH',
    name: 'Nested Segwit (P2SH-P2WPKH)',
    hdPath: "m/49'/0'/0'/0",
    displayIndex: 1,
    isUnisatLegacy: false,
  },
  {
    value: AddressType.M44_P2WPKH,
    label: 'P2WPKH',
    name: 'Native SegWit (P2WPKH)',
    hdPath: "m/44'/0'/0'/0",
    displayIndex: 4,
    isUnisatLegacy: true,
  },
  {
    value: AddressType.M44_P2TR,
    label: 'P2TR',
    name: 'Taproot (P2TR)',
    hdPath: "m/44'/0'/0'/0",
    displayIndex: 5,
    isUnisatLegacy: true,
  },
]
