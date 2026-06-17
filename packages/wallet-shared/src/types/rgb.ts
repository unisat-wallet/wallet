export type RgbActivityType = 'issue' | 'send' | 'receive'

export interface RgbHolderSummary {
  holders?: number
  [key: string]: any
}

export interface RgbBalance {
  assetId: string
  name: string
  ticker: string
  precision: number
  balance: string
  settled?: string
  future?: string
  spendable?: string
  schema?: string
  issuedSupply?: string
}

export interface RgbAssetInfo {
  assetId: string
  name: string
  ticker: string
  precision: number
  schema?: string
  issuedSupply?: string
  timestamp?: number
  holderSummary?: RgbHolderSummary
}

export interface RgbAssetDetail extends RgbAssetInfo {}

export interface RgbActivityItem {
  txid: string
  assetId: string
  type: RgbActivityType
  amount: string
  timestamp?: number
  status?: string
  fromAddress?: string
  toAddress?: string
}
