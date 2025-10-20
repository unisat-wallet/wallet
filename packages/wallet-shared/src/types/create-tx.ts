import { AddressType } from '@unisat/wallet-types'
import { Inscription } from './inscription'

export interface UnspentOutput {
  txid: string
  vout: number
  satoshis: number
  scriptPk: string
  pubkey: string
  addressType: AddressType
  inscriptions: {
    inscriptionId: string
    inscriptionNumber?: number
    offset: number
  }[]
  runes?: {
    runeid: string
    amount: string
  }[]
  rawtx?: string
}

export interface UTXO {
  txid: string
  vout: number
  satoshis: number
  scriptPk: string
  addressType: AddressType
  inscriptions: {
    inscriptionId: string
    inscriptionNumber?: number
    offset: number
  }[]
  atomicals: {
    // deprecated
    atomicalId: string
    atomicalNumber: number
    type: 'NFT' | 'FT'
    ticker?: string
    atomicalValue?: number
  }[]

  runes: {
    runeid: string
    rune: string
    amount: string
  }[]
}

export interface UTXO_Detail {
  txId: string
  outputIndex: number
  satoshis: number
  scriptPk: string
  addressType: AddressType
  inscriptions: Inscription[]
}

export enum TxType {
  SIGN_TX,
  SEND_BITCOIN,
  SEND_ORDINALS_INSCRIPTION,
  SEND_ATOMICALS_INSCRIPTION, // deprecated
  SEND_RUNES,
  SEND_ALKANES,
}

export interface ToAddressInfo {
  address: string
  domain?: string
  inscription?: Inscription
}

export interface RawTxInfo {
  psbtHex: string
  rawtx: string
  toAddressInfo?: ToAddressInfo
  fee?: number
}
