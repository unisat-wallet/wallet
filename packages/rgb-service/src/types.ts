export type RgbNetwork = 'mainnet' | 'testnet' | 'testnet4' | 'signet'

export interface RgbWalletRef {
  walletId: string
  fundingAddress: string
  network: RgbNetwork
}

export interface RgbOutpoint {
  txid: string
  vout: number
}

export interface RgbAllocation {
  assetId: string
  amount: string
  settled: boolean
  spendable: boolean
  /** Parent RGB operation output consumed by a local transition. */
  opId?: string
  assignmentIndex?: number
  assignmentType?: number
}

/** A colored UTXO supplied by the address indexer, never by an xpub wallet API. */
export interface RgbUtxo {
  outpoint: RgbOutpoint
  satoshis: number
  scriptPubKey: string
  publicKey: string
  /** Server-verified Bitcoin chain state. Only confirmed UTXOs may be used. */
  chainStatus?: 'mempool' | 'confirmed' | 'pending_spend' | 'spent' | 'replaced' | 'unknown'
  confirmations?: number
  confirmationHeight?: number
  allocations: RgbAllocation[]
}

/** Ordinary BTC input used only to pay an RGB transfer's miner fee. */
export interface RgbFeeUtxo {
  outpoint: RgbOutpoint
  satoshis: number
  scriptPubKey: string
  publicKey: string
}

export interface RgbFeeFunding {
  utxos: RgbFeeUtxo[]
  changeScriptPubKey: string
  changeDustLimit: number
}

export interface RgbWalletSnapshot {
  utxos: RgbUtxo[]
  syncedAt: number
}

export interface RgbTransferRequest {
  assetId: string
  /** Optional only when the RGB invoice fixes the transfer amount. */
  amount?: string
  invoice: string
  feeRate: number
  donation?: boolean
  minConfirmations?: number
}

export interface RgbTransferIntent {
  assetId: string
  amount: string
  invoice: import('./protocol/invoice').RgbInvoice
  transition: import('./protocol/transition').RgbFungibleTransitionPlan
}

/** Opaque RGB state received through transport, never constructed by an API. */
export interface RgbValidationHistory {
  assetId: string
  consignments: Array<{
    opId: string
    payload: string
  }>
  /** Locally persisted root-contract data, never supplied by the backend. */
  localContract?: string
  /** Strict NIA Genesis bytes for a locally issued root contract. */
  localGenesis?: string
  /** Locally encrypted blind receive seals; never part of an API response. */
  knownBlindSeals?: import('./protocol/receive').RgbBlindSeal[]
}

export interface RgbToSignInput {
  index: number
  publicKey: string
  useTweakedSigner?: boolean
  disableTweakSigner?: boolean
  sighashTypes?: number[]
}

/**
 * Produced by the local RGB protocol implementation. `psbt` contains the RGB
 * commitment and must be signed by the HD keyring without alteration.
 */
export interface RgbPreparedTransfer {
  id: string
  psbt: string
  toSignInputs: RgbToSignInput[]
  lockedOutpoints: RgbOutpoint[]
  metadata?: Record<string, string>
}

export interface RgbCompletedTransfer {
  txid: string
  rawTx: string
  consignments: RgbConsignment[]
  fundingUpdate?: {
    spentOutpoints: RgbOutpoint[]
    createdUtxo?: RgbUtxo
  }
}

/** Public indexes accompanying an otherwise opaque consignment payload. */
export interface RgbConsignment {
  recipientId: string
  payload: string
  assetId: string
  /** Transition operation IDs disclosed by this consignment. */
  opIds: string[]
  /** Idempotency key assigned after the local transfer ID is known. */
  transportId?: string
}

/** A consignment plus the endpoint and Bitcoin transaction required by RGB HTTP JSON-RPC. */
export interface RgbTransportConsignment extends RgbConsignment {
  txid: string
  endpoints: string[]
}

export interface RgbReceivedConsignment {
  recipientId: string
  payload: string
  txid: string
  /** The endpoint which returned the payload and must receive the ACK/NACK. */
  endpoint?: string
}

export interface RgbPendingTransfer {
  prepared: RgbPreparedTransfer
  /** The amount is resolved from the request or a fixed-amount invoice. */
  request: RgbTransferRequest & { amount: string }
  createdAt: number
  /** A signed transfer posted to transport, awaiting recipient acknowledgement. */
  delivery?: {
    completed: RgbCompletedTransfer
    endpoints: string[]
    publishedAt?: number
    /** Set after every recipient endpoint has ACKed the consignment. */
    acknowledgedAt?: number
    /** The last Bitcoin broadcast failure; retrying reuses the signed transaction. */
    broadcastError?: string
  }
  /** Broadcast has succeeded; only delivery/index synchronization remains. */
  broadcast?: {
    completed: RgbCompletedTransfer
    broadcastAt: number
  }
}

export interface RgbPendingReceive {
  invoice: string
  recipientId: string
  assetId?: string
  amount?: string
  expirationTimestamp?: number
  createdAt: number
  seal: import('./protocol/receive').RgbBlindSeal
  /**
   * Validated consignment waiting for the receiver to Accept/Reject in the UI.
   * ACK is intentionally deferred until acceptReceive().
   */
  pendingAccept?: {
    payload: string
    txid: string
    endpoint?: string
    assetId: string
    amount: string
    discoveredAt: number
    /** Spendable witness output scripts used to recover the sender address. */
    counterpartyScriptPubKeys?: string[]
  }
  /** Recently rejected consignments, retained so delayed proxy responses are ignored. */
  rejectedConsignmentTxids?: string[]
  /** Set only after the receiver explicitly accepts the consignment. */
  receivedConsignment?: {
    txid: string
    receivedAt: number
    /** True only after acceptReceive(); missing on older auto-accepted state. */
    accepted?: boolean
    /** Set when the sender's Bitcoin transaction is visible in the chain source. */
    broadcastDetectedAt?: number
    counterpartyScriptPubKeys?: string[]
  }
}

