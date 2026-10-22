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
  logo?: string
}

export interface AddressHistorySummaryItem {
  txid: string
  timestamp: number
  height: number
  confirmations: number
  status: 'pending' | 'confirmed'
  direction: 'receive' | 'send' | 'mixed' | 'self'
  /** Backend-classified protocol operation. Open-ended so new operations need no client release. */
  operation?: string
  /** Localized, backend-controlled presentation metadata. */
  display?: {
    title: string
    balanceEffect?: 'increase' | 'decrease' | 'neutral'
    assetChanges?: Array<{
      asset: AddressHistoryAssetItem
      sign: '+' | '-' | ''
    }>
    visibleAssetKinds?: AddressHistoryAssetKind[]
    hideAmount?: boolean
    hideCounterparty?: boolean
    hideNetworkFee?: boolean
  }
  /** Unique destination from the history API, when available. */
  toAddress?: string
  /** Verified source, such as a unique receive sender or marketplace seller. */
  fromAddress?: string
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

export interface AddressHistoryTxInput {
  index: number
  prevTxid: string
  prevVout: number
  address: string
  value: string
  valueSatoshis: number
  scriptType: string
  scriptPk: string
  isMine: boolean
  assets: AddressHistoryAssetItem[]
}

export interface AddressHistoryTxOutput {
  index: number
  vout: number
  address: string
  value: string
  valueSatoshis: number
  scriptType: string
  scriptPk: string
  isMine: boolean
  isSpent: boolean
  assets: AddressHistoryAssetItem[]
}

export interface AddressHistoryTxDetail {
  txid: string
  timestamp: number
  height: number
  confirmations: number
  status: 'pending' | 'confirmed'
  blockhash: string
  size: number
  locktime: number
  feeSatoshis: number
  fee: string
  totalInputValue: string
  totalOutputValue: string
  summary: AddressHistorySummaryItem
  inputs: AddressHistoryTxInput[]
  outputs: AddressHistoryTxOutput[]
}
