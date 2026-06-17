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
  xpubVan: string
  xpubCol: string
  masterFingerprint: string
  network?: string
  dataDirKey?: string
  addressIndex?: number
  transportEndpoint?: string
  indexerUrl?: string
  reuseAddresses?: boolean
  maxAllocationsPerUtxo?: number
  vanillaKeychain?: number
}

export interface RgbReceiveInvoiceRequest {
  wallet: RgbWalletRef
  assetId?: string
  amount?: number | string
  minConfirmations?: number
  durationSeconds?: number
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

export interface RgbFundingAddressRequest {
  wallet: RgbWalletRef
}

export interface RgbFundingAddressResult {
  address: string
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
  [key: string]: any
}

export interface RgbIssueNiaRequest {
  wallet: RgbWalletRef
  ticker: string
  name: string
  precision: number
  amounts: Array<number | string>
}

export interface RgbCreateUtxosBeginRequest {
  wallet: RgbWalletRef
  upTo?: boolean
  num?: number
  size?: number
  feeRate?: number
  skipSync?: boolean
  dryRun?: boolean
}

export interface RgbCreateUtxosEndRequest {
  wallet: RgbWalletRef
  signedPsbt: string
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

export interface RgbSendBeginRequest {
  wallet: RgbWalletRef
  invoice: string
  assetId: string
  amount?: number | string
  feeRate?: number
  minConfirmations?: number
  donation?: boolean
  witnessData?: {
    amountSat: number | string
    blinding?: number | string | null
  }
}

export interface RgbSendEndRequest {
  wallet: RgbWalletRef
  signedPsbt: string
  skipSync?: boolean
}
