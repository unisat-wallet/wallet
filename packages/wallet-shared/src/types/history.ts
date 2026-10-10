export interface TxHistoryInOutItem {
  address: string
  value: number
  inscriptions: { inscriptionId: string }[]
  runes: { spacedRune: string; symbol: string; divisibility: number; amount: string }[]
  brc20: { ticker: string; amount: string }[]
}

export interface TxHistoryItem {
  txid: string
  confirmations: number
  height: number
  timestamp: number
  size: number
  feeRate: number
  fee: number
  outputValue: number
  vin: TxHistoryInOutItem[]
  vout: TxHistoryInOutItem[]
  types: string[]
  methods: string[]
}

export type AddressHistoryAssetKind =
  | 'coin'
  | 'inscription'
  | 'runes'
  | 'alkanes'
  | 'brc20'
  | 'cat20'
  | 'cat721'
  | 'cat20_v2'
  | 'cat721_v2'
  | 'brc20_prog'

export interface AddressHistoryAssetItem {
  kind: AddressHistoryAssetKind
  symbol: string
  amount: string
  assetId?: string
  displayName?: string
}

export interface AddressHistorySummaryItem {
  txid: string
  timestamp: number
  height: number
  confirmations: number
  status: 'pending' | 'confirmed'
  direction: 'receive' | 'send' | 'mixed' | 'self'
  feeSatoshis: number
  received: AddressHistoryAssetItem[]
  sent: AddressHistoryAssetItem[]
  receivedCount: number
  sentCount: number
  receivedTruncated: boolean
  sentTruncated: boolean
}

export interface AddressHistorySummaryPage {
  start: number
  total: number
  detail: AddressHistorySummaryItem[]
}
