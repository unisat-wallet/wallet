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
  rejectionReason?: string
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

export interface RgbActivityStatusRequest {
  wallet: RgbWalletRef
  activities: Array<{ id?: string; txid?: string }>
}

export interface RgbActivityStatusItem {
  id: string
  assetId?: string
  type: RgbActivityType
  txid?: string
  amount?: string
  createdAt?: number
  status?: string
  confirmations?: number
  confirmationHeight?: number
  rejectionReason?: string
}

export interface RgbActivityStatusResult {
  list: RgbActivityStatusItem[]
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
  /** Server epoch seconds supplied after an authenticated request detects clock skew. */
  serverTime?: number
}) => Promise<RgbRequestAuthorization>

export interface RgbProxyPolicy {
  version: number
  expiresAt: number
  endpoints: string[]
}

export interface RgbProxyConfigProfile {
  id: string
  name: string
  endpoint: string
  protocolVersion?: string
  serverVersion?: string
}

export interface RgbProxyConfig {
  version: number
  expiresAt: number
  defaultProxyId?: string
  profiles: RgbProxyConfigProfile[]
}

export interface RgbProxyRelayRequest {
  endpoint: string
  operation: string
  contentType: string
  bodyBase64: string
}

export interface RgbProxyRelayResponse {
  status: number
  contentType?: string
  bodyBase64: string
}

export interface RgbUtxoSyncRequest {
  address: string
  /** Present on current clients so index writes are fenced by the wallet lease. */
  wallet?: RgbWalletRef & { network: string }
  lease?: RgbWriteLeaseCredential
  txid: string
  /** Enables server enforcement that every allocation references stored canonical history. */
  historyRefsVersion?: 1
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
  /** Metadata remains public, but a supplied wallet lease fences its index write. */
  wallet?: RgbWalletRef & { network: string }
  lease?: RgbWriteLeaseCredential
}

/** Address-scoped colored UTXOs used by the local RGB transaction builder. */
export interface RgbWalletUtxoSnapshotRequest {
  wallet: RgbWalletRef
  forceSync?: boolean
  knownRevision?: number
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
  historyRef?: string
  historyAvailable?: boolean
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
  changed?: boolean
  revision?: number
  activeUtxoCount?: number
  utxos?: RgbWalletUtxo[]
  syncedAt: number
}

/** Single-writer lease for RGB mutations on one wallet installation. */
export interface RgbWriteLease {
  leaseId: string
  fencingToken: number
  expiresAt: number
  checkpointRevision?: string
}

export interface RgbWriteLeaseAcquireRequest {
  wallet: RgbWalletRef & { network: string }
  deviceId: string
  checkpointRevision?: string
  takeover?: boolean
  supportedCheckpointFormat?: number
}

export interface RgbWriteLeaseRenewRequest {
  wallet: RgbWalletRef & { network: string }
  deviceId: string
  leaseId: string
  fencingToken: number
}

export interface RgbWriteLeaseReleaseRequest extends RgbWriteLeaseRenewRequest {}

/** Read-only lease availability; holder identity is intentionally never returned. */
export interface RgbWriteLeaseStatusRequest {
  wallet: RgbWalletRef & { network: string }
  lease?: RgbWriteLeaseCredential
}

export interface RgbWriteLeaseStatus {
  available: boolean
  heldByCaller: boolean
  expiresAt?: number
}

/** Fencing credential attached to a write while the lease migration is enabled. */
export interface RgbWriteLeaseCredential {
  deviceId: string
  leaseId: string
  fencingToken: number
}

export interface RgbUtxoVerifyRequest extends RgbWriteLeaseRenewRequest {
  outpoints: Array<{ txid: string; vout: number; satoshis: number; scriptPk: string }>
}

export interface RgbVerifiedUtxo {
  txid: string
  vout: number
  status: 'mempool' | 'confirmed' | 'spent' | 'replaced' | 'unknown'
  confirmations: number
  confirmationHeight?: number
}

