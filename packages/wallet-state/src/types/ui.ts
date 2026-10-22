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
  incomingPending?: string
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
  /** Present when this activity comes from a local transfer. */
  transferId?: string
  local?: boolean
  /** Unilateral BFA burn with a downloadable consignment proof. */
  burn?: boolean
  /** Destination chain committed by a V1 burn. */
  burnDestinationChainId?: number
  assetId: string
  ticker?: string
  name?: string
  precision?: number
  type: RgbActivityType
  status: string
  rejectionReason?: string
  canReject?: boolean
  rejectLocally?: boolean
  amount: string
  /** RGB amount in UTXOs reserved by this local send, before change returns. */
  lockedAmount?: string
  txid: string
  timestamp: number
}

export type RgbTransferStatus =
  | 'signed'
  | 'waiting_ack'
  | 'pending_accept'
  | 'validation_failed'
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
  /** RGB amount in UTXOs reserved by this local send, before change returns. */
  lockedAmount?: string
  txid?: string
  timestamp: number
  /** Time the receiver accepted this send, used to order pending broadcasts. */
  acknowledgedAt?: number
  status: RgbTransferStatus
  /** Local explanation for a rejected RGB receive, when recorded by the wallet. */
  rejectionReason?: string
  /** Whether this receive can be dismissed by an explicit user rejection. */
  canReject?: boolean
  /** The proxy cannot be notified because the consignment has no ACK endpoint. */
  rejectLocally?: boolean
  local?: boolean
  /** Unilateral BFA burn with a downloadable consignment proof. */
  burn?: boolean
  /** Destination chain committed by a V1 burn. */
  burnDestinationChainId?: number
  /** Bitcoin broadcast happened even if the receiver later rejected the RGB transfer. */
  broadcasted?: boolean
  /** Keep checking for a late legacy proxy ACK/NACK after Bitcoin confirmation. */
  awaitingRecipientAck?: boolean
}

export type RgbTransferNotificationKind = 'broadcasted' | 'receive_confirmed'

export interface RgbTransferNotification {
  kind: RgbTransferNotificationKind
  transfer: RgbTransferItem
}
