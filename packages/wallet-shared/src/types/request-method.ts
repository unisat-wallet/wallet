import { TxType } from './create-tx'
import { ToSignMessage } from './sign-message'
import { ToSignData } from './sign-tx'

export interface RequestMethodSendBitcoinParams {
  sendBitcoinParams: {
    toAddress: string
    satoshis: number
    feeRate?: number
    memo?: string
    memos?: string[]
  }
  type: TxType
}

export interface RequestMethodSendInscriptionParams {
  sendInscriptionParams: {
    toAddress: string
    inscriptionId: string
    feeRate: number | undefined
  }
  type: TxType
}

export interface RequestMethodSignPsbtParams {
  sendInscriptionParams: {
    toAddress: string
    inscriptionId: string
    feeRate: number | undefined
  }
  type: TxType
}

export interface RequestMethodSendRunesParams {
  sendRunesParams: {
    toAddress: string
    runeid: string
    amount: string
    feeRate: number | undefined
  }
  type: TxType
}

export interface RequestMethodSignMessageParams {
  text: string
  type: string

  toSignMessages?: ToSignMessage[]
}

export interface RequestMethodSignMessagesParams {
  messages: {
    text: string
    type: string
  }[]

  toSignMessages?: ToSignMessage[]
}

export interface RequestMethodGetInscriptionsParams {
  cursor: number
  size: number
}

export interface RequestMethodSignPsbtParams {
  psbtHex: string
  type: TxType
  options?: any
  toSignDatas?: ToSignData[]
}

export interface RequestMethodSignPsbtsParams {
  psbtHexs?: string[]
  options?: any
  toSignDatas?: ToSignData[]
}

export interface RequestMethodInscribeTransferParams {
  ticker: string
  amount: string
}

export interface RequestMethodGetBitcoinUtxosParams {
  cursor: number
  size: number
}

export interface RequestMethodGetAvailableUtxosParams {
  cursor: number
  size: number
}
