/**
 * RGB protocol related type definitions
 */

// ========================================
// RGB types
// ========================================

export type RgbActivityType = 'issue' | 'send' | 'receive' | 'inflation' | 'unknown' | string

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

/** Public asset metadata indexed from a locally-held RGB contract. */
export interface RgbAssetMetadata {
  assetId: string
  ticker: string
  name: string
  precision: number
  schema: string
  issuedSupply: string
  timestamp?: number
}

export interface RgbActivityItem {
  id: string
  assetId: string
  ticker?: string
  name?: string
  type: RgbActivityType
  status: string
  from: string
  to: string
  amount: string
  txid: string
  timestamp: number
}

export interface RgbPageResponse<T> {
  total: number
  list: T[]
}

export interface RgbPageQuery {
  page: number
  pageSize: number
}

export interface RgbAssetActivityQuery extends RgbPageQuery {
  address?: string
  type?: RgbActivityType
}

export interface RgbAddressActivityQuery extends RgbPageQuery {
  assetId?: string
  type?: RgbActivityType
}

export interface RgbWalletRef {
  walletId?: string
  /**
   * The address that owns the colored UTXOs. Backends must index this address,
   * never receive an account xpub or descriptor.
   */
  fundingAddress: string
  network?: string
  transportEndpoint?: string
}

/** One-time proof that the caller controls the RGB funding address. */
export interface RgbRequestAuthorization {
  fundingAddress: string
  nonce: string
  expiresAt: number
  signature: string
}

export type RgbRequestAuthenticator = (request: {
  method: 'POST'
  path: string
  body: unknown
}) => Promise<RgbRequestAuthorization>

export interface RgbUtxoSyncRequest {
  address: string
  txid: string
  outpoints: Array<{
    txid: string
    vout: number
    satoshis: number
    scriptPk: string
    publicKey: string
    allocations: RgbWalletUtxoAllocation[]
  }>
}

/** Public metadata sync for a locally issued or locally validated asset. */
export interface RgbAssetMetadataSyncRequest {
  asset: RgbAssetMetadata
}

/** Address-scoped colored UTXOs used by the local RGB transaction builder. */
export interface RgbWalletUtxoSnapshotRequest {
  wallet: RgbWalletRef
  forceSync?: boolean
}

export interface RgbWalletUtxoAllocation {
  assetId: string
  amount: string
  settled: boolean
  spendable: boolean
  /** Required by the local encoder to reference the parent RGB state. */
  opId?: string
  assignmentIndex?: number
  assignmentType?: number
}

export interface RgbWalletUtxo {
  txid: string
  vout: number
  satoshis: number
  scriptPk: string
  publicKey: string
  chainStatus?: 'mempool' | 'confirmed' | 'pending_spend' | 'spent' | 'replaced' | 'unknown'
  confirmations?: number
  confirmationHeight?: number
  allocations: RgbWalletUtxoAllocation[]
}

export interface RgbWalletUtxoSnapshotResult {
  utxos: RgbWalletUtxo[]
  syncedAt: number
}

export interface RgbTransactionStatusRequest {
  wallet: RgbWalletRef
}

export interface RgbTransactionStatusResult {
  status: 'mempool' | 'confirmed' | 'spent' | 'replaced' | 'unknown'
  confirmations: number
  confirmationHeight?: number
}

/**
 * Address-scoped RGB transfer history. Payloads are opaque consignments that
 * the backend stores and transports; it must not construct or alter them.
 */
export interface RgbConsignmentHistoryRequest {
  wallet: RgbWalletRef
  assetId: string
  allocations: Array<{
    txid: string
    vout: number
    opId: string
    assignmentIndex: number
    assignmentType: number
  }>
}

export interface RgbConsignmentHistoryResult {
  assetId: string
  consignments: Array<{
    opId: string
    /** Base64-encoded opaque RGB consignment or validated history fragment. */
    payload: string
  }>
}

