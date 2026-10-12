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

export interface AddressAssetSummary {
  brc20Count: number
  runesCount: number
  alkanesCount: number
  inscriptionCount: number
  alkanesCollectionCount: number
}

export type AddressAssetOverviewItem =
  | {
      kind: 'brc20' | 'rune' | 'alkanes'
      tokenId: string
      name: string
      symbol: string
      logo: string
      divisibility: number
      balance: string
    }
  | { kind: 'ord-collection'; collectionId: string; name: string; logo: string; count: number }
  | { kind: 'alkanes-collection'; alkaneid: string; name: string; image: string; count: number }
  | { kind: 'cat721-collection'; collectionId: string; name: string; count: number; contentType: string; previewLocalIds: number[] }
  | { kind: 'domain'; category: string; count: number }
  | { kind: 'inscription-summary'; total: number }

export enum AddressFlagType {
  Is_Enable_Atomicals = 0b1, // deprecated
  CONFIRMED_UTXO_MODE = 0b10,
  DISABLE_AUTO_SWITCH_CONFIRMED = 0b100, // deprecated
  DISABLE_ARC20 = 0b1000, // deprecated
}
