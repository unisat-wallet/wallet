export enum AssetTabKey {
  ORDINALS = 0,
  ATOMICALS = 1, // IGNORED
  RUNES = 2,
  CAT = 3,
  MORE = 4,
}

export enum OrdinalsAssetTabKey {
  ALL = 0,
  BRC20 = 1,
  BRC20_6BYTE = 2,
}

export enum CATAssetTabKey {
  CAT20,
  CAT721,
  CAT20_V2,
  CAT721_V2,
}

export enum AlkanesAssetTabKey {
  TOKEN,
  COLLECTION,
}

export enum MoreAssetTabKey {
  ALKANES_TOKEN = 'alkanes_token',
  ALKANES_COLLECTION = 'alkanes_collection',
  RGB_TOKEN_LIST = 'rgb_token_list',
}

export enum NavigationSource {
  BACK,
  NORMAL,
}

export type RgbActivityType = 'issue' | 'send' | 'receive' | 'inflation' | 'unknown' | string

export interface RgbBalance {
  assetId: string
  name?: string
  ticker?: string
  schema?: string
  precision?: number
  amount?: string
  balance?: string
  settled?: string
  spendable?: string
  pending?: string
  [key: string]: any
}

export interface RgbAssetDetail {
  assetId: string
  name?: string
  ticker?: string
  schema?: string
  precision?: number
  issuedSupply?: string
  supply?: string
  holdersCount?: number
  txCount?: number
  volume24h?: string
  balance?: RgbBalance
  [key: string]: any
}

export interface RgbActivityItem {
  id: string
  assetId: string
  type: RgbActivityType
  status: string
  from: string
  to: string
  amount: string
  txid: string
  timestamp: number
}
