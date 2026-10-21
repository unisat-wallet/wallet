export type RgbNetwork = 'mainnet' | 'testnet' | 'testnet4' | 'signet' | 'fractal-mainnet' | 'fractal-test'

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

/** Locally known unconfirmed output created by an RGB fee-pool top-up. */
export interface RgbFeePoolUtxo extends RgbFeeUtxo {
  createdAt: number
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

/**
 * Wallet-facing RGB balance derived from the encrypted local snapshot. The
 * indexer is a replica and must not be needed to render this value.
 */
export interface RgbLocalAssetBalance {
  assetId: string
  /** Settled amount; retained as `balance` for the existing wallet UI. */
  balance: string
  settled: string
  spendable: string
  /** Allocations that are known locally but are not settled/spendable yet. */
  pending: string
  /** Accepted incoming consignments awaiting settlement, included in pending. */
  incomingPending: string
  ticker?: string
  name?: string
  precision?: number
  schema?: string
  issuedSupply?: string
  timestamp?: number
}

/** Local contract metadata together with the wallet's locally derived balance. */
export interface RgbLocalAssetDetail extends RgbLocalAssetBalance {}

export interface RgbTransferRequest {
  assetId: string
  /** Optional only when the RGB invoice fixes the transfer amount. */
  amount?: string
  /** Display precision of the selected asset, retained for local transfer activity. */
  precision?: number
  invoice: string
  feeRate: number
  donation?: boolean
  minConfirmations?: number
  /**
   * A maker-built, unsigned Opret-first transaction template. It is accepted
   * only by the swap path and is still checked and colored locally before any
   * signature is requested.
   */
  swapPsbt?: string
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
  /** Ordinary BTC fee-pool inputs held until this RGB transfer reaches a terminal state. */
  feeOutpoints?: RgbOutpoint[]
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
  /** Broadcast after publication without waiting for a recipient ACK. */
  donation?: boolean
  /** Proxy v1 send details, present only for invoices carrying `pk`. */
  proxyInvoiceId?: string
  proxyRecipientPublicKey?: string
  proxySenderPrivateKey?: string
  signedRawTx?: string
  proxyExpirationTimestamp?: number
}

export interface RgbReceivedConsignment {
  recipientId: string
  payload: string
  /** Absent for consignments claimed from the backend; recovered from the witness. */
  txid?: string
  proxyTransferId?: string
  proxySenderPublicKey?: string
  proxySenderEndpoint?: string
  proxyConsignmentHash?: string
  /** The endpoint which returned the payload and must receive the ACK/NACK. */
  endpoint?: string
}

export interface RgbPendingTransfer {
  prepared: RgbPreparedTransfer
  /** The amount is resolved from the request or a fixed-amount invoice. */
  request: RgbTransferRequest & { amount: string }
  createdAt: number
  /** Stable per-send Ed25519 key for idempotent proxy v1 retries. */
  proxySenderPrivateKey?: string
  /**
   * Provider origin that created this transfer. This is encrypted local
   * state only and is deliberately omitted from recovery checkpoints.
   */
  providerOrigin?: string
  /** A signed transfer posted to transport, awaiting recipient acknowledgement. */
  delivery?: {
    completed: RgbCompletedTransfer
    endpoints: string[]
    publishedAt?: number
    /** Donation publication and its signed transaction are durably recoverable. */
    donationReadyAt?: number
    /** Set after every recipient endpoint has ACKed the consignment. */
    acknowledgedAt?: number
    /** Do not let background sync broadcast until the counterparty returns a final PSBT. */
    requiresCounterpartySignature?: boolean
    /** Encrypted local copy used to ensure the returned final PSBT retains maker signatures. */
    makerSignedPsbt?: string
    /** Buyer-signed swap is ready; the dApp, not this wallet, broadcasts it. */
    externalBroadcast?: boolean
    /** The last Bitcoin broadcast failure; retrying reuses the signed transaction. */
    broadcastError?: string
    /** Last successful report to the wallet backend. */
    failureReportedAt?: number
  }
  /** Broadcast has succeeded; only delivery/index synchronization remains. */
  broadcast?: {
    completed: RgbCompletedTransfer
    broadcastAt: number
  }
}

export interface RgbPendingReceive {
  invoice: string
  /** Ed25519 key reserved for this invoice by an RGB proxy v1 endpoint. */
  proxyPrivateKey?: string
  proxyPublicKey?: string
  proxyInvoiceId?: string
  /** Confirmations required before this receipt becomes settled. */
  minConfirmations?: number
  /** dApp origin that created this invoice; local-only and excluded from recovery checkpoints. */
  providerOrigin?: string
  /** RGB beneficiary; for witness invoices this is the stable wvout identifier. */
  recipientId: string
  /** Per-invoice proxy storage key. Defaults to recipientId for legacy blind invoices. */
  proxyRecipientId?: string
  recipientType?: 'blind' | 'witness'
  assetId?: string
  amount?: string
  /** This invoice's recipient ID has been durably registered with the recovery service. */
  claimedAt?: number
  /** The validated asset metadata has already been delivered to the indexer. */
  assetMetadataIndexed?: boolean
  expirationTimestamp?: number
  createdAt: number
  /** Present only for blind invoices. */
  seal?: import('./protocol/receive').RgbBlindSeal
  /** Exact P2TR script of a locally-created witness invoice. */
  witnessScriptPubKey?: string
  /** Funding-key public key needed to register a witness-created UTXO. */
  witnessPublicKey?: string
  /**
   * Validated consignment waiting for the receiver to Accept/Reject in the UI.
   * ACK is intentionally deferred until acceptReceive().
   */
  pendingAccept?: {
    payload: string
    txid: string
    endpoint?: string
    proxyTransferId?: string
    proxySenderPublicKey?: string
    proxySenderEndpoint?: string
    proxyConsignmentHash?: string
    assetId: string
    amount: string
    /** Contract precision decoded from the validated consignment. */
    precision?: number
    discoveredAt: number
    /** Spendable witness output scripts used to recover the sender address. */
    counterpartyScriptPubKeys?: string[]
  }
  /** Recently rejected consignments, retained so delayed proxy responses are ignored. */
  rejectedConsignmentTxids?: string[]
  /** Local receipt retained while acknowledgement and settlement are finalized. */
  receivedConsignment?: {
    txid: string
    receivedAt: number
    /** Actual contract received; distinct from an optional invoice constraint. */
    assetId?: string
    /** Actual atomic amount received; distinct from an optional invoice constraint. */
    amount?: string
    /** Contract precision decoded from the validated consignment. */
    precision?: number
    /** True only after acceptReceive(); missing on older auto-accepted state. */
    accepted?: boolean
    /** ACK intent was durably recorded before the proxy acknowledgement request. */
    acknowledgementPending?: boolean
    /** Validated payload retained so settlement survives proxy cleanup or restart. */
    payload?: string
    /** Proxy endpoint which supplied the validated payload. */
    endpoint?: string
    proxyTransferId?: string
    proxySenderPublicKey?: string
    proxySenderEndpoint?: string
    proxyConsignmentHash?: string
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
  /** Contract precision decoded from the validated consignment. */
  precision?: number
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
  precision?: number
  txid?: string
  invoice?: string
  /** Funding allocations removed locally when this broadcast was accepted. */
  spentOutpoints?: RgbOutpoint[]
  createdAt: number
  status: 'broadcasted' | 'canceled' | 'rejected'
  /** Local-only provider ownership retained while the status is available. */
  providerOrigin?: string
  /** Epoch milliseconds after which the local provider owner is discarded. */
  providerOriginExpiresAt?: number
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

/** Durable local record of a self-issued asset, retained after indexing completes. */
export interface RgbIssueHistoryItem {
  assetId: string
  /** Paid web issuance order used to make retries idempotent. */
  orderId?: string
  amount: string
  txid: string
  createdAt: number
  asset: RgbContractMetadata
  /** Last known chain state of the genesis allocation UTXO. */
  chainStatus?: RgbUtxo['chainStatus']
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
  /** Indexed metadata stays available locally until the receive is settled. */
  synced?: boolean
}

export interface RgbServiceState {
  version: 1
  wallet: RgbWalletRef
  /**
   * False only when this installation could not read the remote checkpoint.
   * Keeping the marker in encrypted local storage prevents a later restart
   * from overwriting an unknown remote backup.
   */
  recoveryRemoteStateKnown?: boolean
  /** Set when remote and local checkpoint revisions diverge; RGB writes stay blocked. */
  recoveryConflict?: boolean
  /** Version of the remote checkpoint from which this local state was restored/saved. */
  recoveryCheckpointUpdatedAt?: number
  recoveryCheckpointRevision?: string
  /** Server-assigned order of the checkpoint currently represented locally. */
  recoveryCheckpointGeneration?: number
  /** Explicit replacement checkpoints require user confirmation on other devices. */
  recoveryCheckpointKind?: 'normal' | 'replacement'
  /** Local-only checkpoint delivery state; intentionally excluded from the encrypted remote snapshot. */
  recoveryCheckpoint?: {
    dirty: boolean
    verified: boolean
    checksum?: string
    totalLength?: number
    uploadId?: string
    uploadedIndexes?: number[]
    lastError?: string
  }
  snapshot: RgbWalletSnapshot
  pending: Record<string, RgbPendingTransfer>
  pendingReceives?: RgbPendingReceive[]
  /**
   * Durable terminal-receive tombstones. They are included in the encrypted
   * checkpoint so an older installation can safely discard an invoice that a
   * lease holder released, canceled, rejected, or settled on another device.
   */
  releasedReceiveRecipientIds?: string[]
  pendingReceiveHistory?: RgbPendingReceiveHistory[]
  pendingSendHistory?: RgbPendingSendHistory[]
  pendingUtxoSync?: RgbPendingUtxoSync
  pendingIssues?: RgbPendingIssue[]
  issueHistory?: RgbIssueHistoryItem[]
  /** Asset metadata learned from received consignments, retained until settlement. */
  pendingAssetMetadata?: RgbPendingAssetMetadata[]
  /** Unconfirmed fee-pool outputs retained until the address indexer exposes them. */
  pendingFeePoolUtxos?: RgbFeePoolUtxo[]
  /** Validated blind seals retained locally for later ownership proofs when spending received assets. */
  receivedBlindSeals?: import('./protocol/receive').RgbBlindSeal[]
  contracts?: Record<
    string,
    {
      /** Backwards-compatible latest contract/consignment payload. */
      consignment: string
      genesis?: string
      metadata?: RgbContractMetadata
      createdAt: number
      /**
       * Canonical, locally complete spend history. Its single Consignment
       * contains each required WitnessBundle once, including all live branches.
       * This is wallet state, never a backend cache.
       */
      history?: {
        payload: string
        opIds: string[]
        updatedAt: number
        /** Original v0 consignments kept for recovery after a verified v1 migration. */
        legacyPayloads?: string[]
      }
    }
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
  reportBroadcastFailure?(wallet: RgbWalletRef, report: {
    transferId: string
    recipientId: string
    txid: string
    rawTx: string
    error: string
  }): Promise<void>
  getBroadcastCancellation?(wallet: RgbWalletRef, recipientId: string, txid: string): Promise<boolean>
  /** Verify locally selected Bitcoin outpoints before an RGB transfer is encoded. */
  verifyUtxos?(
    wallet: RgbWalletRef,
    outpoints: Array<Pick<RgbUtxo, 'outpoint' | 'satoshis' | 'scriptPubKey'>>
  ): Promise<
    Array<{
      outpoint: RgbOutpoint
      status: 'mempool' | 'confirmed' | 'pending_spend' | 'spent' | 'replaced' | 'unknown'
      confirmations: number
      confirmationHeight?: number
    }>
  >
}

/** Network transport only. It must not construct a transaction or receive an xpub. */
export interface RgbTransport {
  /** Endpoints advertised in locally created blind invoices. */
  getEndpoints?(): string[]
  prepareInvoice?(input: {
    recipientId: string
    endpoints: string[]
    expirationTimestamp?: number
  }): Promise<{ publicKey: string; privateKey: string; invoiceId: string; expirationTimestamp: number } | undefined>
  publishConsignment(consignment: RgbTransportConsignment): Promise<void>
  /** `undefined` means the receiver has not acknowledged the consignment yet. */
  getAcknowledgement?(consignment: RgbTransportConsignment): Promise<boolean | undefined>
  getConsignment?(input: {
    recipientId: string
    endpoints: string[]
    proxyPrivateKey?: string
  }): Promise<RgbReceivedConsignment | undefined>
  /** Optional extension for fetching several receive invoices from a trusted proxy in one request. */
  getConsignments?(
    input: Array<{
      recipientId: string
      endpoints: string[]
      proxyPrivateKey?: string
    }>
  ): Promise<RgbReceivedConsignment[]>
  /** Read-only check that at least one invoice endpoint has no consignment for this recipient ID. */
  checkConsignmentAvailability?(input: {
    recipientId: string
    endpoints: string[]
  }): Promise<boolean>
  acknowledgeConsignment?(input: {
    recipientId: string
    endpoints: string[]
    acknowledged: boolean
    proxyPrivateKey?: string
    proxyTransferId?: string
    proxySenderPublicKey?: string
    proxySenderEndpoint?: string
    proxyConsignmentHash?: string
  }): Promise<void>
  /** Clear an unreleased proxy v1 signed transaction before releasing local inputs. */
  cancelConsignment?(input: {
    proxyInvoiceId: string
    proxySenderPrivateKey: string
    endpoints: string[]
    allowMissing: boolean
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
    /** Atomic swaps may publish their consignment before buyer BTC signatures. */
    allowIncomplete?: boolean
  }): Promise<RgbCompletedTransfer>
}

export interface RgbServiceDependencies {
  storage: RgbStorage
  stateSource: RgbStateSource
  feeSource?: {
    getFeeFunding(wallet: RgbWalletRef): Promise<RgbFeeFunding>
  }
  encoder: RgbProtocolEncoder
  /** Local BFA/NIA v1 validation with Bitcoin status and optional EVM finality supplied by the host. */
  validateBfaConsignment?: (input: {
    wallet: RgbWalletRef
    payload: Uint8Array
    pendingWitnessTxid?: string
    allowPendingLastWitness?: boolean
    knownBlindSeals: import('./protocol/receive').RgbBlindSeal[]
  }) => Promise<import('./protocol/bfa-validator').ValidatedBfaConsignment>
  transport: RgbTransport
  broadcaster: BitcoinBroadcaster
  /**
   * Queues a recovery checkpoint after local state is durably encrypted at
   * rest. Critical state transitions may await its completion.
   */
  onStatePersisted?: (
    state: unknown,
    context: {
      reason: 'state_change' | 'retry_dirty' | 'retry_unverified'
      kind: 'normal' | 'replacement'
    }
  ) =>
    | void
    | {
        updatedAt?: number
        revision?: string
        generation?: number
        kind?: 'normal' | 'replacement'
        saved?: boolean
        verified?: boolean
        checksum?: string
        totalLength?: number
      }
    | Promise<
        | void
        | {
            updatedAt?: number
            revision?: string
            generation?: number
            kind?: 'normal' | 'replacement'
            saved?: boolean
            verified?: boolean
            checksum?: string
            totalLength?: number
          }
      >
  now?: () => number
}