/** Post-broadcast index update. No key material or transaction construction is sent to the API. */
export interface RgbTransferSyncRequest {
  wallet: RgbWalletRef
  transferId: string
  txid: string
  /** Exact RGB amount resolved from the local invoice before signing. */
  amount: string
  /** Local creation time in milliseconds, retained for stable history ordering. */
  createdAt: number
  /** Receiver funding address derived from the locally created invoice, when available. */
  to?: string
  /** RGB funding outpoints consumed by the already-broadcast transaction. */
  spentOutpoints: Array<{ txid: string; vout: number }>
  consignments: Array<{
    recipientId: string
    payload: string
    assetId: string
    opIds: string[]
    transportId?: string
  }>
}

/** Index a confirmed RGB transfer received by the local funding address. */
export interface RgbReceiveTransferSyncRequest {
  wallet: RgbWalletRef
  transferId: string
  assetId: string
  amount: string
  txid: string
  createdAt: number
  /** Sender funding address derived from the validated consignment, when available. */
  from?: string
}

/** Transport endpoint for a locally-created consignment. */
export interface RgbConsignmentPublishRequest {
  wallet: RgbWalletRef
  recipientId: string
  payload: string
  assetId: string
  opIds: string[]
  transportId?: string
}

/** Claim opaque consignments addressed to a locally generated recipient ID. */
export interface RgbConsignmentClaimRequest {
  wallet: RgbWalletRef
  recipientId: string
}

export interface RgbConsignmentClaimResult {
  claimed: number
}

export interface RgbClaimedConsignmentsRequest { wallet: RgbWalletRef }
export interface RgbClaimedConsignmentsResult {
  consignments: Array<{ recipientId: string; payload: string; assetId?: string; opIds: string[]; createdAt: number }>
}

/** Opaque ciphertext produced locally from the RGB service state. */
export interface RgbRecoveryCheckpointSaveRequest {
  wallet: RgbWalletRef
  payload: string
  updatedAt: number
}

export interface RgbRecoveryCheckpointReadRequest {
  wallet: RgbWalletRef
}

export interface RgbRecoveryCheckpointReadResult {
  payload?: string
  updatedAt?: number
}

export interface RgbReceiveInvoiceRequest {
  wallet: RgbWalletRef
  assetId?: string
  amount?: number | string
  durationSeconds?: number
  skipSync?: boolean
}

export interface RgbPendingReceiveInvoicesRequest {
  wallet: RgbWalletRef
}

export interface RgbPendingReceiveInvoice {
  invoice: string
  recipientId?: string
  assetId?: string | null
  amount?: number | string
  status?: string
  kind?: string
  transferKind?: string
  /** False once the receiver has accepted a consignment awaiting settlement. */
  canCancel?: boolean
  batchTransferIdx?: number
  expirationTimestamp?: number
  createdAt?: number
  [key: string]: any
}

export interface RgbPendingReceiveInvoicesResult {
  list: RgbPendingReceiveInvoice[]
  [key: string]: any
}

export interface RgbCancelReceiveInvoiceRequest {
  wallet: RgbWalletRef
  batchTransferIdx: number
  skipSync?: boolean
}

export interface RgbCancelReceiveInvoiceResult {
  changed: boolean
  [key: string]: any
}

export interface RgbAllocationSummaryRequest {
  wallet: RgbWalletRef
  skipSync?: boolean
}

export interface RgbAllocationSummaryResult {
  available?: boolean
  availableAllocationCount?: number
  freeAllocationCount?: number
  colorableUtxoCount?: number
  pendingConfirmation?: boolean
  pendingAllocationCount?: number
  [key: string]: any
}

export interface RgbIssueNiaRequest {
  wallet: RgbWalletRef
  ticker: string
  name: string
  precision: number
  amounts: Array<number | string>
}

export interface RgbPendingVanillaTxsRequest {
  wallet: RgbWalletRef
}

export interface RgbPendingVanillaTx {
  txid: string
  type?: string
  [key: string]: any
}

export interface RgbPendingVanillaTxsResult {
  list: RgbPendingVanillaTx[]
  [key: string]: any
}

export interface RgbAbortVanillaTxRequest {
  wallet: RgbWalletRef
  txid: string
}

export interface RgbAbortVanillaTxResult {
  aborted: boolean
  [key: string]: any
}