/** Confirmed receive history retained locally until the backend index acknowledges it. */
export interface RgbPendingReceiveHistory {
  transferId: string
  assetId: string
  amount: string
  txid: string
  createdAt: number
  status?: 'settled' | 'canceled' | 'rejected'
  counterpartyScriptPubKeys?: string[]
}

/** Local send history retained until the backend reports the final chain state. */
export interface RgbPendingSendHistory {
  transferId: string
  assetId: string
  amount: string
  txid?: string
  invoice?: string
  createdAt: number
  status: 'broadcasted' | 'canceled' | 'rejected'
}

/** Full address snapshot retained until the indexer acknowledges its replacement. */
export interface RgbPendingUtxoSync {
  txid: string
  outpoints: RgbUtxo[]
}

/** Locally committed issuance that still needs to be indexed remotely. */
export interface RgbPendingIssue {
  assetId: string
  contract: string
  genesis: string
  asset: RgbContractMetadata
  utxoSync: RgbPendingUtxoSync
}

export interface RgbContractMetadata {
  ticker: string
  name: string
  precision: number
  schema: string
  issuedSupply: string
  timestamp?: number
}

export interface RgbPendingAssetMetadata {
  assetId: string
  metadata: RgbContractMetadata
}

export interface RgbServiceState {
  version: 1
  wallet: RgbWalletRef
  snapshot: RgbWalletSnapshot
  pending: Record<string, RgbPendingTransfer>
  pendingReceives?: RgbPendingReceive[]
  pendingReceiveHistory?: RgbPendingReceiveHistory[]
  pendingSendHistory?: RgbPendingSendHistory[]
  pendingUtxoSync?: RgbPendingUtxoSync
  pendingIssues?: RgbPendingIssue[]
  /** Asset metadata learned from received consignments and waiting for indexing. */
  pendingAssetMetadata?: RgbPendingAssetMetadata[]
  /** Validated blind seals retained locally for later ownership proofs when spending received assets. */
  receivedBlindSeals?: import('./protocol/receive').RgbBlindSeal[]
  contracts?: Record<
    string,
    { consignment: string; genesis?: string; metadata?: RgbContractMetadata; createdAt: number }
  >
}

export interface RgbStorage {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

/** Remote dependency limited to address-scoped state, opaque transport history and post-broadcast indexing. */
export interface RgbStateSource {
  getSnapshot(wallet: RgbWalletRef): Promise<RgbWalletSnapshot>
  getValidationHistory(
    wallet: RgbWalletRef,
    request: {
      assetId: string
      allocations: Array<{
        outpoint: RgbOutpoint
        opId: string
        assignmentIndex: number
        assignmentType: number
      }>
    }
  ): Promise<RgbValidationHistory>
  syncBroadcast?(
    wallet: RgbWalletRef,
    transferId: string,
    transfer: RgbCompletedTransfer,
    snapshot: RgbWalletSnapshot,
    metadata: { amount: string; createdAt: number; invoice: string }
  ): Promise<void>
  claimConsignments?(wallet: RgbWalletRef, recipientId: string): Promise<number>
  getClaimedConsignments?(
    wallet: RgbWalletRef
  ): Promise<Array<{ recipientId: string; payload: string }>>
  getTransactionStatus?(wallet: RgbWalletRef, txid: string): Promise<{
    status: 'mempool' | 'confirmed' | 'pending_spend' | 'spent' | 'replaced' | 'unknown'
    confirmations: number
  }>
}

/** Network transport only. It must not construct a transaction or receive an xpub. */
export interface RgbTransport {
  /** Endpoints advertised in locally created blind invoices. */
  getEndpoints?(): string[]
  publishConsignment(consignment: RgbTransportConsignment): Promise<void>
  /** `undefined` means the receiver has not acknowledged the consignment yet. */
  getAcknowledgement?(consignment: RgbTransportConsignment): Promise<boolean | undefined>
  getConsignment?(input: {
    recipientId: string
    endpoints: string[]
  }): Promise<RgbReceivedConsignment | undefined>
  acknowledgeConsignment?(input: {
    recipientId: string
    endpoints: string[]
    acknowledged: boolean
  }): Promise<void>
}

export interface BitcoinBroadcaster {
  broadcast(rawTx: string): Promise<string>
}

/**
 * The protocol-only implementation. It owns invoice decoding, transition and
 * commitment encoding, and consignment construction; it has no backend wallet
 * context and no private keys.
 */
export interface RgbProtocolEncoder {
  prepareTransfer(input: {
    wallet: RgbWalletRef
    snapshot: RgbWalletSnapshot
    request: RgbTransferRequest
    intent: RgbTransferIntent
    selectedUtxos: RgbUtxo[]
    feeFunding?: RgbFeeFunding
    validationHistory: RgbValidationHistory
  }): Promise<RgbPreparedTransfer>
  completeTransfer(input: {
    wallet: RgbWalletRef
    pending: RgbPendingTransfer
    signedPsbt: string
  }): Promise<RgbCompletedTransfer>
}

export interface RgbServiceDependencies {
  storage: RgbStorage
  stateSource: RgbStateSource
  feeSource?: {
    getFeeFunding(wallet: RgbWalletRef): Promise<RgbFeeFunding>
  }
  encoder: RgbProtocolEncoder
  transport: RgbTransport
  broadcaster: BitcoinBroadcaster
  now?: () => number
}
