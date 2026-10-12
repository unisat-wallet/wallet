export enum AssetTabKey {
  ORDINALS = 0,
  ATOMICALS = 1, // IGNORED
  RUNES = 2,
  MORE = 4,
  RGB = 5,
  BRC20 = 6,
  ALKANES = 7,
}

export enum WalletView {
  BITCOIN = 'bitcoin',
  RGB = 'rgb',
}

export enum OrdinalsAssetTabKey {
  ALL = 0,
  BRC20 = 1,
  BRC20_6BYTE = 2,
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
  lockedAmount?: string
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
  ticker?: string
  name?: string
  precision?: number
  type: RgbActivityType
  status: string
  amount: string
  txid: string
  timestamp: number
}

export type RgbTransferStatus =
  | 'signed'
  | 'waiting_ack'
  | 'pending_accept'
  | 'confirming'
  | 'waiting_receive'
  | 'settled'
  | 'rejected'
  | 'canceled'
  | string

export interface RgbTransferItem {
  id: string
  /** Local transfer ID for pending sends/receives; use this to open a detail view. */
  transferId?: string
  assetId?: string
  ticker?: string
  name?: string
  precision?: number
  type: 'send' | 'receive' | 'issue'
  amount?: string
  txid?: string
  timestamp: number
  status: RgbTransferStatus
  local?: boolean
}

export type RgbTransferNotificationKind = 'broadcasted' | 'receive_confirmed'

export interface RgbTransferNotification {
  kind: RgbTransferNotificationKind
  transfer: RgbTransferItem
}
