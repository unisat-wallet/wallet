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
