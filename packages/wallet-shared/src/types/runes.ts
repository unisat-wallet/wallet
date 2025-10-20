import { Inscription } from './inscription'

export interface AddressRunesTokenSummary {
  runeInfo: RuneInfo
  runeBalance: RuneBalance
  runeLogo?: Inscription
}

export interface RuneBalance {
  amount: string
  runeid: string
  rune: string
  spacedRune: string
  symbol: string
  divisibility: number
}

export interface RuneInfo {
  runeid: string
  rune: string
  spacedRune: string
  number: number
  height: number
  txidx: number
  timestamp: number
  divisibility: number
  symbol: string
  etching: string
  premine: string
  terms: {
    amount: string
    cap: string
    heightStart: number
    heightEnd: number
    offsetStart: number
    offsetEnd: number
  }
  mints: string
  burned: string
  holders: number
  transactions: number
  mintable: boolean
  remaining: string
  start: number
  end: number
  supply: string
  parent?: string
  logo?: string
}
