export interface BitcoinBalance {
  confirm_amount: string
  pending_amount: string
  amount: string
  confirm_btc_amount: string
  pending_btc_amount: string
  btc_amount: string
  confirm_inscription_amount: string
  pending_inscription_amount: string
  inscription_amount: string
  usd_value: string
}

export interface AddressAssets {
  total_btc: string
  satoshis?: number
  total_inscription: number
}

export interface AddressSummary {
  address: string
  totalSatoshis: number
  btcSatoshis: number
  assetSatoshis: number
  inscriptionCount: number
  brc20Count: number
  brc20Count5Byte: number
  brc20Count6Byte: number
  runesCount: number
  loading?: boolean
}

export enum AddressFlagType {
  Is_Enable_Atomicals = 1,
  CONFIRMED_UTXO_MODE = 2,
}
