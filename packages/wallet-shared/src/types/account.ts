import { AddressType } from '@unisat/wallet-types'

export type WalletKeyring = {
  key: string
  index: number
  type: string
  addressType: AddressType
  accounts: Account[]
  alianName: string
  hdPath: string
}

export interface Account {
  type: string
  pubkey: string
  address: string
  brandName?: string
  alianName?: string
  displayBrandName?: string
  index?: number
  balance?: number
  key: string
  flag: number
}