export interface RgbUtxoVerifyResult {
  outpoints: RgbVerifiedUtxo[]
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

export interface RgbValidationAttestationPayload {
  version: 1
  validatorVersion: string
  network: 0 | 1 | 2 | 3
  payloadHash: string
  assetId: string
  genesisHash: string
  hasDynamicRejectList: boolean
  bundles: Array<{
    id: string
    txid: string
    operationIds: string[]
    parentOpIds: string[]
  }>
  expiresAt: number
}

export interface RgbConsignmentValidationRequest {
  wallet: RgbWalletRef
  payload: string
}

export interface RgbConsignmentValidationResult {
  payload: RgbValidationAttestationPayload
  publicKey: string
  signature: string
}

export interface RgbReceiveValidationFailureReportRequest {
  wallet: RgbWalletRef
  recipientId: string
  txid?: string
  payload?: string
  reason: string
  endpoint?: string
  proxyTransferId?: string
  proxyConsignmentHash?: string
}

export interface RgbReceiveValidationFailureStatusRequest {
  wallet: RgbWalletRef
  caseId: string
}

export interface RgbReceiveValidationFailureStatusResult {
  caseId?: string
  status: 'under_review' | 'rejection_allowed'
  reviewReason?: string
}

/** Post-broadcast index update. No key material or transaction construction is sent to the API. */
export interface RgbTransferSyncRequest {
  wallet: RgbWalletRef
  lease?: RgbWriteLeaseCredential
  transferId: string
  txid: string
  /** Asset discriminator retained when consignment payloads are uploaded out of band. */
  assetId: string
  /** Exact RGB amount resolved from the local invoice before signing. */
  amount: string
  /** Local creation time in milliseconds, retained for stable history ordering. */
  createdAt: number
  /** RGB funding outpoints consumed by the already-broadcast transaction. */
  spentOutpoints: Array<{ txid: string; vout: number }>
  consignments: Array<{
    recipientId: string
    assetId: string
    opIds: string[]
    transportId?: string
  }>
}

/** Record a successfully broadcast BFA burn without uploading its proof payload. */
export interface RgbBurnReportRequest {
  wallet: RgbWalletRef & { network: string }
  txid: string
  assetId: string
  amount: string
  destinationChainId: number
  /** Lowercase hex-encoded chain-native recipient bytes. */
  recipient: string
  createdAt: number
}

export interface RgbBurnReportResult {
  recorded: true
  txid: string
}

/** Index a local RGB receive outcome for this invoice. */
export interface RgbReceiveTransferSyncRequest {
  wallet: RgbWalletRef
  lease?: RgbWriteLeaseCredential
  transferId: string
  status?: 'settled' | 'rejected' | 'canceled'
  assetId?: string
  amount?: string
  txid?: string
  createdAt: number
  from?: string
  rejectionReason?: string
}

/** Transport endpoint for a locally-created consignment. */
export interface RgbConsignmentPublishRequest {
  wallet: RgbWalletRef
  lease?: RgbWriteLeaseCredential
  recipientId: string
  payload: string
  assetId: string
  opIds: string[]
  transportId?: string
}

/** Canonical wallet history uploaded once and deduplicated by its content hash. */
export interface RgbHistoryFragmentStoreRequest {
  wallet: RgbWalletRef
  lease?: RgbWriteLeaseCredential
  assetId: string
  opIds: string[]
  payloadHash: string
  payload: string
}

export interface RgbHistoryFragmentStoreResult {
  stored: true
  payloadHash: string
}

/** Claim opaque consignments addressed to a locally generated recipient ID. */
export interface RgbConsignmentClaimRequest {
  wallet: RgbWalletRef
  lease?: RgbWriteLeaseCredential
  recipientId: string
}

export interface RgbConsignmentClaimResult {
  claimed: number
}

export interface RgbClaimedConsignmentsRequest {
  wallet: RgbWalletRef
}
export interface RgbClaimedConsignmentsResult {
  consignments: Array<{
    recipientId: string
    payload: string
    assetId?: string
    opIds: string[]
    createdAt: number
  }>
}

/** Opaque ciphertext produced locally from the RGB service state. */
export interface RgbRecoveryCheckpointSaveRequest {
  wallet: RgbWalletRef
  lease?: RgbWriteLeaseCredential
  /** Legacy single-part ciphertext. New clients use payloadParts. */
  payload?: string
  /** Ordered ciphertext chunks. Splitting happens only after encryption. */
  payloadParts?: string[]
  /** Legacy version observed during the authenticated recovery read. */
  expectedUpdatedAt?: number
  /** Immutable server revision observed during the authenticated recovery read. */
  expectedRevision?: string
  /** Normal writer progression vs an explicit user-approved replacement. */
  kind?: 'normal' | 'replacement'
  checkpointFormat?: number
  updatedAt: number
}

export interface RgbRecoveryCheckpointSaveResult {
  /** False means the server already has a checkpoint with a newer timestamp. */
  saved: boolean
  updatedAt: number
  revision?: string
  generation?: number
  kind?: 'normal' | 'replacement'
}

export interface RgbRecoveryCheckpointUploadStartRequest {
  wallet: RgbWalletRef
  lease?: RgbWriteLeaseCredential
  expectedUpdatedAt?: number
  expectedRevision?: string
  kind?: 'normal' | 'replacement'
  checkpointFormat?: number
  updatedAt: number
  partCount: number
  totalLength: number
  checksum: string
}

export interface RgbRecoveryCheckpointUploadStartResult {
  uploadId: string
}

export interface RgbRecoveryCheckpointUploadPartRequest {
  wallet: RgbWalletRef
  lease?: RgbWriteLeaseCredential
  uploadId: string
  index: number
  payload: string
}

export interface RgbRecoveryCheckpointUploadCompleteRequest {
  wallet: RgbWalletRef
  lease?: RgbWriteLeaseCredential
  uploadId: string
}

export interface RgbRecoveryCheckpointUploadStatusRequest {
  wallet: RgbWalletRef
  uploadId: string
}

export interface RgbRecoveryCheckpointUploadStatusResult extends RgbRecoveryCheckpointSaveResult {
  /** `publishing` is a durable server-side lease and can be resumed by retrying complete. */
  status: 'pending' | 'publishing' | 'completed'
  receivedIndexes?: number[]
}

export interface RgbRecoveryCheckpointReadRequest {
  wallet: RgbWalletRef
  supportedCheckpointFormat?: number
}

export interface RgbRecoveryCheckpointReadResult {
  payload?: string
  updatedAt?: number
  revision?: string
  generation?: number
  kind?: 'normal' | 'replacement'
  checkpointFormat?: number
}

export interface RgbRecoveryCheckpointMetadataResult {
  exists: boolean
  updatedAt?: number
  revision?: string
  generation?: number
  kind?: 'normal' | 'replacement'
  checkpointFormat?: number
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
  receiveInvoiceCount: number
  receiveInvoiceLimit: number
  canCreateReceiveInvoice: boolean
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
