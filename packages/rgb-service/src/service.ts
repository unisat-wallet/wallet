import {
  RgbInvoiceUnavailableError,
  RgbInsufficientBalanceError,
  RgbServiceError,
  RgbTransferAwaitingAckError,
  RgbTransferCanceledError,
  RgbTransferRejectedError,
} from './errors'
import {
  appendRgbInvoiceRecipientNonce,
  decodeRgbInvoice,
  encodeWitnessRgbInvoice,
} from './protocol/invoice'
import { normalizeRgbAssetId, rgbContractIdHex } from './protocol/contract-id'
import {
  decodeNiaConsignment,
  niaConsignmentSpendableOutputScripts,
  validateNiaConsignmentParentSpends,
  validateNiaConsignmentParentState,
} from './protocol/nia-consignment'
import { mergeNiaConsignmentHistory } from './protocol/nia-history'
import { encodeNiaTransferConsignment } from './protocol/nia-contract'
import { concealBlindSeal, encodeBlindRgbInvoice } from './protocol/receive'
import { getSwapPsbtInputOutpoints } from './protocol/opret-transfer'
import { planFungibleTransition } from './protocol/transition'
import type {
  RgbCompletedTransfer,
  RgbFeePoolUtxo,
  RgbLocalAssetBalance,
  RgbLocalAssetDetail,
  RgbPreparedTransfer,
  RgbPendingIssue,
  RgbPendingAssetMetadata,
  RgbIssueHistoryItem,
  RgbPendingTransfer,
  RgbPendingUtxoSync,
  RgbOutpoint,
  RgbServiceDependencies,
  RgbServiceState,
  RgbTransferRequest,
  RgbUtxo,
  RgbValidationHistory,
  RgbWalletRef,
  RgbWalletSnapshot,
} from './types'

const STORAGE_PREFIX = 'rgb-service:v1:'
const MAX_RGB_AMOUNT = 0xffff_ffff_ffff_ffffn
const PROVIDER_ORIGIN_HISTORY_TTL_MS = 24 * 60 * 60 * 1000
// Keep these in sync with recovery checkpoint validation. Canonical history is
// wallet state, so accepting a history that cannot be restored would make the
// wallet locally usable only until its next recovery.
const MAX_RECOVERY_HISTORY_PAYLOAD_LENGTH = 48_000_000
const MAX_RECOVERY_HISTORY_OPERATION_IDS = 65_535

function outpointKey(utxo: RgbUtxo) {
  return `${utxo.outpoint.txid}:${utxo.outpoint.vout}`
}

function getSpendableAmount(utxo: RgbUtxo, assetId: string) {
  return utxo.allocations
    .filter(
      allocation => allocation.assetId === assetId && allocation.settled && allocation.spendable
    )
    .reduce((total, allocation) => total + BigInt(allocation.amount), 0n)
}

function isIncompleteLocalHistoryError(error: unknown) {
  return (
    error instanceof RgbServiceError &&
    error.message === 'RGB allocation parent Transition is missing from local history'
  )
}

/** RGB invoices use the shared `tb:` beneficiary prefix for Testnet and Testnet4. */
function isCompatibleInvoiceNetwork(
  invoiceNetwork: RgbWalletRef['network'],
  walletNetwork: RgbWalletRef['network']
) {
  const mainnetInvoiceNetworks: RgbWalletRef['network'][] = [
    'mainnet',
    'fractal-mainnet',
    'fractal-test',
  ]
  return (
    invoiceNetwork === walletNetwork ||
    (mainnetInvoiceNetworks.includes(invoiceNetwork) &&
      mainnetInvoiceNetworks.includes(walletNetwork)) ||
    ((invoiceNetwork === 'testnet' || invoiceNetwork === 'testnet4') &&
      (walletNetwork === 'testnet' || walletNetwork === 'testnet4'))
  )
}

/**
 * Local RGB wallet orchestration. The only remote calls are address-scoped
 * state sync and consignment transport; RGB transaction construction remains
 * in the injected local protocol encoder.
 */
export class RgbService {
  private readonly now: () => number
  private state?: RgbServiceState
  private syncInFlight?: Promise<RgbWalletSnapshot>
  private pendingTransferSyncInFlight?: Promise<void>
  private prepareSendInFlight?: Promise<void>
  /** Serialize mutation of each durable send state machine. */
  private readonly pendingTransferOperations = new Map<string, Promise<void>>()
  /** Receive polling and user actions mutate the same durable invoice list. */
  private pendingReceiveOperation: Promise<void> = Promise.resolve()
  private openedFromStorage = false
  private recoveryBackupEnabled = false

  constructor(private readonly dependencies: RgbServiceDependencies) {
    this.now = dependencies.now || (() => Date.now())
  }

  async open(wallet: RgbWalletRef) {
    const storageKey = this.storageKey(wallet)
    const stored = await this.dependencies.storage.get<RgbServiceState>(storageKey)
    this.openedFromStorage = Boolean(
      stored && stored.wallet.fundingAddress === wallet.fundingAddress
    )
    this.recoveryBackupEnabled =
      this.openedFromStorage &&
      stored?.recoveryRemoteStateKnown !== false &&
      !stored?.recoveryConflict
    this.state =
      stored && stored.wallet.fundingAddress === wallet.fundingAddress
        ? normalizeStateAssetIds(hydrateState(stored))
        : {
            version: 1,
            wallet,
            recoveryRemoteStateKnown: false,
            snapshot: { utxos: [], syncedAt: 0 },
            pending: {},
          }
    this.pruneExpiredProviderOrigins()
    this.hydrateStoredContractMetadata()
    // A local open must never upload before the controller has authenticated a
    // recovery read and obtained the checkpoint version used for CAS writes.
    await this.dependencies.storage.set(storageKey, persistState(this.requireState()))
  }

  /** True when encrypted extension storage already contained this wallet's RGB state. */
  wasOpenedFromStorage() {
    return this.openedFromStorage
  }

  /** A fresh wallet must complete a remote checkpoint read before it can mutate RGB state. */
  isRecoveryBackupEnabled() {
    return this.recoveryBackupEnabled
  }

  getRecoveryCheckpointVersion() {
    return this.requireState().recoveryCheckpointUpdatedAt
  }

  getRecoveryCheckpointRevision() {
    return this.requireState().recoveryCheckpointRevision
  }

  getRecoveryCheckpointGeneration() {
    return this.requireState().recoveryCheckpointGeneration
  }

  getRecoveryCheckpointKind() {
    return this.requireState().recoveryCheckpointKind
  }

  /** A verified normal checkpoint has no local state that needs a snapshot merge. */
  canAdoptNewerNormalRecoveryCheckpoint() {
    const state = this.requireState()
    return (
      state.recoveryCheckpoint?.dirty !== true &&
      state.recoveryCheckpoint?.verified === true &&
      state.recoveryConflict !== true &&
      state.recoveryCheckpointGeneration !== undefined
    )
  }

  hasRecoveryConflict() {
    return this.requireState().recoveryConflict === true
  }

  /**
   * Check whether a decrypted remote checkpoint contains exactly the durable
   * RGB state already held locally, ignoring installation-local recovery
   * delivery metadata. This heals the restart window where the remote upload
   * completed but its new revision was not yet written to extension storage.
   */
  matchesRecoveryState(recovery: unknown) {
    const current = this.requireState()
    if (!isRgbServiceState(recovery) || !sameRecoveryWallet(recovery.wallet, current.wallet)) {
      return false
    }
    try {
      const candidate = normalizeStateAssetIds(hydrateState(recovery))
      validateRecoveredState(candidate, current.wallet)
      return (
        stableRecoveryJson(comparableRecoveryState(recoverySnapshot(persistState(current)))) ===
        stableRecoveryJson(comparableRecoveryState(recoverySnapshot(persistState(candidate))))
      )
    } catch {
      return false
    }
  }

  getRecoveryCheckpointStatus() {
    const checkpoint = this.requireState().recoveryCheckpoint
    return {
      dirty: checkpoint?.dirty === true,
      verified: checkpoint?.verified === true,
      ...(checkpoint?.lastError ? { lastError: checkpoint.lastError } : {}),
    }
  }

  /**
   * Return the canonical, portable part of the local RGB state.  This is the
   * same state sent to the encrypted recovery backend, deliberately excluding
   * installation-local delivery cursors and dApp authorization metadata.
   */
  exportRecoveryState() {
    return recoverySnapshot(persistState(this.requireState()))
  }

  /** Validate a recovery candidate without changing local state. */
  canRestoreRecoveryState(recovery: unknown) {
    const current = this.requireState()
    if (!isRgbServiceState(recovery) || !sameRecoveryWallet(recovery.wallet, current.wallet)) {
      return false
    }
    try {
      validateRecoveredState(normalizeStateAssetIds(hydrateState(recovery)), current.wallet)
      return true
    } catch {
      return false
    }
  }

  async retryRecoveryCheckpoint(kind: 'normal' | 'replacement' = 'normal', force = false) {
    const state = this.requireState()
    if (!this.recoveryBackupEnabled || !this.dependencies.onStatePersisted) return false
    if (!force && !state.recoveryCheckpoint?.dirty && state.recoveryCheckpoint?.verified)
      return true
    await this.persist({ waitForRecovery: true, recoveryCheckpointKind: kind })
    return this.requireState().recoveryCheckpoint?.verified === true
  }

  async setRecoveryCheckpointVersion(updatedAt: number | undefined) {
    await this.recordRecoveryCheckpointVersion(updatedAt)
  }

  async setRecoveryCheckpointRevision(revision: string | undefined) {
    if (revision === undefined) return
    const state = this.requireState()
    if (state.recoveryCheckpointRevision === revision) return
    state.recoveryCheckpointRevision = revision
    await this.dependencies.storage.set(this.storageKey(state.wallet), persistState(state))
  }

  async setRecoveryCheckpointGeneration(generation: number | undefined) {
    if (generation === undefined) return
    const state = this.requireState()
    if (state.recoveryCheckpointGeneration === generation) return
    state.recoveryCheckpointGeneration = generation
    await this.dependencies.storage.set(this.storageKey(state.wallet), persistState(state))
  }

  async setRecoveryCheckpointKind(kind: 'normal' | 'replacement' | undefined) {
    if (kind === undefined) return
    const state = this.requireState()
    if (state.recoveryCheckpointKind === kind) return
    state.recoveryCheckpointKind = kind
    await this.dependencies.storage.set(this.storageKey(state.wallet), persistState(state))
  }

  /**
   * The recovery backend can explicitly report that this wallet has no
   * checkpoint (for example after its data was reset). Retain the local RGB
   * state, but discard the old compare-and-swap baseline and enqueue a fresh
   * upload once the controller has acquired the writer lease.
   */
  async requeueRecoveryCheckpointAfterRemoteReset() {
    const state = this.requireState()
    state.recoveryCheckpointUpdatedAt = undefined
    state.recoveryCheckpointRevision = undefined
    // A prior client version could classify this exact remote-empty case as
    // a cross-installation conflict. The authoritative empty response has now
    // been verified by the controller, so let the re-established checkpoint
    // clear that stale local fence.
    state.recoveryConflict = undefined
    state.recoveryCheckpoint = {
      ...state.recoveryCheckpoint,
      dirty: true,
      verified: false,
      lastError: 'remote recovery checkpoint was reset',
    }
    await this.dependencies.storage.set(this.storageKey(state.wallet), persistState(state))
  }

  async markRecoveryConflict() {
    const state = this.requireState()
    this.recoveryBackupEnabled = false
    state.recoveryConflict = true
    await this.dependencies.storage.set(this.storageKey(state.wallet), persistState(state))
  }

  /**
   * Prepare an explicitly user-approved local state to replace a conflicting
   * cloud checkpoint. The controller must acquire a fenced writer lease and
   * set the latest remote revision before calling this method; this only
   * clears the local safety fence and makes the next checkpoint write dirty.
   */
  async prepareLocalRecoveryConflictResolution() {
    const state = this.requireState()
    state.recoveryRemoteStateKnown = true
    state.recoveryConflict = undefined
    state.recoveryCheckpoint = {
      ...state.recoveryCheckpoint,
      dirty: true,
      verified: false,
      lastError: undefined,
    }
    this.recoveryBackupEnabled = true
    await this.dependencies.storage.set(this.storageKey(state.wallet), persistState(state))
  }

  needsRecoveryRestore() {
    const state = this.requireState()
    return (
      state.recoveryRemoteStateKnown !== true &&
      state.snapshot.syncedAt === 0 &&
      state.snapshot.utxos.length === 0 &&
      Object.keys(state.pending).length === 0 &&
      (state.pendingReceives?.length || 0) === 0 &&
      (state.receivedBlindSeals?.length || 0) === 0 &&
      Object.keys(state.contracts || {}).length === 0
    )
  }

  /**
   * Restore only a checkpoint bound to the exact wallet context currently
   * open.  The controller authenticates/decrypts the payload first; this is
   * the second boundary which prevents a valid checkpoint for another
   * network/account from being imported into this service.
   *
   * Keep the candidate out of `this.state` until its full JSON persistence
   * succeeds.  Extension storage can fail (quota, locked keyring, etc.); in
   * that case callers must retain the original live state unchanged.
   */
  async restoreRecoveryState(recovery: unknown) {
    const current = this.requireState()
    if (!isRgbServiceState(recovery) || !sameRecoveryWallet(recovery.wallet, current.wallet))
      return false
    try {
      const restored = normalizeStateAssetIds(hydrateState(recovery))
      // Provider ownership is a local browser authorization boundary. Never
      // accept it from a recovery checkpoint, even if an older/foreign client
      // included the field unexpectedly.
      stripProviderOrigins(restored)
      validateRecoveredState(restored, current.wallet)
      restored.recoveryRemoteStateKnown = true
      // Checkpoint delivery metadata is installation-local and must never be
      // accepted from a remote snapshot (including old snapshot formats).
      // The authenticated checkpoint itself is the verification. Do not mark
      // it dirty/unverified and immediately upload it again: a handoff may
      // have advanced the remote revision between the read and that redundant
      // write, falsely turning a successful restore into a CAS conflict.
      restored.recoveryCheckpoint = { dirty: false, verified: true }
      await this.dependencies.storage.set(this.storageKey(restored.wallet), persistState(restored))
      this.state = restored
      this.openedFromStorage = true
      this.recoveryBackupEnabled = true
      return true
    } catch {
      return false
    }
  }

  /** Enable checkpoints only after a successful remote read (including an empty result). */
  async enableRecoveryBackup() {
    const state = this.requireState()
    if (this.recoveryBackupEnabled && state.recoveryRemoteStateKnown === true) return
    state.recoveryRemoteStateKnown = true
    this.recoveryBackupEnabled = true
    await this.persist()
  }

  /**
   * Preserve a failed-read marker locally. This prevents an empty fresh
   * service from ever overwriting a checkpoint it has not successfully read.
   */
  async disableRecoveryBackup() {
    const state = this.requireState()
    this.recoveryBackupEnabled = false
    if (state.recoveryRemoteStateKnown === false) return
    state.recoveryRemoteStateKnown = false
    await this.dependencies.storage.set(this.storageKey(state.wallet), persistState(state))
  }

  private async recordRecoveryCheckpointVersion(updatedAt: number | undefined) {
    if (updatedAt === undefined) return
    const state = this.requireState()
    if (state.recoveryCheckpointUpdatedAt === updatedAt) return
    state.recoveryCheckpointUpdatedAt = updatedAt
    await this.dependencies.storage.set(this.storageKey(state.wallet), persistState(state))
  }

  async sync() {
    if (this.syncInFlight) return this.syncInFlight
    const sync = this.syncSnapshot()
    this.syncInFlight = sync
    try {
      return await sync
    } finally {
      if (this.syncInFlight === sync) this.syncInFlight = undefined
    }
  }

  private async syncSnapshot() {
    const state = this.requireState()
    if (this.pendingTransferSyncInFlight) await this.pendingTransferSyncInFlight
    // Keep allocations that have not reached the indexer from being overwritten
    // by a stale remote snapshot.
    if (this.hasPendingSnapshotProtection()) return state.snapshot
    // A remote snapshot may still expose consumed outpoints. Finish durable
    // post-broadcast delivery first, or leave the locally updated snapshot intact.
    if (Object.keys(state.pending).length) await this.advancePendingTransfers()
    const snapshot = normalizeSnapshot(
      await this.dependencies.stateSource.getSnapshot(state.wallet)
    )
    // Keep the local funding update while the indexer still returns the RGB
    // allocations that this installation already spent in a broadcast tx.
    // Once those outpoints disappear from the remote snapshot, it is safe to
    // accept the remote state again, even before the transfer is confirmed.
    if (this.hasStaleBroadcastedFundingOutpoints(snapshot)) return state.snapshot
    // The indexer is an eventually-consistent replica of wallet-owned state.
    // Before accepting an empty response, confirm that every locally retained
    // UTXO is terminal. This preserves state while an indexer is rebuilding,
    // but lets an authoritative empty snapshot remove externally spent RGB
    // allocations instead of retaining a phantom balance forever.
    if (
      snapshot.utxos.length === 0 &&
      state.snapshot.utxos.length > 0 &&
      !(await this.areLocalSnapshotUtxosTerminal())
    ) {
      return state.snapshot
    }
    // Indexers commonly advance syncedAt on every response even if neither
    // UTXOs nor allocations changed. Keep that local freshness marker, but
    // do not turn polling into a full encrypted checkpoint upload.
    const checkpointSnapshotChanged = !sameSnapshotContents(state.snapshot, snapshot)
    state.snapshot = snapshot
    await this.persist({ skipRecovery: !checkpointSnapshotChanged })
    return state.snapshot
  }

  private hasStaleBroadcastedFundingOutpoints(snapshot: RgbWalletSnapshot) {
    const state = this.requireState()
    const spentOutpoints = new Set(
      (state.pendingSendHistory || [])
        .filter(item => item.status === 'broadcasted')
        .flatMap(item => item.spentOutpoints || [])
        .map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
    )
    return (
      spentOutpoints.size > 0 && snapshot.utxos.some(utxo => spentOutpoints.has(outpointKey(utxo)))
    )
  }

  private async areLocalSnapshotUtxosTerminal() {
    const state = this.requireState()
    const getTransactionStatus = this.dependencies.stateSource.getTransactionStatus
    if (!getTransactionStatus) return false

    const txids = [
      ...new Set(
        state.snapshot.utxos
          .filter(utxo => utxo.chainStatus !== 'spent' && utxo.chainStatus !== 'replaced')
          .map(utxo => utxo.outpoint.txid)
      ),
    ]
    try {
      const statuses = await Promise.all(
        txids.map(txid => getTransactionStatus(state.wallet, txid))
      )
      return statuses.every(status => status.status === 'spent' || status.status === 'replaced')
    } catch {
      // A failed status lookup is indistinguishable from an indexer outage;
      // retain local allocations until a later authoritative confirmation.
      return false
    }
  }

  /** Observe sender ACKs and already-broadcast transfers without fetching the full UTXO snapshot. */
  async syncPendingTransfers() {
    if (this.syncInFlight) {
      await this.syncInFlight
      return
    }
    if (this.pendingTransferSyncInFlight) return this.pendingTransferSyncInFlight
    const sync = this.advancePendingTransfers()
    this.pendingTransferSyncInFlight = sync
    try {
      await sync
    } finally {
      if (this.pendingTransferSyncInFlight === sync) this.pendingTransferSyncInFlight = undefined
    }
  }

  private async advancePendingTransfers() {
    const state = this.requireState()
    for (const transferId of Object.keys(state.pending)) {
      await this.runPendingTransferOperation(transferId, async () => {
        const pending = state.pending[transferId]
        if (!pending) return
        try {
          if (pending.broadcast) await this.syncBroadcastedTransfer(transferId, pending)
          else if (pending.delivery?.externalBroadcast)
            await this.syncExternallyBroadcastTransfer(transferId, pending)
          else if (pending.delivery && !pending.delivery.requiresCounterpartySignature)
            await this.advancePendingDelivery(transferId, pending)
        } catch (error) {
          // A delivery awaiting its recipient is a durable local state, not a
          // wallet-wide sync failure. A rejection has already removed its
          // pending transfer and recorded history, so later work can continue too.
          if (
            error instanceof RgbTransferAwaitingAckError ||
            error instanceof RgbTransferRejectedError ||
            error instanceof RgbTransferCanceledError
          ) {
            return
          }
          throw error
        }
      })
    }
  }

  async createBlindReceive(input: {
    assetId?: string
    amount?: string
    durationSeconds?: number
    /** The caller will immediately claim the recipient and persist the combined state. */
    deferRecoveryCheckpoint?: boolean
  }) {
    const state = this.requireState()
    if (!state.snapshot.syncedAt) await this.sync()
    const assetId = input.assetId ? normalizeAssetId(input.assetId) : undefined
    if (input.amount !== undefined && !assetId) {
      throw new RgbServiceError('A fixed RGB receive amount requires an asset ID')
    }
    if (input.amount !== undefined && !/^(0|[1-9][0-9]*)$/.test(input.amount)) {
      throw new RgbServiceError('RGB receive amount must be an unsigned integer')
    }
    if (input.amount !== undefined && BigInt(input.amount) > MAX_RGB_AMOUNT) {
      throw new RgbServiceError('RGB receive amount exceeds the maximum u64 value')
    }
    const now = this.now()
    const expirationTimestamp =
      input.durationSeconds === undefined
        ? undefined
        : Math.floor(now / 1000) + input.durationSeconds
    if (
      input.durationSeconds !== undefined &&
      (!Number.isInteger(input.durationSeconds) || input.durationSeconds <= 0)
    ) {
      throw new RgbServiceError('RGB receive duration must be positive')
    }
    const receives = state.pendingReceives || (state.pendingReceives = [])
    const transportEndpoints = this.dependencies.transport.getEndpoints?.() || []
    if (!transportEndpoints.length) {
      throw new RgbServiceError('RGB proxy endpoint is not configured')
    }
    // A newly broadcast funding output can reserve a blind seal immediately,
    // but callers must keep its invoice unavailable until confirmation.
    const utxo = this.getAvailableReceiveUtxos()[0] || this.getPendingConfirmationReceiveUtxos()[0]
    if (!utxo) throw new RgbServiceError('No unallocated RGB funding UTXO is available for receive')
    const seal = { txid: utxo.outpoint.txid, vout: utxo.outpoint.vout, blinding: randomU64() }
    const invoice = encodeBlindRgbInvoice({
      network: state.wallet.network,
      seal,
      assetId,
      amount: input.amount,
      expirationTimestamp,
      transportEndpoints,
    })
    const recipientId = decodeRgbInvoice(invoice).recipientId
    const pending = {
      invoice,
      recipientId,
      assetId,
      amount: input.amount,
      expirationTimestamp,
      createdAt: now,
      seal,
    }
    const rollback = snapshotState(state)
    receives.push(pending)
    await this.persistWithRecoveryRollback(rollback, {
      skipRecovery: input.deferRecoveryCheckpoint === true,
    })
    return pending
  }

  /**
   * Create a witness invoice against the wallet's existing RGB funding script.
   * Unlike a blind invoice, no pre-existing UTXO is reserved: the sender
   * creates the output and its real outpoint is learned from the consignment.
   */
  async createWitnessReceive(input: {
    scriptPubKey: string
    publicKey: string
    assetId?: string
    amount?: string
    durationSeconds?: number
    deferRecoveryCheckpoint?: boolean
  }) {
    const state = this.requireState()
    const assetId = input.assetId ? normalizeAssetId(input.assetId) : undefined
    if (input.amount !== undefined && !assetId) {
      throw new RgbServiceError('A fixed RGB receive amount requires an asset ID')
    }
    if (input.amount !== undefined && !/^(0|[1-9][0-9]*)$/.test(input.amount)) {
      throw new RgbServiceError('RGB receive amount must be an unsigned integer')
    }
    if (input.amount !== undefined && BigInt(input.amount) > MAX_RGB_AMOUNT) {
      throw new RgbServiceError('RGB receive amount exceeds the maximum u64 value')
    }
    if (
      input.durationSeconds !== undefined &&
      (!Number.isInteger(input.durationSeconds) || input.durationSeconds <= 0)
    ) {
      throw new RgbServiceError('RGB receive duration must be positive')
    }
    const endpoints = this.dependencies.transport.getEndpoints?.() || []
    if (!endpoints.length) throw new RgbServiceError('RGB proxy endpoint is not configured')
    const nonce = randomBytes(16)
    const transportEndpoints = endpoints.map(endpoint =>
      appendRgbInvoiceRecipientNonce(endpoint, nonce)
    )
    const now = this.now()
    const expirationTimestamp =
      input.durationSeconds === undefined
        ? undefined
        : Math.floor(now / 1000) + input.durationSeconds
    const invoice = encodeWitnessRgbInvoice({
      network: state.wallet.network,
      scriptPubKey: input.scriptPubKey,
      assetId,
      amount: input.amount,
      expirationTimestamp,
      transportEndpoints,
    })
    const decoded = decodeRgbInvoice(invoice)
    if (decoded.recipientType !== 'witness')
      throw new RgbServiceError('RGB witness invoice is invalid')
    const pending = {
      invoice,
      recipientId: decoded.recipientId,
      proxyRecipientId: decoded.proxyRecipientId,
      recipientType: 'witness' as const,
      witnessScriptPubKey: input.scriptPubKey.toLowerCase(),
      witnessPublicKey: input.publicKey.toLowerCase(),
      assetId,
      amount: input.amount,
      expirationTimestamp,
      createdAt: now,
    }
    const rollback = snapshotState(state)
    ;(state.pendingReceives || (state.pendingReceives = [])).push(pending)
    await this.persistWithRecoveryRollback(rollback, {
      skipRecovery: input.deferRecoveryCheckpoint === true,
    })
    return pending
  }

  getPendingReceives() {
    const now = Math.floor(this.now() / 1000)
    return (this.requireState().pendingReceives || []).filter(
      // Expiration prevents new consignments from being accepted, but it must
      // not stop an already accepted transfer from being monitored until its
      // Bitcoin transaction settles.
      item =>
        !item.expirationTimestamp ||
        item.expirationTimestamp > now ||
        item.receivedConsignment?.accepted === true ||
        item.receivedConsignment?.acknowledgementPending === true
    )
  }

  /** Fill the signing key omitted by witness invoices created before v1 support shipped. */
  async backfillWitnessReceivePublicKey(publicKey: string) {
    if (!/^[0-9a-f]{66}$/i.test(publicKey)) {
      throw new RgbServiceError('RGB witness funding public key is invalid')
    }
    let changed = false
    for (const receive of this.requireState().pendingReceives || []) {
      if (receive.recipientType !== 'witness' || receive.witnessPublicKey) continue
      receive.witnessPublicKey = publicKey.toLowerCase()
      changed = true
    }
    if (changed) await this.persist({ waitForRecovery: true })
    return { changed }
  }

  getPendingReceiveHistory() {
    const state = this.requireState()
    const receives = state.pendingReceives || []
    return (state.pendingReceiveHistory || []).map(item => {
      if (item.assetId && item.amount && item.precision !== undefined) return item
      const recipientId = item.transferId.replace(/^receive:/, '')
      const receive = receives.find(candidate => candidate.recipientId === recipientId)
      const assetId =
        receive?.receivedConsignment?.assetId ?? receive?.pendingAccept?.assetId ?? receive?.assetId
      const amount =
        receive?.receivedConsignment?.amount ?? receive?.pendingAccept?.amount ?? receive?.amount
      const precision = receive?.receivedConsignment?.precision ?? receive?.pendingAccept?.precision
      return {
        ...item,
        ...(assetId ? { assetId } : {}),
        ...(amount ? { amount } : {}),
        ...(precision === undefined ? {} : { precision }),
      }
    })
  }

  getPendingUtxoSync() {
    return this.requireState().pendingUtxoSync
  }

  getPendingIssues() {
    return this.requireState().pendingIssues || []
  }

  /** Self-issued assets have no inbound consignment, so retain their history locally. */
  getIssueHistory() {
    const state = this.requireState()
    return (state.issueHistory || []).map(issue => {
      const genesisUtxo = state.snapshot.utxos.find(
        utxo =>
          utxo.outpoint.txid === issue.txid &&
          utxo.allocations.some(allocation => allocation.assetId === issue.assetId)
      )
      return genesisUtxo?.chainStatus ? { ...issue, chainStatus: genesisUtxo.chainStatus } : issue
    })
  }

  async markUtxoSyncCompleted(txid: string) {
    const state = this.requireState()
    if (!state.pendingUtxoSync || state.pendingUtxoSync.txid !== txid) return
    delete state.pendingUtxoSync
    await this.persist()
  }

  async markIssueSynced(assetId: string) {
    const state = this.requireState()
    const normalized = normalizeAssetId(assetId)
    const pending = state.pendingIssues || []
    const next = pending.filter(issue => issue.assetId !== normalized)
    if (next.length === pending.length) return
    state.pendingIssues = next
    await this.persist()
  }

  getPendingAssetMetadata() {
    return this.requireState().pendingAssetMetadata || []
  }

  async markAssetMetadataSynced(assetId: string) {
    const state = this.requireState()
    const normalized = normalizeAssetId(assetId)
    const pending = state.pendingAssetMetadata || []
    const next = pending.filter(item => item.assetId !== normalized)
    let markedReceive = false
    for (const receive of state.pendingReceives || []) {
      const receivedAssetId = receive.receivedConsignment?.assetId
      const pendingAssetId = receive.pendingAccept?.assetId
      if (
        !receive.assetMetadataIndexed &&
        (pendingAssetId === normalized || receivedAssetId === normalized)
      ) {
        receive.assetMetadataIndexed = true
        markedReceive = true
      }
    }
    if (next.length === pending.length && !markedReceive) return
    state.pendingAssetMetadata = next
    await this.persist()
  }

  /** Keep newly broadcast funding outputs usable while the address indexer catches up. */
  async queueUtxoSync(input: RgbPendingUtxoSync) {
    const state = this.requireState()
    const utxosByOutpoint = new Map(state.snapshot.utxos.map(utxo => [outpointKey(utxo), utxo]))
    for (const utxo of input.outpoints) {
      utxosByOutpoint.set(outpointKey(utxo), {
        ...utxo,
        chainStatus: utxo.chainStatus || 'mempool',
      })
    }
    const utxos = normalizeSnapshot({
      syncedAt: state.snapshot.syncedAt || this.now(),
      utxos: [...utxosByOutpoint.values()],
    }).utxos
    state.snapshot = {
      utxos,
      syncedAt: state.snapshot.syncedAt || this.now(),
    }
    state.pendingUtxoSync = { txid: input.txid, outpoints: utxos }
    // The Bitcoin transaction is already broadcast, so rolling this state
    // back would lose the only local record of its RGB-capable outputs. Make
    // the caller wait for recovery instead of reporting success early.
    await this.persist({ waitForRecovery: true })
  }

  /** Persist a local issue and its allocation before contacting the indexer. */
  async queueIssue(input: {
    assetId: string
    contract: Uint8Array
    genesis: Uint8Array
    asset: RgbPendingIssue['asset']
    utxoSync: RgbPendingUtxoSync
  }) {
    const state = this.requireState()
    const rollback = snapshotState(state)
    const assetId = normalizeAssetId(input.assetId)
    const contracts = state.contracts || (state.contracts = {})
    contracts[assetId] = {
      consignment: Buffer.from(input.contract).toString('base64'),
      genesis: Buffer.from(input.genesis).toString('base64'),
      metadata: input.asset,
      createdAt: this.now(),
    }
    const utxos = normalizeSnapshot({
      syncedAt: state.snapshot.syncedAt,
      utxos: input.utxoSync.outpoints,
    }).utxos
    state.snapshot = { ...state.snapshot, utxos }
    const pending = state.pendingIssues || (state.pendingIssues = [])
    const task: RgbPendingIssue = {
      assetId,
      contract: Buffer.from(input.contract).toString('base64'),
      genesis: Buffer.from(input.genesis).toString('base64'),
      asset: input.asset,
      utxoSync: { txid: input.utxoSync.txid, outpoints: utxos },
    }
    const index = pending.findIndex(issue => issue.assetId === assetId)
    if (index >= 0) pending[index] = task
    else pending.push(task)
    const history = state.issueHistory || (state.issueHistory = [])
    const historyItem: RgbIssueHistoryItem = {
      assetId,
      amount: input.asset.issuedSupply,
      txid: input.utxoSync.txid,
      createdAt: this.now(),
      asset: input.asset,
      chainStatus: utxos.find(
        utxo =>
          utxo.outpoint.txid === input.utxoSync.txid &&
          utxo.allocations.some(allocation => allocation.assetId === assetId)
      )?.chainStatus,
    }
    const historyIndex = history.findIndex(item => item.assetId === assetId)
    if (historyIndex >= 0) history[historyIndex] = historyItem
    else history.push(historyItem)
    await this.persistWithRecoveryRollback(rollback)
  }

  getPendingSendHistory() {
    return this.requireState().pendingSendHistory || []
  }

  async markSendHistoryConfirmed(transferId: string) {
    const state = this.requireState()
    const history = state.pendingSendHistory || []
    const next = history.filter(item => item.transferId !== transferId)
    if (next.length === history.length) return
    state.pendingSendHistory = next
    await this.persist()
  }

  async markReceiveHistorySynced(transferId: string) {
    const state = this.requireState()
    const history = state.pendingReceiveHistory || []
    const next = history.filter(item => item.transferId !== transferId)
    if (next.length === history.length) return
    state.pendingReceiveHistory = next
    await this.persist()
  }

  getKnownBlindSeals() {
    const state = this.requireState()
    const seals = [
      ...this.getPendingReceives().flatMap(receive => (receive.seal ? [receive.seal] : [])),
      ...(state.receivedBlindSeals || []),
    ]
    return seals.filter(
      (seal, index) => !seals.slice(0, index).some(candidate => sameBlindSeal(candidate, seal))
    )
  }

  /** Funding UTXOs reserved by active blind invoices cannot back another invoice. */
  getAvailableReceiveUtxos() {
    return this.getUnallocatedReceiveUtxos('confirmed')
  }

  getPendingConfirmationReceiveUtxos() {
    return this.getUnallocatedReceiveUtxos('mempool')
  }

  /**
   * Funding UTXOs for a new NIA Genesis must not consume a blind seal that is
   * still advertised by an active receive invoice. A blind invoice reserves
   * its outpoint even though it has no RGB allocation yet.
   */
  getAvailableIssueUtxos() {
    const reserved = this.getPendingReceiveOutpoints()
    return this.requireState().snapshot.utxos.filter(
      utxo =>
        (utxo.chainStatus === 'confirmed' || utxo.chainStatus === 'mempool') &&
        utxo.allocations.length === 0 &&
        !reserved.has(outpointKey(utxo))
    )
  }

  private getUnallocatedReceiveUtxos(chainStatus: RgbUtxo['chainStatus']) {
    const reserved = this.getPendingReceiveOutpoints()
    return this.requireState().snapshot.utxos.filter(
      utxo =>
        utxo.chainStatus === chainStatus &&
        utxo.allocations.length === 0 &&
        !reserved.has(outpointKey(utxo))
    )
  }

  private getPendingReceiveOutpoints() {
    return new Set(
      this.getPendingReceives()
        .filter(
          (receive): receive is typeof receive & { seal: NonNullable<typeof receive.seal> } =>
            !!receive.seal
        )
        .map(receive => `${receive.seal.txid}:${receive.seal.vout}`)
    )
  }

  async processClaimedReceives({
    includeClaimed = true,
    deferConfirmedSettlement = false,
  }: { includeClaimed?: boolean; deferConfirmedSettlement?: boolean } = {}) {
    return this.runPendingReceiveOperation(() =>
      this.processClaimedReceivesOnce({ includeClaimed, deferConfirmedSettlement })
    )
  }

  private async processClaimedReceivesOnce({
    includeClaimed,
    deferConfirmedSettlement,
  }: {
    includeClaimed: boolean
    deferConfirmedSettlement: boolean
  }) {
    const state = this.requireState()
    const rollback = snapshotState(state)
    const getClaimed = this.dependencies.stateSource.getClaimedConsignments
    let received: Array<{ recipientId: string; payload: string }> = []
    if (includeClaimed) {
      try {
        received = getClaimed ? await getClaimed(state.wallet) : []
      } catch (error) {
        if (!this.dependencies.transport.getConsignment) throw error
      }
    }
    const proxyReceived = await this.getProxyConsignments()
    const receivedItems: Array<{
      recipientId: string
      payload: string
      txid?: string
      endpoint?: string
    }> = [...received, ...proxyReceived]
    const pending = state.pendingReceives || []
    // Once ACK intent is durable, the consignment itself is a local receipt.
    // Prefer it over refetching from transport so proxy cleanup or an
    // extension restart cannot prevent acknowledgement or chain settlement.
    const localReceipts = pending.flatMap(receive => {
      const receipt = receive.receivedConsignment
      return (receipt?.accepted || receipt?.acknowledgementPending) && receipt.payload
        ? [
            {
              recipientId: receive.proxyRecipientId || receive.recipientId,
              payload: receipt.payload,
              txid: receipt.txid,
              endpoint: receipt.endpoint,
            },
          ]
        : []
    })
    const receivedByRecipient = new Map(
      [...receivedItems, ...localReceipts].map(item => [item.recipientId, item])
    )
    const itemsToProcess = [...receivedByRecipient.values()]
    let count = 0
    let changed = false
    let snapshotRequired = false

    // Detect sender cancel for consignments already staged for manual accept.
    for (let index = pending.length - 1; index >= 0; index--) {
      const receive = pending[index]!
      if (!receive.pendingAccept || receive.receivedConsignment) continue
      const canceled = await this.isReceiveCanceledBySender(receive)
      if (!canceled) continue
      this.recordReceiveOutcome(receive, 'canceled', receive.pendingAccept.txid)
      pending.splice(index, 1)
      changed = true
    }

    for (const item of itemsToProcess) {
      const receiveIndex = pending.findIndex(
        receive => (receive.proxyRecipientId || receive.recipientId) === item.recipientId
      )
      if (receiveIndex < 0) continue
      const receive = pending[receiveIndex]!
      try {
        const match = this.validateIncomingConsignment(receive, item)
        if (!match) {
          await this.rejectInvalidProxyConsignment(receive, item)
          pending.splice(receiveIndex, 1)
          changed = true
          continue
        }
        if (receive.rejectedConsignmentTxids?.includes(match.txid)) continue

        const metadataChanged = receive.assetMetadataIndexed
          ? false
          : this.queueAssetMetadata(match.assetId, match.decoded.metadata)
        changed = metadataChanged || changed
        const precision = match.decoded.metadata.precision
        if (receive.receivedConsignment && receive.receivedConsignment.precision !== precision) {
          receive.receivedConsignment.precision = precision
          changed = true
        }

        // The proxy may have accepted ACK immediately before an extension
        // shutdown. Reconcile that durable local intent before treating any
        // missing proxy payload as sender cancellation.
        if (receive.receivedConsignment?.acknowledgementPending) {
          const acknowledgement = await this.getProxyAcknowledgement(receive, item.endpoint)
          if (acknowledgement === true) {
            receive.receivedConsignment.accepted = true
            delete receive.receivedConsignment.acknowledgementPending
            delete receive.pendingAccept
            changed = true
          } else if (acknowledgement === undefined) {
            // The durable intent makes ACK retries safe. A request failure is
            // not evidence of sender cancellation, so leave the receipt for
            // the next polling cycle without sending a compensating NACK.
            try {
              await this.acknowledgeProxyConsignment(item, true)
            } catch {
              continue
            }
            receive.receivedConsignment.accepted = true
            delete receive.receivedConsignment.acknowledgementPending
            delete receive.pendingAccept
            changed = true
          } else {
            this.recordReceiveOutcome(receive, 'canceled', match.txid)
            pending.splice(receiveIndex, 1)
            changed = true
            continue
          }
        }

        // Before acceptance, an explicit proxy rejection can release the
        // invoice. An accepted receipt waits for chain settlement or a
        // reviewed backend cancellation.
        if (
          !receive.receivedConsignment?.accepted &&
          !receive.receivedConsignment?.acknowledgementPending &&
          (await this.isProxyAckRejected(receive, item.endpoint))
        ) {
          this.recordReceiveOutcome(receive, 'canceled', match.txid)
          pending.splice(receiveIndex, 1)
          changed = true
          continue
        }

        // Already accepted by the user: advance chain confirmation / settlement.
        if (receive.receivedConsignment?.accepted) {
          if (await this.isAcceptedReceiveTerminallyCanceled(receive)) {
            this.recordReceiveOutcome(receive, 'canceled', match.txid)
            pending.splice(receiveIndex, 1)
            changed = true
            continue
          }
          const broadcastDetectedAt = receive.receivedConsignment.broadcastDetectedAt
          const settled = await this.advanceAcceptedReceive(
            receive,
            item,
            match,
            deferConfirmedSettlement
          )
          if (settled === 'snapshot_required') {
            snapshotRequired = true
            changed = true
            continue
          }
          if (settled) {
            pending.splice(receiveIndex, 1)
            count++
            changed = true
          } else if (!broadcastDetectedAt && receive.receivedConsignment.broadcastDetectedAt) {
            changed = true
          }
          continue
        }

        // Stage for explicit Accept/Reject — do not ACK yet.
        if (
          !receive.pendingAccept ||
          receive.pendingAccept.txid !== match.txid ||
          receive.pendingAccept.payload !== item.payload ||
          receive.pendingAccept.precision !== precision
        ) {
          receive.pendingAccept = {
            payload: item.payload,
            txid: match.txid,
            endpoint: item.endpoint,
            assetId: match.assetId,
            amount: match.amount,
            precision,
            discoveredAt: receive.receivedConsignment?.receivedAt || this.now(),
            counterpartyScriptPubKeys: niaConsignmentSpendableOutputScripts(item.payload),
          }
          // `assetId` and `amount` are the invoice's original constraints.
          // An Any Asset / Any Amount invoice must remain unconstrained after
          // inspecting or rejecting a proposed consignment. The offered
          // asset and amount live only in `pendingAccept` until ACK.
          if (receive.receivedConsignment && !receive.receivedConsignment.accepted) {
            delete receive.receivedConsignment
          }
          changed = true
        }
      } catch (error) {
        if (receive.receivedConsignment?.accepted) {
          // ACK is immutable once accepted. A local settlement failure (for
          // example, while merging recovered history) is retriable and must
          // never turn a successfully acknowledged transfer into a NACK or a
          // user-visible rejected receive.
          continue
        }
        // A malformed or mismatched consignment must not keep an invoice in a
        // failing polling loop. NACK it when possible; if the proxy already
        // made its ACK immutable, archive the unusable local receive anyway.
        try {
          await this.rejectInvalidProxyConsignment(receive, item)
        } catch {
          throw error
        }
        pending.splice(receiveIndex, 1)
        changed = true
      }
    }
    if (changed) {
      // Confirmed receives add the blind seal, consignment and contract that
      // are needed to prove ownership and later spend the allocation.
      await this.persistWithRecoveryRollback(rollback)
    }
    return { received: count, snapshotRequired }
  }

  async acceptReceive(recipientId: string) {
    return this.runPendingReceiveOperation(() => this.acceptReceiveOnce(recipientId))
  }

  private async acceptReceiveOnce(recipientId: string) {
    const state = this.requireState()
    const pending = state.pendingReceives || []
    const receive = pending.find(
      item => item.recipientId === recipientId || item.proxyRecipientId === recipientId
    )
    // A stale detail sheet or a retried RPC can repeat Accept after the durable
    // ACK transition completed. Treat that as success instead of reopening the
    // action or reporting a misleading "not awaiting acceptance" error.
    if (receive?.receivedConsignment?.accepted) {
      return { accepted: true, status: 'accepted' as const }
    }
    if (!receive?.pendingAccept) {
      throw new RgbServiceError(`RGB receive ${recipientId} is not awaiting acceptance`)
    }
    if (
      !receive.receivedConsignment?.acknowledgementPending &&
      (await this.isReceiveCanceledBySender(receive))
    ) {
      this.recordReceiveOutcome(receive, 'canceled', receive.pendingAccept.txid)
      state.pendingReceives = pending.filter(item => item !== receive)
      await this.persist()
      return { accepted: false, status: 'canceled' as const }
    }

    const item = {
      recipientId: receive.proxyRecipientId || receive.recipientId,
      payload: receive.pendingAccept.payload,
      txid: receive.pendingAccept.txid,
      endpoint: receive.pendingAccept.endpoint,
    }
    const acknowledgementWasPending = receive.receivedConsignment?.acknowledgementPending === true
    if (!acknowledgementWasPending) {
      // Persist the local receipt before ACK. If the extension stops after
      // the proxy accepts it, recovery can reconcile ACK=true without losing
      // the payload needed for settlement.
      receive.receivedConsignment = {
        txid: receive.pendingAccept.txid,
        receivedAt: this.now(),
        assetId: receive.pendingAccept.assetId,
        amount: receive.pendingAccept.amount,
        precision: receive.pendingAccept.precision,
        acknowledgementPending: true,
        payload: receive.pendingAccept.payload,
        endpoint: receive.pendingAccept.endpoint,
        counterpartyScriptPubKeys: receive.pendingAccept.counterpartyScriptPubKeys,
      }
      await this.persist({ waitForRecovery: true })
    }
    if (acknowledgementWasPending) {
      const acknowledgement = await this.getProxyAcknowledgement(receive, item.endpoint)
      if (acknowledgement === true) {
        receive.receivedConsignment!.accepted = true
        delete receive.receivedConsignment!.acknowledgementPending
        delete receive.pendingAccept
        await this.persist({ waitForRecovery: true })
        return { accepted: true, status: 'accepted' as const }
      }
      if (acknowledgement === false) {
        this.recordReceiveOutcome(receive, 'canceled', receive.pendingAccept.txid)
        state.pendingReceives = pending.filter(item => item !== receive)
        await this.persist()
        return { accepted: false, status: 'canceled' as const }
      }
    }
    await this.acknowledgeProxyConsignment(item, true)
    receive.receivedConsignment!.accepted = true
    delete receive.receivedConsignment!.acknowledgementPending
    delete receive.pendingAccept
    await this.persist({ waitForRecovery: true })

    // The sender cannot broadcast until this ACK returns, so settlement is
    // deferred to the next receive refresh instead of fetching the same
    // consignment and acknowledgement again immediately.
    return { accepted: true, status: 'accepted' as const }
  }

  async rejectReceive(recipientId: string) {
    return this.runPendingReceiveOperation(() => this.rejectReceiveOnce(recipientId))
  }

  private async rejectReceiveOnce(recipientId: string) {
    const state = this.requireState()
    const pending = state.pendingReceives || []
    const receive = pending.find(
      item => item.recipientId === recipientId || item.proxyRecipientId === recipientId
    )
    if (!receive) throw new RgbServiceError(`RGB receive ${recipientId} was not found`)
    const pendingAccept = receive.pendingAccept
    if (!pendingAccept && !receive.receivedConsignment) {
      throw new RgbServiceError(`RGB receive ${recipientId} is not awaiting acceptance`)
    }
    // Once ACK intent is durable, the proxy may already have accepted it and
    // allowed the sender to broadcast. Rejecting or releasing it would discard
    // the receipt required for settlement.
    if (
      receive.receivedConsignment?.accepted ||
      receive.receivedConsignment?.acknowledgementPending
    ) {
      throw new RgbServiceError(`RGB receive ${recipientId} was already accepted`)
    }

    await this.acknowledgeProxyConsignment(
      {
        recipientId: receive.proxyRecipientId || receive.recipientId,
        endpoint: pendingAccept!.endpoint,
      },
      false
    )
    this.recordReceiveOutcome(receive, 'rejected', pendingAccept!.txid)
    // Proxy recipient IDs are single-use upload keys. Once a consignment has
    // been posted, a later transfer cannot replace its file even after NACK.
    // Discard the invoice so the user creates a fresh blinded recipient ID.
    state.pendingReceives = pending.filter(item => item !== receive)
    await this.persist()
    return { rejected: true }
  }

  /**
   * Cancels a receive that was ACKed for a swap which both parties have
   * explicitly abandoned before it can settle on Bitcoin.  This is deliberately
   * separate from rejectReceive: the proxy ACK is immutable, so retain a
   * canceled history entry as a tombstone and never credit this receipt.
   */
  async abandonAcceptedReceive(recipientId: string) {
    return this.runPendingReceiveOperation(() => this.abandonAcceptedReceiveOnce(recipientId))
  }

  private async abandonAcceptedReceiveOnce(recipientId: string) {
    const state = this.requireState()
    const pending = state.pendingReceives || []
    const receive = pending.find(
      item => item.recipientId === recipientId || item.proxyRecipientId === recipientId
    )
    if (!receive?.receivedConsignment?.accepted) {
      throw new RgbServiceError(`RGB receive ${recipientId} is not an accepted pending receive`)
    }
    this.recordReceiveOutcome(receive, 'canceled', receive.receivedConsignment.txid)
    state.pendingReceives = pending.filter(item => item !== receive)
    await this.persist({ waitForRecovery: true })
    return { abandoned: true, recipientId }
  }

  private validateIncomingConsignment(
    receive: import('./types').RgbPendingReceive,
    item: { recipientId: string; payload: string; txid?: string; endpoint?: string }
  ) {
    const decoded = decodeNiaConsignment(Uint8Array.from(Buffer.from(item.payload, 'base64')))
    validateNiaConsignmentParentSpends(decoded)
    if (receive.recipientType === 'witness') {
      const expectedScript = receive.witnessScriptPubKey?.toLowerCase()
      if (!expectedScript) return undefined
      const match = decoded.witnessBundles
        .flatMap(witness =>
          witness.transitions.flatMap(transition =>
            transition.assignments.map((assignment, assignmentIndex) => ({
              witness,
              transition,
              assignment,
              assignmentIndex,
            }))
          )
        )
        .find(({ witness, assignment }) => {
          if ('secretSeal' in assignment.seal) return false
          const txid = assignment.seal.txid || witness.txid
          const output = witness.outputs[assignment.seal.vout]
          return (
            txid === witness.txid &&
            output?.scriptPubKey.toLowerCase() === expectedScript &&
            (item.txid === undefined || witness.txid === item.txid)
          )
        })
      if (
        !match ||
        'secretSeal' in match.assignment.seal ||
        (item.txid !== undefined && match.witness.txid !== item.txid)
      )
        return undefined
      if (
        (receive.assetId && receive.assetId !== decoded.assetId) ||
        (receive.amount && receive.amount !== match.assignment.amount.toString())
      ) {
        return undefined
      }
      return {
        decoded,
        match,
        witness: match.witness,
        assetId: decoded.assetId,
        amount: match.assignment.amount.toString(),
        txid: match.witness.txid,
        vout: match.assignment.seal.vout,
        opId: match.transition.opId,
        assignmentIndex: match.assignmentIndex,
      }
    }
    if (!receive.seal) return undefined
    const secretSeal = Buffer.from(concealBlindSeal(receive.seal)).toString('hex')
    const terminalBundleIds = new Set(
      decoded.terminals
        .filter(terminal => terminal.secretSeals.includes(secretSeal))
        .map(terminal => terminal.bundleId)
    )
    const match = decoded.witnessBundles
      .filter(bundle => terminalBundleIds.has(bundle.bundleId))
      .flatMap(bundle => bundle.transitions)
      .flatMap(transition =>
        transition.assignments.map((assignment, assignmentIndex) => ({
          transition,
          assignment,
          assignmentIndex,
        }))
      )
      .find(
        ({ assignment }) =>
          'secretSeal' in assignment.seal && assignment.seal.secretSeal === secretSeal
      )
    const witness = match
      ? decoded.witnessBundles.find(bundle =>
          bundle.transitions.some(transition => transition.opId === match.transition.opId)
        )
      : undefined
    if (!match || !witness || (item.txid !== undefined && witness.txid !== item.txid)) {
      return undefined
    }
    if (
      (receive.assetId && receive.assetId !== decoded.assetId) ||
      (receive.amount && receive.amount !== match.assignment.amount.toString())
    ) {
      return undefined
    }
    return {
      decoded,
      match,
      witness,
      assetId: decoded.assetId,
      amount: match.assignment.amount.toString(),
      txid: witness.txid,
      opId: match.transition.opId,
      assignmentIndex: match.assignmentIndex,
    }
  }

  private async advanceAcceptedReceive(
    receive: import('./types').RgbPendingReceive,
    item: { recipientId: string; payload: string; txid?: string; endpoint?: string },
    validated: NonNullable<ReturnType<RgbService['validateIncomingConsignment']>>,
    deferConfirmedSettlement: boolean
  ) {
    const state = this.requireState()
    if (!receive.receivedConsignment) return false
    const getTransactionStatus = this.dependencies.stateSource.getTransactionStatus
    if (!getTransactionStatus) {
      throw new RgbServiceError('RGB receive chain verification is unavailable')
    }
    const chain = await getTransactionStatus(state.wallet, validated.txid)
    if (
      (chain.status === 'mempool' || chain.status === 'confirmed') &&
      !receive.receivedConsignment.broadcastDetectedAt
    ) {
      receive.receivedConsignment.broadcastDetectedAt = this.now()
    }
    if (chain.status !== 'confirmed') return false

    let utxo = state.snapshot.utxos.find(candidate =>
      receive.recipientType === 'witness'
        ? candidate.outpoint.txid === validated.txid && candidate.outpoint.vout === validated.vout
        : candidate.outpoint.txid === receive.seal?.txid &&
          candidate.outpoint.vout === receive.seal?.vout
    )
    if (!utxo && receive.recipientType === 'witness') {
      const output = validated.witness.outputs[validated.vout]
      if (!output || !receive.witnessPublicKey) return false
      // The server deliberately indexes only client-verified observations.
      // Register this exact confirmed output before asking it for a snapshot.
      utxo = {
        outpoint: { txid: validated.txid, vout: validated.vout },
        satoshis: output.satoshis,
        scriptPubKey: output.scriptPubKey,
        publicKey: receive.witnessPublicKey,
        chainStatus: 'confirmed',
        confirmations: chain.confirmations,
        allocations: [],
      }
      state.snapshot.utxos.push(utxo)
      state.pendingUtxoSync = {
        txid: validated.txid,
        outpoints: state.snapshot.utxos,
      }
    }
    if (!utxo) return false
    if (deferConfirmedSettlement) return 'snapshot_required' as const
    const assetId = normalizeAssetId(validated.assetId)
    // Do this before mutating the allocation/receive state. A conflicting or
    // malformed branch must reject atomically rather than leave a spendable
    // UTXO whose required DAG was not durably retained.
    this.storeAcceptedHistory({
      assetId,
      payload: item.payload,
      opId: validated.opId,
      genesis: Buffer.from(validated.decoded.genesis.strict).toString('base64'),
      metadata: validated.decoded.metadata,
    })
    if (
      !utxo.allocations.some(
        allocation =>
          allocation.opId === validated.opId &&
          allocation.assignmentIndex === validated.assignmentIndex
      )
    ) {
      utxo.allocations.push({
        assetId: validated.assetId,
        amount: validated.amount,
        settled: true,
        spendable: true,
        opId: validated.opId,
        assignmentIndex: validated.assignmentIndex,
        assignmentType: 4000,
      })
    }
    state.pendingUtxoSync = {
      txid: utxo.outpoint.txid,
      outpoints: state.snapshot.utxos,
    }
    if (receive.seal) {
      const receivedBlindSeals = state.receivedBlindSeals || (state.receivedBlindSeals = [])
      if (!receivedBlindSeals.some(seal => sameBlindSeal(seal, receive.seal!))) {
        receivedBlindSeals.push(receive.seal)
      }
    }
    this.recordReceiveOutcome(receive, 'settled', validated.txid)
    if (!receive.assetMetadataIndexed) {
      this.queueAssetMetadata(assetId, validated.decoded.metadata)
    }
    return true
  }

  private recordReceiveOutcome(
    receive: import('./types').RgbPendingReceive,
    status: 'settled' | 'canceled' | 'rejected',
    txid: string
  ) {
    const state = this.requireState()
    this.recordReleasedReceiveRecipient(receive.recipientId)
    const pendingReceiveHistory = state.pendingReceiveHistory || (state.pendingReceiveHistory = [])
    const transferId = `receive:${receive.proxyRecipientId || receive.recipientId}`
    // Any Asset / Any Amount invoices intentionally omit these constraints.
    // After acceptance pendingAccept is removed, so use the durable receipt
    // which records the values actually offered by the sender.
    const assetId =
      receive.receivedConsignment?.assetId ?? receive.pendingAccept?.assetId ?? receive.assetId
    const amount =
      receive.receivedConsignment?.amount ?? receive.pendingAccept?.amount ?? receive.amount
    const precision = receive.receivedConsignment?.precision ?? receive.pendingAccept?.precision
    const existing = pendingReceiveHistory.find(item => item.transferId === transferId)
    if (existing) {
      // Settlement is terminal. A delayed proxy poll (especially after local
      // recovery) must never relabel an already confirmed receive as rejected
      // or canceled.
      if (existing.status !== 'settled' || status === 'settled') existing.status = status
      existing.txid = txid || existing.txid
      if (assetId) existing.assetId = assetId
      if (amount) existing.amount = amount
      if (precision !== undefined) existing.precision = precision
      existing.counterpartyScriptPubKeys =
        existing.counterpartyScriptPubKeys ||
        receive.pendingAccept?.counterpartyScriptPubKeys ||
        receive.receivedConsignment?.counterpartyScriptPubKeys
      return
    }
    pendingReceiveHistory.push({
      transferId,
      assetId: assetId || '',
      amount: amount || '',
      ...(precision === undefined ? {} : { precision }),
      txid,
      createdAt:
        receive.receivedConsignment?.receivedAt ||
        receive.pendingAccept?.discoveredAt ||
        this.now(),
      status,
      counterpartyScriptPubKeys:
        receive.pendingAccept?.counterpartyScriptPubKeys ||
        receive.receivedConsignment?.counterpartyScriptPubKeys,
    })
  }

  private async getProxyAcknowledgement(
    receive: import('./types').RgbPendingReceive,
    endpoint?: string
  ) {
    const getAcknowledgement = this.dependencies.transport.getAcknowledgement
    if (!getAcknowledgement) return undefined
    const endpoints = endpoint ? [endpoint] : decodeRgbInvoice(receive.invoice).transportEndpoints
    if (!endpoints.length) return undefined
    try {
      return await getAcknowledgement({
        recipientId: receive.proxyRecipientId || receive.recipientId,
        payload: '',
        assetId: receive.assetId || '',
        opIds: [],
        txid: receive.pendingAccept?.txid || receive.receivedConsignment?.txid || '',
        endpoints,
      })
    } catch {
      return undefined
    }
  }

  private async isReceiveCanceledBySender(receive: import('./types').RgbPendingReceive) {
    if (await this.isProxyAckRejected(receive, receive.pendingAccept?.endpoint)) return true
    const getConsignment = this.dependencies.transport.getConsignment
    if (!getConsignment || !receive.pendingAccept) return false
    const endpoints = decodeRgbInvoice(receive.invoice).transportEndpoints
    if (!endpoints.length) return false
    try {
      const consignment = await getConsignment({
        recipientId: receive.proxyRecipientId || receive.recipientId,
        endpoints,
      })
      return !consignment
    } catch {
      return false
    }
  }

  /** An accepted invoice is canceled only by a reviewed backend decision. */
  private async isAcceptedReceiveTerminallyCanceled(
    receive: import('./types').RgbPendingReceive
  ) {
    const txid = receive.receivedConsignment?.txid || receive.pendingAccept?.txid
    if (!txid || !this.dependencies.stateSource.getBroadcastCancellation) return false
    try {
      return await this.dependencies.stateSource.getBroadcastCancellation(
        this.requireState().wallet,
        receive.proxyRecipientId || receive.recipientId,
        txid
      )
    } catch {
      return false
    }
  }

  private async isProxyAckRejected(
    receive: import('./types').RgbPendingReceive,
    endpoint?: string
  ) {
    return (await this.getProxyAcknowledgement(receive, endpoint)) === false
  }

  async claimPendingReceives() {
    const state = this.requireState()
    const claim = this.dependencies.stateSource.claimConsignments
    if (!claim) return { claimed: 0 }
    // Claiming is a durable wallet-to-recipient binding. Once the backend has
    // accepted it, retain that acknowledgement locally so ordinary receive
    // polling does not write the same binding on every wallet open.
    const pending = this.getPendingReceives().filter(receive => receive.claimedAt === undefined)
    if (!pending.length) return { claimed: 0 }

    const results = await Promise.allSettled(
      pending.map(async receive => {
        const claimed = await claim(state.wallet, receive.proxyRecipientId || receive.recipientId)
        receive.claimedAt = this.now()
        return claimed
      })
    )
    const claimed = results.reduce((total, result) => {
      return result.status === 'fulfilled' ? total + result.value : total
    }, 0)
    if (results.some(result => result.status === 'fulfilled')) await this.persist()

    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (failure && !this.dependencies.transport.getConsignment) throw failure.reason
    return { claimed }
  }

  async cancelBlindReceive(recipientId: string) {
    return this.removePendingReceive(recipientId)
  }

  async removePendingReceive(recipientId: string) {
    return this.runPendingReceiveOperation(() => this.removePendingReceiveOnce(recipientId))
  }

  private async removePendingReceiveOnce(recipientId: string) {
    const state = this.requireState()
    const receives = state.pendingReceives || []
    const index = receives.findIndex(item => item.recipientId === recipientId)
    if (index < 0) return { cancelled: false }
    // Acceptance ACKs the consignment and allows the sender to broadcast. The
    // local record is then the durable receipt needed to settle the allocation,
    // so it cannot be released as an unused invoice.
    if (
      receives[index]!.receivedConsignment?.accepted ||
      receives[index]!.receivedConsignment?.acknowledgementPending ||
      receives[index]!.pendingAccept
    ) {
      return { cancelled: false }
    }
    const rollback = snapshotState(state)
    receives.splice(index, 1)
    this.recordReleasedReceiveRecipient(recipientId)
    // Releasing a blind seal or deleting a witness invoice changes durable
    // wallet state. Do not report it as removed until its checkpoint is safely
    // published; otherwise another device can restore the stale invoice.
    await this.persistWithRecoveryRollback(rollback)
    return { cancelled: true }
  }

  /** Keep a checkpoint-portable proof that this recipient is no longer pending. */
  private recordReleasedReceiveRecipient(recipientId: string) {
    const state = this.requireState()
    const released = state.releasedReceiveRecipientIds || (state.releasedReceiveRecipientIds = [])
    if (!released.includes(recipientId)) released.push(recipientId)
  }

  async storeContract(assetId: string, consignment: Uint8Array, genesis?: Uint8Array) {
    const state = this.requireState()
    const rollback = snapshotState(state)
    const contracts = state.contracts || (state.contracts = {})
    contracts[normalizeAssetId(assetId)] = {
      consignment: Buffer.from(consignment).toString('base64'),
      ...(genesis ? { genesis: Buffer.from(genesis).toString('base64') } : {}),
      createdAt: this.now(),
    }
    await this.persistWithRecoveryRollback(rollback)
  }

  getContractConsignment(assetId: string) {
    const contract = this.requireState().contracts?.[normalizeAssetId(assetId)]
    return contract ? Buffer.from(contract.consignment, 'base64').toString('base64') : undefined
  }

  /**
   * Return the self-contained local history for an asset. `contracts.consignment`
   * remains for old checkpoints and locally issued root contracts; received
   * assets use the canonical history generated by storeAcceptedHistory.
   */
  private getLocalValidationHistory(assetId: string) {
    const normalized = normalizeAssetId(assetId)
    const contract = this.requireState().contracts?.[normalized]
    if (!contract) return []
    if (contract.history) {
      return [{ opId: contractOperationId(normalized), payload: contract.history.payload }]
    }
    return [{ opId: contractOperationId(normalized), payload: contract.consignment }]
  }

  private localHistoryCoversAllocations(assetId: string, opIds: string[]) {
    const contract = this.requireState().contracts?.[normalizeAssetId(assetId)]
    if (!contract) return false
    const rootId = contractOperationId(assetId)
    if (!contract.history) return opIds.every(opId => opId === rootId)
    const known = new Set(contract.history.opIds.map(opId => opId.toLowerCase()))
    return opIds.every(opId => opId.toLowerCase() === rootId || known.has(opId.toLowerCase()))
  }

  /**
   * Merge a newly verified receive into a compact canonical Consignment. The
   * resulting payload deliberately has no transport terminals: terminals are
   * delivery metadata, while the genesis and WitnessBundle DAG are the state
   * needed for an offline later spend.
   */
  private storeAcceptedHistory(input: {
    assetId: string
    payload: string
    opId: string
    genesis: string
    metadata: import('./types').RgbContractMetadata
  }) {
    const state = this.requireState()
    const contracts = state.contracts || (state.contracts = {})
    const existing = contracts[input.assetId]
    // Before `history` was introduced, received assets kept their complete
    // DAG only in `consignment`. Include that legacy payload in the first
    // merge so migrating on a subsequent receive does not lose old branches.
    const existingPayload = existing?.history?.payload ?? existing?.consignment
    const payloads = [
      ...(existingPayload
        ? [{ opId: contractOperationId(input.assetId), payload: existingPayload }]
        : []),
      { opId: input.opId, payload: input.payload },
    ]
    const history = mergeNiaConsignmentHistory({
      assetId: input.assetId,
      consignments: payloads,
      requiredOpIds: [],
      knownBlindSeals: this.getKnownBlindSeals(),
    })
    const lastBundle = history.witnessBundles.at(-1)
    if (!lastBundle) throw new RgbServiceError('Received RGB Consignment has no WitnessBundle')
    const canonical = encodeNiaTransferConsignment({
      genesis: history.genesis,
      priorWitnessBundles: history.witnessBundles.slice(0, -1),
      witnessBundle: lastBundle,
      terminals: [],
    })
    const canonicalPayload = Buffer.from(canonical).toString('base64')
    if (
      canonicalPayload.length > MAX_RECOVERY_HISTORY_PAYLOAD_LENGTH ||
      history.transitionIds.length > MAX_RECOVERY_HISTORY_OPERATION_IDS
    ) {
      throw new RgbServiceError(
        'Received RGB Consignment history exceeds recovery checkpoint limits'
      )
    }
    contracts[input.assetId] = {
      // Keep the canonical payload in the legacy field as well, so older
      // callers never silently fall back to only the newest branch.
      consignment: canonicalPayload,
      genesis: input.genesis,
      metadata: input.metadata,
      createdAt: existing?.createdAt || this.now(),
      history: {
        payload: canonicalPayload,
        opIds: history.transitionIds,
        updatedAt: this.now(),
      },
    }
  }

  getContractGenesis(assetId: string) {
    const contract = this.requireState().contracts?.[normalizeAssetId(assetId)]
    return contract?.genesis
  }

  getSnapshot() {
    return this.requireState().snapshot
  }

  /**
   * Derive the asset list solely from durable wallet state. This deliberately
   * avoids the indexer asset/list endpoints: local allocations and locally
   * validated contract metadata are the wallet's source of truth.
   */
  getLocalAssetList(page = 1, pageSize = 20) {
    const list = this.getLocalAssetBalances()
    const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1
    const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : 20
    const offset = (safePage - 1) * safePageSize
    return {
      total: list.length,
      list: list.slice(offset, offset + safePageSize),
    }
  }

  /** Return a local balance for an asset currently represented in the snapshot. */
  getLocalAssetBalance(assetId: string): RgbLocalAssetBalance | undefined {
    const normalized = normalizeAssetId(assetId)
    return this.getLocalAssetBalances().find(asset => asset.assetId === normalized)
  }

  /**
   * Detail views are also local: contract metadata is learned from the
   * validated consignment and the balance comes from the local snapshot.
   */
  getLocalAssetDetail(assetId: string): RgbLocalAssetDetail {
    const normalized = normalizeAssetId(assetId)
    return this.getLocalAssetBalance(normalized) || this.getEmptyLocalAssetBalance(normalized)
  }

  private getLocalAssetBalances(): RgbLocalAssetBalance[] {
    const state = this.requireState()
    const locked = new Set(
      Object.values(state.pending).flatMap(pending =>
        pending.prepared.lockedOutpoints.map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
      )
    )
    const amounts = new Map<string, { settled: bigint; spendable: bigint; pending: bigint }>()
    for (const utxo of state.snapshot.utxos) {
      if (
        utxo.chainStatus === 'spent' ||
        utxo.chainStatus === 'replaced' ||
        utxo.chainStatus === 'pending_spend'
      ) {
        continue
      }
      for (const allocation of utxo.allocations) {
        const current = amounts.get(allocation.assetId) || {
          settled: 0n,
          spendable: 0n,
          pending: 0n,
        }
        const amount = BigInt(allocation.amount)
        if (allocation.settled) current.settled += amount
        else current.pending += amount
        if (allocation.settled && allocation.spendable && !locked.has(outpointKey(utxo))) {
          current.spendable += amount
        }
        amounts.set(allocation.assetId, current)
      }
    }
    return [...amounts.entries()]
      .map(([assetId, amount]) => this.getEmptyLocalAssetBalance(assetId, amount))
      .sort((left, right) => left.assetId.localeCompare(right.assetId))
  }

  private getEmptyLocalAssetBalance(
    assetId: string,
    amount: { settled: bigint; spendable: bigint; pending: bigint } = {
      settled: 0n,
      spendable: 0n,
      pending: 0n,
    }
  ): RgbLocalAssetDetail {
    const metadata = this.requireState().contracts?.[assetId]?.metadata
    return {
      assetId,
      balance: amount.settled.toString(),
      settled: amount.settled.toString(),
      spendable: amount.spendable.toString(),
      pending: amount.pending.toString(),
      ...(metadata
        ? {
            ticker: metadata.ticker,
            name: metadata.name,
            precision: metadata.precision,
            schema: metadata.schema,
            issuedSupply: metadata.issuedSupply,
            ...(metadata.timestamp === undefined ? {} : { timestamp: metadata.timestamp }),
          }
        : {}),
    }
  }

  /**
   * Diagnostic view for wallet-owned RGB UTXOs. Pending invoices reserve a
   * blind seal locally, so that reservation is not present in the indexer
   * snapshot and must be returned separately for the wallet UI.
   */
  getUtxoInspection() {
    const state = this.requireState()
    const assetMetadata = Object.fromEntries(
      [
        ...new Set(
          state.snapshot.utxos.flatMap(utxo =>
            utxo.allocations.map(allocation => allocation.assetId)
          )
        ),
      ].map(assetId => {
        const asset = this.getLocalAssetDetail(assetId)
        return [
          assetId,
          {
            ...(asset.name ? { name: asset.name } : {}),
            ...(asset.ticker ? { ticker: asset.ticker } : {}),
            ...(asset.precision === undefined ? {} : { precision: asset.precision }),
          },
        ]
      })
    )
    return {
      snapshot: state.snapshot,
      assetMetadata,
      invoiceReservations: (state.pendingReceives || []).map(receive => ({
        invoice: receive.invoice,
        recipientId: receive.recipientId,
        ...(receive.proxyRecipientId ? { proxyRecipientId: receive.proxyRecipientId } : {}),
        assetId: receive.assetId,
        amount: receive.amount,
        expirationTimestamp: receive.expirationTimestamp,
        createdAt: receive.createdAt,
        ...(receive.seal ? { txid: receive.seal.txid, vout: receive.seal.vout } : {}),
      })),
    }
  }

  getPendingFeePoolUtxos() {
    return this.requireState().pendingFeePoolUtxos || []
  }

  /** Remove locally retained fee-pool outputs once a wallet-only withdrawal spends them. */
  async removeFeePoolUtxos(outpoints: RgbOutpoint[]) {
    const state = this.requireState()
    const spent = new Set(outpoints.map(outpoint => `${outpoint.txid}:${outpoint.vout}`))
    const pending = state.pendingFeePoolUtxos || []
    const next = pending.filter(utxo => !spent.has(`${utxo.outpoint.txid}:${utxo.outpoint.vout}`))
    if (next.length === pending.length) return
    const rollback = snapshotState(state)
    state.pendingFeePoolUtxos = next
    await this.persistWithRecoveryRollback(rollback)
  }

  async queueFeePoolUtxos(utxos: RgbFeePoolUtxo[]) {
    const state = this.requireState()
    const rollback = snapshotState(state)
    const pending = state.pendingFeePoolUtxos || (state.pendingFeePoolUtxos = [])
    for (const utxo of utxos) {
      const index = pending.findIndex(
        item =>
          item.outpoint.txid === utxo.outpoint.txid && item.outpoint.vout === utxo.outpoint.vout
      )
      if (index >= 0) pending[index] = utxo
      else pending.push(utxo)
    }
    await this.persistWithRecoveryRollback(rollback)
  }

  /** Pending sends survive a background restart until completed or explicitly aborted. */
  getPendingTransfers() {
    return Object.entries(this.requireState().pending).map(([id, pending]) => ({ id, ...pending }))
  }

  /**
   * Local provider ownership for a pending payment or its locally retained
   * status history. It is intentionally never included in recovery state.
   */
  async getTransferProviderOrigin(transferId: string) {
    const state = this.requireState()
    const pendingOrigin = state.pending[transferId]?.providerOrigin
    if (pendingOrigin) return pendingOrigin

    if (this.pruneExpiredProviderOrigins()) await this.persist({ skipRecovery: true })
    const history = state.pendingSendHistory?.find(item => item.transferId === transferId)
    if (!history?.providerOrigin) return undefined
    return history.providerOrigin
  }

  /**
   * Read-only invoice transport preflight. This prevents signing for a blind
   * recipient ID that a proxy has already bound to another consignment.
   */
  async checkInvoiceAvailability(invoiceText: string) {
    const invoice = decodeRgbInvoice(invoiceText)
    if (
      invoice.network &&
      !isCompatibleInvoiceNetwork(invoice.network, this.requireState().wallet.network)
    ) {
      throw new RgbServiceError('RGB invoice network does not match the current wallet')
    }
    if (
      invoice.expirationTimestamp &&
      invoice.expirationTimestamp <= Math.floor(this.now() / 1000)
    ) {
      throw new RgbServiceError('RGB invoice has expired')
    }
    if (!invoice.transportEndpoints.length) {
      throw new RgbServiceError('RGB invoice has no proxy transport endpoint')
    }
    const available = await this.dependencies.transport.checkConsignmentAvailability?.({
      recipientId: invoice.recipientId,
      endpoints: invoice.transportEndpoints,
    })
    if (available === false) throw new RgbInvoiceUnavailableError()
    return { available: true }
  }

  async prepareSend(request: RgbTransferRequest, options: { providerOrigin?: string } = {}) {
    const previous = this.prepareSendInFlight
    let release = () => undefined
    const current = new Promise<void>(resolve => {
      release = resolve
    })
    this.prepareSendInFlight = current
    if (previous) await previous

    try {
      return await this.prepareSendOnce(request, options)
    } finally {
      release()
      if (this.prepareSendInFlight === current) this.prepareSendInFlight = undefined
    }
  }

  /** Reserve RGB allocations and persist the pending transfer as one serialized operation. */
  private async prepareSendOnce(request: RgbTransferRequest, options: { providerOrigin?: string }) {
    const state = this.requireState()
    const invoice = decodeRgbInvoice(request.invoice)
    const requestedAssetId = normalizeAssetId(request.assetId)
    if (invoice.assetId && invoice.assetId !== requestedAssetId) {
      throw new RgbServiceError('RGB invoice asset does not match the requested asset')
    }
    if (invoice.network && !isCompatibleInvoiceNetwork(invoice.network, state.wallet.network)) {
      throw new RgbServiceError('RGB invoice network does not match the current wallet')
    }
    if (
      invoice.expirationTimestamp &&
      invoice.expirationTimestamp <= Math.floor(this.now() / 1000)
    ) {
      throw new RgbServiceError('RGB invoice has expired')
    }
    if (!invoice.transportEndpoints.length) {
      throw new RgbServiceError('RGB invoice has no proxy transport endpoint')
    }
    const amount = request.amount === undefined ? invoice.amount : request.amount
    if (!amount) {
      throw new RgbServiceError('RGB transfer amount must be provided by the request or invoice')
    }
    if (invoice.amount && invoice.amount !== amount) {
      throw new RgbServiceError('RGB invoice amount does not match the requested amount')
    }
    const resolvedRequest = { ...request, assetId: requestedAssetId, amount }
    // A market relay can fail after the wallet has already durably prepared a
    // seller swap. Reuse that exact template on retry so its RGB reservation
    // is not mistaken for an insufficient balance.
    if (request.swapPsbt) {
      const existing = Object.values(state.pending).find(
        pending =>
          !pending.delivery &&
          !pending.broadcast &&
          pending.providerOrigin === options.providerOrigin &&
          pending.request.assetId === requestedAssetId &&
          pending.request.amount === amount &&
          pending.request.invoice === request.invoice &&
          pending.request.swapPsbt === request.swapPsbt
      )
      if (existing) return existing.prepared
    }
    // A market constructs the Bitcoin template before the wallet reserves RGB
    // allocations. Select only from carrier inputs already committed by that
    // template, instead of requiring the market to reproduce wallet coin selection.
    const swapInputOutpoints = request.swapPsbt
      ? getSwapPsbtInputOutpoints(request.swapPsbt)
      : undefined
    const selectedUtxos = this.selectUtxos(requestedAssetId, amount, swapInputOutpoints)
    await this.verifySelectedUtxos(state.wallet, selectedUtxos)
    const allocations = selectedUtxos.flatMap(utxo =>
      utxo.allocations
        .filter(allocation => allocation.assetId === requestedAssetId)
        .map(allocation => {
          if (
            !allocation.opId ||
            allocation.assignmentIndex === undefined ||
            allocation.assignmentType === undefined
          ) {
            throw new RgbServiceError(
              'RGB allocation is missing history required for a local transfer'
            )
          }
          return {
            outpoint: utxo.outpoint,
            opId: allocation.opId,
            assignmentIndex: allocation.assignmentIndex,
            assignmentType: allocation.assignmentType,
          }
        })
    )
    // A verified, canonical local DAG is authoritative. Do not make an
    // offline spend depend on the address-scoped backend being available.
    const localHistory = this.getLocalValidationHistory(requestedAssetId)
    const usingLocalHistory = this.localHistoryCoversAllocations(
      requestedAssetId,
      allocations.map(allocation => allocation.opId)
    )
    const getRemoteHistory = () =>
      this.dependencies.stateSource.getValidationHistory(state.wallet, {
        assetId: requestedAssetId,
        allocations,
      })
    const enrichValidationHistory = (history: RgbValidationHistory) => {
      const localContract = this.getContractConsignment(requestedAssetId)
      const localGenesis = this.getContractGenesis(requestedAssetId)
      if (localContract && !history.consignments.some(item => item.payload === localContract)) {
        history.consignments.unshift({
          opId: contractOperationId(requestedAssetId),
          payload: localContract,
        })
      }
      if (localContract) history.localContract = localContract
      if (localGenesis) history.localGenesis = localGenesis
      history.knownBlindSeals = this.getKnownBlindSeals()
      return history
    }
    let validationHistory = enrichValidationHistory(
      usingLocalHistory
        ? { assetId: requestedAssetId, consignments: localHistory }
        : await getRemoteHistory()
    )
    const feeFunding = await this.dependencies.feeSource?.getFeeFunding(state.wallet)
    const reservedFeeOutpoints = new Set(
      Object.values(state.pending).flatMap(pending =>
        (pending.prepared.feeOutpoints || []).map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
      )
    )
    const availableFeeFunding = feeFunding
      ? {
          ...feeFunding,
          utxos: feeFunding.utxos.filter(
            utxo => !reservedFeeOutpoints.has(`${utxo.outpoint.txid}:${utxo.outpoint.vout}`)
          ),
        }
      : undefined
    const intent = {
      assetId: requestedAssetId,
      amount,
      invoice,
      transition: planFungibleTransition({
        assetId: requestedAssetId,
        amount,
        recipientId: invoice.recipientId,
        selectedUtxos,
      }),
    }
    const encoderInput = () => ({
      wallet: state.wallet,
      snapshot: state.snapshot,
      request: resolvedRequest,
      intent,
      selectedUtxos,
      ...(availableFeeFunding === undefined ? {} : { feeFunding: availableFeeFunding }),
      validationHistory,
    })
    let prepared: RgbPreparedTransfer
    try {
      prepared = await this.dependencies.encoder.prepareTransfer(encoderInput())
    } catch (error) {
      // `history.opIds` is metadata from the encrypted checkpoint. Older
      // checkpoints can claim an allocation Transition while their compact
      // payload no longer reveals that assignment. Do not trust that index
      // blindly: obtain the authoritative history once and retry before
      // failing the send.
      if (!usingLocalHistory || !isIncompleteLocalHistoryError(error)) throw error
      validationHistory = enrichValidationHistory(await getRemoteHistory())
      prepared = await this.dependencies.encoder.prepareTransfer(encoderInput())
    }

    const selectedOutpoints = new Set(selectedUtxos.map(outpointKey))
    const lockedOutpoints = new Set(
      prepared.lockedOutpoints.map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
    )
    if (
      !prepared.lockedOutpoints.length ||
      ![...lockedOutpoints].every(key => selectedOutpoints.has(key))
    ) {
      throw new RgbServiceError('RGB encoder returned invalid locked outpoints')
    }
    if (state.pending[prepared.id]) {
      throw new RgbServiceError(`RGB transfer ${prepared.id} already exists`)
    }

    const rollback = snapshotState(state)
    state.pending[prepared.id] = {
      prepared,
      request: resolvedRequest,
      createdAt: this.now(),
      ...(options.providerOrigin ? { providerOrigin: options.providerOrigin } : {}),
    }
    // The unsigned reservation is locally durable and can be rebuilt after a
    // restart. Do not upload a full checkpoint before signing produces an
    // irreversible RGB transfer.
    await this.persistWithRecoveryRollback(rollback, { skipRecovery: true })
    return prepared
  }

  async completeSend(transferId: string, signedPsbt: string): Promise<RgbCompletedTransfer> {
    return this.runPendingTransferOperation(transferId, () =>
      this.completeSendOnce(transferId, signedPsbt)
    )
  }

  /**
   * Publish a seller-signed atomic-swap consignment without polling for ACK
   * or broadcasting. The buyer must add their Bitcoin signatures first.
   */
  async publishSwap(transferId: string, makerSignedPsbt: string): Promise<RgbCompletedTransfer> {
    return this.runPendingTransferOperation(transferId, async () => {
      const state = this.requireState()
      const pending = state.pending[transferId]
      if (!pending) throw new RgbServiceError(`RGB transfer ${transferId} does not exist`)
      if (pending.broadcast) return this.syncBroadcastedTransfer(transferId, pending)
      if (!pending.delivery) {
        const completed = await this.dependencies.encoder.completeTransfer({
          wallet: state.wallet,
          pending,
          signedPsbt: makerSignedPsbt,
          allowIncomplete: true,
        })
        const endpoints = decodeRgbInvoice(pending.request.invoice).transportEndpoints
        if (!endpoints.length)
          throw new RgbServiceError('RGB invoice has no proxy transport endpoint')
        const rollback = snapshotState(state)
        pending.delivery = {
          completed,
          endpoints,
          requiresCounterpartySignature: true,
          makerSignedPsbt,
        }
        await this.persistWithRecoveryRollback(rollback)
      }
      if (!pending.delivery.requiresCounterpartySignature) {
        throw new RgbServiceError('RGB transfer is not awaiting a swap counterparty signature')
      }
      await this.publishPendingDelivery(transferId, pending)
      return pending.delivery.completed
    })
  }

  /**
   * The buyer has ACKed the published consignment and returned its signed
   * PSBT. Rebuild the exact RGB transfer from the committed unsigned
   * transaction before allowing the dApp broadcast path to proceed.
   */
  async completePublishedSwap(
    transferId: string,
    fullySignedPsbt: string,
    options: { externalBroadcast?: boolean } = {}
  ): Promise<RgbCompletedTransfer> {
    return this.runPendingTransferOperation(transferId, async () => {
      const state = this.requireState()
      const pending = state.pending[transferId]
      if (!pending) throw new RgbServiceError(`RGB transfer ${transferId} does not exist`)
      if (pending.broadcast) return this.syncBroadcastedTransfer(transferId, pending)
      const delivery = pending.delivery
      if (!delivery?.requiresCounterpartySignature) {
        throw new RgbServiceError('RGB transfer is not awaiting a buyer swap PSBT')
      }
      const completed = await this.dependencies.encoder.completeTransfer({
        wallet: state.wallet,
        pending,
        signedPsbt: fullySignedPsbt,
        // P2P market dApps finalize and broadcast after this wallet-local RGB
        // completion step. RGB's Opret witness commits to the unchanged
        // unsigned transaction, so this may safely build the delivery state
        // from a fully signed but not-yet-finalized PSBT.
        allowIncomplete: options.externalBroadcast,
      })
      if (completed.txid !== delivery.completed.txid) {
        throw new RgbServiceError('RGB swap PSBT does not match the published consignment')
      }
      delivery.completed = completed
      delete delivery.requiresCounterpartySignature
      delete delivery.makerSignedPsbt
      await this.persist({ waitForRecovery: true })
      return this.advancePendingDelivery(
        transferId,
        pending,
        options.externalBroadcast ? 'external' : 'broadcast'
      )
    })
  }

  private async completeSendOnce(
    transferId: string,
    signedPsbt: string
  ): Promise<RgbCompletedTransfer> {
    const state = this.requireState()
    const pending = state.pending[transferId]
    if (!pending) throw new RgbServiceError(`RGB transfer ${transferId} does not exist`)
    if (pending.broadcast) return this.syncBroadcastedTransfer(transferId, pending)

    if (pending.delivery?.requiresCounterpartySignature) {
      throw new RgbServiceError('RGB swap is awaiting the buyer finalized PSBT')
    }

    if (!pending.delivery) {
      const completed = await this.dependencies.encoder.completeTransfer({
        wallet: state.wallet,
        pending,
        signedPsbt,
      })
      const endpoints = decodeRgbInvoice(pending.request.invoice).transportEndpoints
      if (!endpoints.length)
        throw new RgbServiceError('RGB invoice has no proxy transport endpoint')
      const rollback = snapshotState(state)
      pending.delivery = { completed, endpoints }
      await this.persistWithRecoveryRollback(rollback)
    }
    return this.advancePendingDelivery(transferId, pending)
  }

  /** Broadcast a receiver-accepted wallet send only after the sender requests it. */
  async broadcastPendingSend(transferId: string) {
    return this.runPendingTransferOperation(transferId, async () => {
      const pending = this.requireState().pending[transferId]
      if (
        !pending?.delivery?.acknowledgedAt ||
        pending.delivery.externalBroadcast ||
        pending.delivery.requiresCounterpartySignature
      ) {
        throw new RgbServiceError('RGB transfer is not ready for sender broadcast')
      }
      let canceled = false
      try {
        canceled = (await this.dependencies.stateSource.getBroadcastCancellation?.(
          this.requireState().wallet,
          decodeRgbInvoice(pending.request.invoice).proxyRecipientId,
          pending.delivery.completed.txid
        )) === true
      } catch { /* A backend outage must not disable sender retry. */ }
      if (canceled) {
        const txid = pending.delivery.completed.txid
        await this.cancelTerminalBroadcastFailure(transferId, pending)
        throw new RgbTransferCanceledError(transferId, txid)
      }
      return this.advancePendingDelivery(transferId, pending, 'broadcast')
    })
  }

  /** Apply only a backend decision backed by a confirmed conflicting spend. */
  async processBroadcastCancellations() {
    const getCancellation = this.dependencies.stateSource.getBroadcastCancellation
    const state = this.requireState()
    let canceled = 0
    for (const [transferId, pending] of Object.entries(state.pending)) {
      if (!pending.delivery?.broadcastError || pending.broadcast) continue
      if (!pending.delivery.failureReportedAt) {
        try { await this.reportPendingBroadcastFailure(transferId, pending) } catch { /* Retry on next poll. */ }
      }
      if (!getCancellation) continue
      try {
        if (!await getCancellation(
          state.wallet,
          decodeRgbInvoice(pending.request.invoice).proxyRecipientId,
          pending.delivery.completed.txid
        )) continue
        await this.cancelTerminalBroadcastFailure(transferId, pending)
        canceled++
      } catch { /* Preserve the local lock while the backend is unavailable. */ }
    }
    return canceled
  }

  private async reportPendingBroadcastFailure(transferId: string, pending: RgbPendingTransfer) {
    const delivery = pending.delivery
    const report = this.dependencies.stateSource.reportBroadcastFailure
    if (!delivery?.broadcastError || !report) return
    await report(this.requireState().wallet, {
      transferId,
      recipientId: decodeRgbInvoice(pending.request.invoice).proxyRecipientId,
      txid: delivery.completed.txid,
      rawTx: delivery.completed.rawTx,
      error: delivery.broadcastError,
    })
    delivery.failureReportedAt = this.now()
    try {
      await this.persist({ skipRecovery: true })
    } catch (error) {
      delete delivery.failureReportedAt
      throw error
    }
  }

  async abortSend(transferId: string, options: { discardUnsigned?: boolean } = {}) {
    return this.runPendingTransferOperation(transferId, () =>
      this.abortSendOnce(transferId, false, options)
    )
  }

  /**
   * Explicit two-party recovery path for a published, non-broadcast swap.
   * The market's bilateral abort agreement is the authority here: older
   * wallet versions may not yet have observed the remote ACK or written the
   * externalBroadcast marker when the dApp broadcast path failed.
   */
  async abortAcknowledgedSwap(transferId: string) {
    return this.runPendingTransferOperation(transferId, () => this.abortSendOnce(transferId, true))
  }

  private async abortSendOnce(
    transferId: string,
    allowAcknowledged = false,
    options: { discardUnsigned?: boolean } = {}
  ) {
    const state = this.requireState()
    const pending = state.pending[transferId]
    if (!pending) return { aborted: false }
    // Allow cancel until the Bitcoin transaction is broadcast. Consignment
    // delivery alone is still off-chain and can be discarded by the sender.
    // An acknowledged consignment is committed to the receiver and is about
    // to be broadcast. It is no longer safe to signal cancellation, including
    // while the broadcast request itself is in flight.
    if (pending.broadcast || (pending.delivery?.acknowledgedAt && !allowAcknowledged))
      return { aborted: false }
    if (allowAcknowledged && !pending.delivery) return { aborted: false }

    // Best-effort cancel signal: post ACK=false on the proxy so the receiver
    // can surface "Canceled by sender" instead of waiting forever.
    if (
      !pending.delivery?.acknowledgedAt &&
      pending.delivery &&
      this.dependencies.transport.acknowledgeConsignment
    ) {
      const proxyRecipientId = decodeRgbInvoice(pending.request.invoice).proxyRecipientId
      for (const consignment of pending.delivery.completed.consignments) {
        try {
          await this.dependencies.transport.acknowledgeConsignment({
            recipientId: proxyRecipientId,
            endpoints: pending.delivery.endpoints,
            acknowledged: false,
          })
        } catch {
          // Local abort still proceeds if the proxy signal fails.
        }
      }
    }

    // Rejecting an unsigned wallet PSBT only releases a local reservation.
    // Once delivery exists, retain the cancellation record even if a caller
    // mistakenly requests an unsigned discard.
    const discardUnsigned =
      options.discardUnsigned === true &&
      !pending.delivery &&
      !pending.broadcast &&
      !pending.providerOrigin
    if (!discardUnsigned) {
      const sendHistory = state.pendingSendHistory || (state.pendingSendHistory = [])
      if (!sendHistory.some(item => item.transferId === transferId)) {
        sendHistory.push({
          transferId,
          assetId: pending.request.assetId,
          amount: pending.request.amount,
          ...(pending.request.precision === undefined ? {} : { precision: pending.request.precision }),
          txid: pending.delivery?.completed.txid,
          invoice: pending.request.invoice,
          createdAt: pending.createdAt,
          status: 'canceled',
          ...(pending.providerOrigin ? { providerOrigin: pending.providerOrigin } : {}),
          ...(pending.providerOrigin
            ? { providerOriginExpiresAt: this.now() + PROVIDER_ORIGIN_HISTORY_TTL_MS }
            : {}),
        })
      }
    }

    delete state.pending[transferId]
    await this.persist({ skipRecovery: discardUnsigned })
    return { aborted: true, status: discardUnsigned ? ('discarded' as const) : ('canceled' as const) }
  }

  private applyFundingUpdate(completed: RgbCompletedTransfer) {
    const update = completed.fundingUpdate
    if (!update) return
    const state = this.requireState()
    const spent = new Set(
      update.spentOutpoints.map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
    )
    state.snapshot.utxos = state.snapshot.utxos.filter(utxo => !spent.has(outpointKey(utxo)))
    if (
      update.createdUtxo &&
      !state.snapshot.utxos.some(utxo => outpointKey(utxo) === outpointKey(update.createdUtxo!))
    ) {
      state.snapshot.utxos.push(update.createdUtxo)
    }
    state.snapshot.syncedAt = this.now()
    const pending = Object.values(state.pending).find(
      item => item.delivery?.completed === completed
    )
    if (pending?.prepared.feeOutpoints?.length) {
      const spent = new Set(
        pending.prepared.feeOutpoints.map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
      )
      state.pendingFeePoolUtxos = (state.pendingFeePoolUtxos || []).filter(
        utxo => !spent.has(`${utxo.outpoint.txid}:${utxo.outpoint.vout}`)
      )
    }
  }

  /**
   * A successful local send may create RGB change. Retain its complete
   * Consignment too, otherwise a restart after a merge would leave the new
   * change allocation in the UTXO snapshot but lose its parent DAG. Older or
   * test-only encoders are allowed to return opaque placeholder consignments;
   * those cannot be promoted to verified local history.
   */
  private retainCompletedLocalHistory(completed: RgbCompletedTransfer) {
    for (const consignment of completed.consignments) {
      try {
        const assetId = normalizeAssetId(consignment.assetId)
        const decoded = decodeNiaConsignment(
          Uint8Array.from(Buffer.from(consignment.payload, 'base64'))
        )
        if (decoded.assetId !== assetId) continue
        const opId = consignment.opIds.find(candidate =>
          decoded.transitions.some(transition => transition.opId === candidate)
        )
        if (!opId) continue
        this.storeAcceptedHistory({
          assetId,
          payload: consignment.payload,
          opId,
          genesis: Buffer.from(decoded.genesis.strict).toString('base64'),
          metadata: decoded.metadata,
        })
      } catch {
        // A history-less/mock encoder must not block persistence of a Bitcoin
        // transaction that was already broadcast. A later attempt will fail
        // closed and may use the backend only as a recovery supplement.
      }
    }
  }

  private async syncBroadcastedTransfer(transferId: string, pending: RgbPendingTransfer) {
    const state = this.requireState()
    const broadcast = pending.broadcast
    if (!broadcast) throw new RgbServiceError(`RGB transfer ${transferId} has not been broadcast`)
    // Consignments were durably posted and acknowledged before this transaction was broadcast.
    await this.dependencies.stateSource.syncBroadcast?.(
      state.wallet,
      transferId,
      broadcast.completed,
      state.snapshot,
      {
        amount: pending.request.amount,
        createdAt: pending.createdAt,
        invoice: pending.request.invoice,
      }
    )
    const sendHistory = state.pendingSendHistory || (state.pendingSendHistory = [])
    const existingHistory = sendHistory.find(item => item.transferId === transferId)
    const broadcastedHistory = {
      transferId,
      assetId: pending.request.assetId,
      amount: pending.request.amount,
      ...(pending.request.precision === undefined ? {} : { precision: pending.request.precision }),
      txid: broadcast.completed.txid,
      invoice: pending.request.invoice,
      ...(broadcast.completed.fundingUpdate?.spentOutpoints
        ? { spentOutpoints: broadcast.completed.fundingUpdate.spentOutpoints }
        : {}),
      createdAt: broadcast.broadcastAt,
      status: 'broadcasted' as const,
      ...(pending.providerOrigin ? { providerOrigin: pending.providerOrigin } : {}),
      ...(pending.providerOrigin
        ? { providerOriginExpiresAt: this.now() + PROVIDER_ORIGIN_HISTORY_TTL_MS }
        : {}),
    }
    if (existingHistory) Object.assign(existingHistory, broadcastedHistory)
    else sendHistory.push(broadcastedHistory)
    delete state.pending[transferId]
    // The preceding broadcast checkpoint contains the complete transaction;
    // moving it into display history is local bookkeeping only.
    await this.persist({ skipRecovery: true })
    return broadcast.completed
  }

  /**
   * For dApp-broadcast swaps, only observe the chain. A wallet restart or
   * background sync must never become an implicit broadcaster.
   */
  private async syncExternallyBroadcastTransfer(transferId: string, pending: RgbPendingTransfer) {
    const state = this.requireState()
    const delivery = pending.delivery
    if (!delivery?.externalBroadcast) return undefined
    const getTransactionStatus = this.dependencies.stateSource.getTransactionStatus
    if (!getTransactionStatus) return undefined
    const chain = await getTransactionStatus(state.wallet, delivery.completed.txid)
    if (chain.status !== 'mempool' && chain.status !== 'confirmed') return undefined
    this.applyFundingUpdate(delivery.completed)
    this.retainCompletedLocalHistory(delivery.completed)
    pending.broadcast = { completed: delivery.completed, broadcastAt: this.now() }
    delete pending.delivery
    await this.persist({ waitForRecovery: true })
    return this.syncBroadcastedTransfer(transferId, pending)
  }

  /** Publish a completed consignment, but deliberately do not inspect ACK or broadcast. */
  private async publishPendingDelivery(transferId: string, pending: RgbPendingTransfer) {
    const state = this.requireState()
    const delivery = pending.delivery
    if (!delivery) throw new RgbServiceError(`RGB transfer ${transferId} has not been signed`)
    const proxyRecipientId = decodeRgbInvoice(pending.request.invoice).proxyRecipientId
    const consignments = delivery.completed.consignments.map((consignment, index) => ({
      ...consignment,
      recipientId: proxyRecipientId,
      transportId: `${transferId}:${index}`,
      txid: delivery.completed.txid,
      endpoints: delivery.endpoints,
    }))
    for (const consignment of consignments) {
      try {
        await this.dependencies.transport.publishConsignment(consignment)
      } catch (error) {
        if (isInvoiceUnavailableUploadError(error)) {
          delete state.pending[transferId]
          await this.persist()
          throw new RgbInvoiceUnavailableError()
        }
        throw error
      }
    }
    if (!delivery.publishedAt) {
      delivery.publishedAt = this.now()
      await this.persist({ skipRecovery: true })
    }
    return consignments
  }

  private async advancePendingDelivery(
    transferId: string,
    pending: RgbPendingTransfer,
    mode: 'manual' | 'broadcast' | 'external' = 'manual'
  ) {
    const state = this.requireState()
    const delivery = pending.delivery
    if (!delivery) throw new RgbServiceError(`RGB transfer ${transferId} has not been signed`)
    const proxyRecipientId = decodeRgbInvoice(pending.request.invoice).proxyRecipientId
    const consignments = delivery.completed.consignments.map((consignment, index) => ({
      ...consignment,
      recipientId: proxyRecipientId,
      transportId: `${transferId}:${index}`,
      txid: delivery.completed.txid,
      endpoints: delivery.endpoints,
    }))
    for (const consignment of consignments) {
      try {
        await this.dependencies.transport.publishConsignment(consignment)
      } catch (error) {
        // RGB proxy storage binds a recipient ID to its first uploaded file.
        // A different consignment for that invoice cannot overwrite it, which
        // means the recipient must issue a new blinded invoice.
        if (isInvoiceUnavailableUploadError(error)) {
          // This consignment was never accepted by the proxy and its Bitcoin
          // transaction was never broadcast. Drop the local prepared state so
          // its colored and fee-pool inputs are immediately reusable. Do not
          // send ACK=false: this recipient ID belongs to another sender's
          // transfer, which must not be canceled by this failed attempt.
          delete state.pending[transferId]
          await this.persist()
          throw new RgbInvoiceUnavailableError()
        }
        throw error
      }
    }
    if (!delivery.publishedAt) {
      delivery.publishedAt = this.now()
      // Publication is replayable from the signed checkpoint and does not
      // require another remote backup before requesting the recipient ACK.
      await this.persist({ skipRecovery: true })
    }
    const getAcknowledgement = this.dependencies.transport.getAcknowledgement
    if (!getAcknowledgement)
      throw new RgbServiceError('RGB transport does not support acknowledgement')
    const acknowledgements = await Promise.all(
      consignments.map(consignment => getAcknowledgement(consignment))
    )
    if (acknowledgements.some(acknowledged => acknowledged === false)) {
      const sendHistory = state.pendingSendHistory || (state.pendingSendHistory = [])
      if (!sendHistory.some(item => item.transferId === transferId)) {
        sendHistory.push({
          transferId,
          assetId: pending.request.assetId,
          amount: pending.request.amount,
          ...(pending.request.precision === undefined ? {} : { precision: pending.request.precision }),
          txid: delivery.completed.txid,
          invoice: pending.request.invoice,
          createdAt: pending.createdAt,
          status: 'rejected',
          ...(pending.providerOrigin ? { providerOrigin: pending.providerOrigin } : {}),
          ...(pending.providerOrigin
            ? { providerOriginExpiresAt: this.now() + PROVIDER_ORIGIN_HISTORY_TTL_MS }
            : {}),
        })
      }
      delete state.pending[transferId]
      await this.persist()
      throw new RgbTransferRejectedError(transferId, delivery.completed.txid)
    }
    if (acknowledgements.some(acknowledged => acknowledged === undefined)) {
      throw new RgbTransferAwaitingAckError(transferId)
    }
    if (!delivery.acknowledgedAt) {
      delivery.acknowledgedAt = this.now()
      await this.persist({ waitForRecovery: true })
    }

    if (mode === 'manual') return delivery.completed

    if (mode === 'external') {
      delivery.externalBroadcast = true
      await this.persist({ waitForRecovery: true })
      return delivery.completed
    }

    delete delivery.broadcastError
    let broadcastTxid: string
    try {
      broadcastTxid = await this.dependencies.broadcaster.broadcast(delivery.completed.rawTx)
    } catch (error) {
      delivery.broadcastError = error instanceof Error ? error.message : String(error)
      delete delivery.failureReportedAt
      await this.persist({ waitForRecovery: true })
      const recovery = await this.reconcileFailedBroadcast(transferId, pending)
      if (recovery === 'broadcasted') return this.syncBroadcastedTransfer(transferId, pending)
      // ACK=true cannot be changed to ACK=false by the proxy. Keep the signed
      // transfer retryable until a reviewed cancellation is published.
      try { await this.reportPendingBroadcastFailure(transferId, pending) }
      catch { /* Reporting is best effort; background polling retries it. */ }
      throw error
    }
    if (broadcastTxid !== delivery.completed.txid) {
      throw new RgbServiceError('Broadcast transaction ID does not match the RGB transfer')
    }
    this.applyFundingUpdate(delivery.completed)
    this.retainCompletedLocalHistory(delivery.completed)
    pending.broadcast = { completed: delivery.completed, broadcastAt: this.now() }
    delete pending.delivery
    await this.persist({ waitForRecovery: true })
    return this.syncBroadcastedTransfer(transferId, pending)
  }

  /**
   * A broadcaster may time out after a node already accepted the transaction.
   * Always reconcile the actual txid before retaining a lock or canceling it.
   */
  private async reconcileFailedBroadcast(
    transferId: string,
    pending: RgbPendingTransfer
  ): Promise<'broadcasted' | 'unknown'> {
    const state = this.requireState()
    const delivery = pending.delivery
    if (!delivery) return 'unknown'
    const getTransactionStatus = this.dependencies.stateSource.getTransactionStatus
    if (getTransactionStatus) {
      try {
        const chain = await getTransactionStatus(state.wallet, delivery.completed.txid)
        if (chain.status === 'mempool' || chain.status === 'confirmed') {
          this.applyFundingUpdate(delivery.completed)
          this.retainCompletedLocalHistory(delivery.completed)
          pending.broadcast = { completed: delivery.completed, broadcastAt: this.now() }
          delete pending.delivery
          await this.persist({ waitForRecovery: true })
          return 'broadcasted'
        }
        // A missing txid or a policy rejection is not proof that these signed
        // bytes can never be mined. Admin review handles terminal conflicts.
      } catch {
        // Preserve the lock only when status itself is unavailable. The
        // previous broadcast outcome is then genuinely ambiguous.
        return 'unknown'
      }
    }
    return 'unknown'
  }

  private async cancelTerminalBroadcastFailure(transferId: string, pending: RgbPendingTransfer) {
    const state = this.requireState()
    const delivery = pending.delivery
    if (!delivery) return
    // The proxy ACK is immutable. Both wallets consume the backend decision.
    const history = state.pendingSendHistory || (state.pendingSendHistory = [])
    if (!history.some(item => item.transferId === transferId)) {
      history.push({
        transferId,
        assetId: pending.request.assetId,
        amount: pending.request.amount,
        ...(pending.request.precision === undefined ? {} : { precision: pending.request.precision }),
        txid: delivery.completed.txid,
        invoice: pending.request.invoice,
        createdAt: pending.createdAt,
        status: 'canceled',
        ...(pending.providerOrigin ? { providerOrigin: pending.providerOrigin } : {}),
        ...(pending.providerOrigin
          ? { providerOriginExpiresAt: this.now() + PROVIDER_ORIGIN_HISTORY_TTL_MS }
          : {}),
      })
    }
    delete state.pending[transferId]
    await this.persist({ waitForRecovery: true })
  }

  private async getProxyConsignments() {
    const getConsignment = this.dependencies.transport.getConsignment
    const getConsignments = this.dependencies.transport.getConsignments
    if (!getConsignment && !getConsignments) return []
    const pending = this.getPendingReceives()
      .filter(
        receive =>
          (!receive.receivedConsignment?.accepted &&
            !receive.receivedConsignment?.acknowledgementPending) ||
          !receive.receivedConsignment.payload
      )
      .flatMap(receive => {
        const endpoints = decodeRgbInvoice(receive.invoice).transportEndpoints
        return endpoints.length
          ? [{ recipientId: receive.proxyRecipientId || receive.recipientId, endpoints }]
          : []
      })
    if (getConsignments) return getConsignments(pending)
    if (!getConsignment) return []
    return (await Promise.all(pending.map(input => getConsignment(input)))).filter(
      (item): item is NonNullable<typeof item> => !!item
    )
  }

  private async acknowledgeProxyConsignment(
    item: { recipientId: string; endpoint?: string },
    acknowledged: boolean
  ) {
    if (!item.endpoint || !this.dependencies.transport.acknowledgeConsignment) return
    await this.dependencies.transport.acknowledgeConsignment({
      recipientId: item.recipientId,
      endpoints: [item.endpoint],
      acknowledged,
    })
  }

  private async rejectInvalidProxyConsignment(
    receive: import('./types').RgbPendingReceive,
    item: { recipientId: string; txid?: string; endpoint?: string }
  ) {
    try {
      await this.acknowledgeProxyConsignment(item, false)
    } catch (error) {
      // RGB proxy ACKs are immutable. A recovered local state can legitimately
      // retry a NACK after the proxy has already settled that recipient ID.
      // This is terminal for the stale/mismatched local receive, not a reason
      // to surface the same error on every polling interval.
      if (!String(error).includes('Cannot change ACK')) throw error
    }
    this.recordReceiveOutcome(
      receive,
      'rejected',
      item.txid || receive.pendingAccept?.txid || receive.receivedConsignment?.txid || ''
    )
  }

  private runPendingTransferOperation<T>(transferId: string, operation: () => Promise<T>) {
    const previous = this.pendingTransferOperations.get(transferId) || Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    const settled = current.then(
      () => undefined,
      () => undefined
    )
    this.pendingTransferOperations.set(transferId, settled)
    void settled.then(() => {
      if (this.pendingTransferOperations.get(transferId) === settled) {
        this.pendingTransferOperations.delete(transferId)
      }
    })
    return current
  }

  /**
   * Polling, Accept and Reject all update `pendingReceives` and may each write
   * two recovery checkpoints. Keep those transitions ordered so one invoice
   * cannot persist a stale snapshot over another invoice's ACK state.
   */
  private runPendingReceiveOperation<T>(operation: () => Promise<T>) {
    const current = this.pendingReceiveOperation.catch(() => undefined).then(operation)
    this.pendingReceiveOperation = current.then(
      () => undefined,
      () => undefined
    )
    return current
  }

  private selectUtxos(assetId: string, amount: string, allowedOutpoints?: Set<string>) {
    const state = this.requireState()
    let required: bigint
    try {
      required = BigInt(amount)
    } catch {
      throw new RgbServiceError('RGB amount must be an unsigned integer')
    }
    if (required <= 0n) throw new RgbServiceError('RGB amount must be positive')

    const locked = new Set(
      Object.values(state.pending).flatMap(pending =>
        pending.prepared.lockedOutpoints.map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
      )
    )
    const candidates = state.snapshot.utxos
      .filter(
        utxo =>
          // A locally issued NIA may be spent by a child transaction while
          // its genesis outpoint is still in the mempool.
          (utxo.chainStatus === undefined ||
            utxo.chainStatus === 'confirmed' ||
            utxo.chainStatus === 'mempool') &&
          (allowedOutpoints === undefined || allowedOutpoints.has(outpointKey(utxo))) &&
          !locked.has(outpointKey(utxo))
      )
      .map(utxo => ({ utxo, amount: getSpendableAmount(utxo, assetId) }))
      .filter(candidate => candidate.amount > 0n)
      .sort((a, b) => (a.amount === b.amount ? 0 : a.amount < b.amount ? -1 : 1))

    if (allowedOutpoints !== undefined) {
      const total = candidates.reduce((sum, candidate) => sum + candidate.amount, 0n)
      if (total < required) throw new RgbInsufficientBalanceError(assetId, amount)
      // Every RGB carrier already present in the Bitcoin transaction must be
      // represented in the transition; selecting only a smaller subset would
      // spend the remaining carrier without moving its RGB allocations.
      return candidates.map(candidate => candidate.utxo)
    }

    const exact = candidates.find(candidate => candidate.amount === required)
    if (exact) return [exact.utxo]

    const selected: RgbUtxo[] = []
    let total = 0n
    for (const candidate of candidates) {
      selected.push(candidate.utxo)
      total += candidate.amount
      if (total >= required) return selected
    }
    throw new RgbInsufficientBalanceError(assetId, amount)
  }

  private async verifySelectedUtxos(wallet: RgbWalletRef, selectedUtxos: RgbUtxo[]) {
    const verifyUtxos = this.dependencies.stateSource.verifyUtxos
    if (!verifyUtxos) return
    const verified = await verifyUtxos(wallet, selectedUtxos)
    const statuses = new Map(
      verified.map(item => [`${item.outpoint.txid}:${item.outpoint.vout}`, item.status])
    )
    const unavailable = selectedUtxos.find(utxo => {
      const status = statuses.get(outpointKey(utxo))
      return status !== 'confirmed' && status !== 'mempool'
    })
    if (unavailable) {
      throw new RgbServiceError('Selected RGB allocation is no longer spendable')
    }
  }

  private requireState() {
    if (!this.state) throw new RgbServiceError('RGB service is not open')
    return this.state
  }

  /** Only tasks that can be overwritten by a stale snapshot may block its refresh. */
  private hasPendingSnapshotProtection() {
    const state = this.requireState()
    return Boolean(state.pendingUtxoSync || state.pendingIssues?.length)
  }

  private async persist(
    options: {
      waitForRecovery?: boolean
      skipRecovery?: boolean
      recoveryCheckpointKind?: 'normal' | 'replacement'
    } = {}
  ) {
    const state = this.requireState()
    this.pruneExpiredProviderOrigins()
    // A dirty or unverified checkpoint must still retry during a later sync,
    // even when the latest snapshot itself is unchanged.
    const shouldQueueRecovery =
      this.recoveryBackupEnabled &&
      this.dependencies.onStatePersisted &&
      (!options.skipRecovery ||
        state.recoveryCheckpoint?.dirty ||
        !state.recoveryCheckpoint?.verified)
    if (shouldQueueRecovery) {
      state.recoveryCheckpoint = { ...state.recoveryCheckpoint, dirty: true, verified: false }
    }
    const persisted = persistState(state)
    await this.dependencies.storage.set(this.storageKey(state.wallet), persisted)
    if (shouldQueueRecovery) {
      const reason = !options.skipRecovery
        ? 'state_change'
        : state.recoveryCheckpoint?.dirty
          ? 'retry_dirty'
          : 'retry_unverified'
      const recovery = Promise.resolve(
        this.dependencies.onStatePersisted(recoverySnapshot(persisted), {
          reason,
          kind: options.recoveryCheckpointKind || 'normal',
        })
      )
      if (options.waitForRecovery) {
        const result = await recovery
        if (result && typeof result === 'object' && result.saved === false) {
          await this.markRecoveryConflict()
          throw new RgbServiceError('RGB recovery checkpoint conflicts with a newer remote state')
        }
        await this.recordRecoveryCheckpointVersion(
          result && typeof result === 'object' ? result.updatedAt : undefined
        )
        await this.setRecoveryCheckpointRevision(
          result && typeof result === 'object' ? result.revision : undefined
        )
        await this.setRecoveryCheckpointGeneration(
          result && typeof result === 'object' ? result.generation : undefined
        )
        await this.setRecoveryCheckpointKind(
          result && typeof result === 'object' ? result.kind : undefined
        )
        await this.recordRecoveryCheckpointResult(result)
      } else {
        void recovery
          .then(async result => {
            if (result && typeof result === 'object' && result.saved === false) {
              await this.markRecoveryConflict()
              return
            }
            await this.recordRecoveryCheckpointVersion(
              result && typeof result === 'object' ? result.updatedAt : undefined
            )
            await this.setRecoveryCheckpointRevision(
              result && typeof result === 'object' ? result.revision : undefined
            )
            await this.setRecoveryCheckpointGeneration(
              result && typeof result === 'object' ? result.generation : undefined
            )
            await this.setRecoveryCheckpointKind(
              result && typeof result === 'object' ? result.kind : undefined
            )
            await this.recordRecoveryCheckpointResult(result)
          })
          .catch(() => undefined)
      }
    }
  }

  private async recordRecoveryCheckpointResult(
    result: void | {
      verified?: boolean
      checksum?: string
      totalLength?: number
      revision?: string
    }
  ) {
    const state = this.requireState()
    const metadata = result && typeof result === 'object' ? result : undefined
    state.recoveryCheckpoint = {
      dirty: false,
      verified: metadata?.verified === true,
      ...(metadata?.checksum ? { checksum: metadata.checksum } : {}),
      ...(metadata?.totalLength === undefined ? {} : { totalLength: metadata.totalLength }),
      ...(metadata?.verified === true
        ? {}
        : { lastError: 'checkpoint read-back is pending verification' }),
    }
    await this.dependencies.storage.set(this.storageKey(state.wallet), persistState(state))
  }

  /**
   * A user-visible operation is not committed until its recovery checkpoint
   * succeeds. Restore both memory and encrypted storage when it fails, so a
   * reported failure cannot leave an invisible invoice or locked send behind.
   */
  private async persistWithRecoveryRollback(
    rollback: RgbServiceState,
    options: { skipRecovery?: boolean } = {}
  ) {
    try {
      await this.persist({ waitForRecovery: true, ...options })
    } catch (error) {
      const recoveryConflict = this.hasRecoveryConflict()
      this.state = rollback
      if (recoveryConflict) {
        rollback.recoveryConflict = true
        this.recoveryBackupEnabled = false
      }
      await this.dependencies.storage.set(this.storageKey(rollback.wallet), persistState(rollback))
      throw error
    }
  }

  private storageKey(wallet: RgbWalletRef) {
    return `${STORAGE_PREFIX}${wallet.network}:${wallet.fundingAddress}`
  }

  /** Remove expired browser-origin metadata while retaining the transfer history itself. */
  private pruneExpiredProviderOrigins() {
    const now = this.now()
    let changed = false
    this.requireState().pendingSendHistory?.forEach(history => {
      if (!history.providerOrigin) return
      // Records written before the TTL field existed expire relative to their
      // original history timestamp, rather than retaining an owner forever.
      const expiresAt =
        history.providerOriginExpiresAt ?? history.createdAt + PROVIDER_ORIGIN_HISTORY_TTL_MS
      if (expiresAt > now) return
      delete history.providerOrigin
      delete history.providerOriginExpiresAt
      changed = true
    })
    return changed
  }

  private queueAssetMetadata(assetId: string, metadata: RgbPendingAssetMetadata['metadata']) {
    const state = this.requireState()
    const normalized = normalizeAssetId(assetId)
    const pending = state.pendingAssetMetadata || (state.pendingAssetMetadata = [])
    const existing = pending.find(item => item.assetId === normalized)
    if (existing) {
      const changed = Object.keys(metadata).some(
        key =>
          existing.metadata[key as keyof typeof metadata] !== metadata[key as keyof typeof metadata]
      )
      if (changed) existing.metadata = metadata
      return changed
    }
    pending.push({ assetId: normalized, metadata })
    return true
  }

  /** Recover metadata from received consignments saved before metadata indexing existed. */
  private hydrateStoredContractMetadata() {
    const state = this.requireState()
    for (const [assetId, contract] of Object.entries(state.contracts || {})) {
      if (contract.metadata) continue
      try {
        const decoded = decodeNiaConsignment(
          Uint8Array.from(Buffer.from(contract.consignment, 'base64'))
        )
        contract.metadata = decoded.metadata
        this.queueAssetMetadata(assetId, decoded.metadata)
      } catch {
        // Locally stored contract placeholders may not be complete NIA consignments.
      }
    }
  }
}

/** Encrypted feature storage is JSON-based; only the RGB blind-seal u64 crosses this boundary. */
function persistState(state: RgbServiceState) {
  return {
    ...state,
    pendingReceives: state.pendingReceives?.map(receive => ({
      ...receive,
      ...(receive.seal ? { seal: persistBlindSeal(receive.seal) } : {}),
    })),
    ...(state.receivedBlindSeals
      ? { receivedBlindSeals: state.receivedBlindSeals.map(persistBlindSeal) }
      : {}),
  }
}

/** Delivery progress and recovery cursors are local metadata, never part of the remote checkpoint. */
function recoverySnapshot(state: ReturnType<typeof persistState>) {
  const {
    recoveryCheckpoint: _recoveryCheckpoint,
    recoveryCheckpointUpdatedAt: _recoveryCheckpointUpdatedAt,
    recoveryCheckpointRevision: _recoveryCheckpointRevision,
    recoveryCheckpointGeneration: _recoveryCheckpointGeneration,
    recoveryCheckpointKind: _recoveryCheckpointKind,
    recoveryRemoteStateKnown: _recoveryRemoteStateKnown,
    recoveryConflict: _recoveryConflict,
    pending,
    pendingSendHistory,
    ...snapshot
  } = state
  return {
    ...snapshot,
    pending: Object.fromEntries(
      Object.entries(pending).map(([transferId, transfer]) => {
        const { providerOrigin: _providerOrigin, ...recoveryTransfer } = transfer
        return [transferId, recoveryTransfer]
      })
    ),
    ...(pendingSendHistory
      ? {
          pendingSendHistory: pendingSendHistory.map(item => {
            const {
              providerOrigin: _providerOrigin,
              providerOriginExpiresAt: _providerOriginExpiresAt,
              ...recoveryHistory
            } = item
            return recoveryHistory
          }),
        }
      : {}),
  }
}

function stripProviderOrigins(state: RgbServiceState) {
  Object.values(state.pending).forEach(transfer => delete transfer.providerOrigin)
  state.pendingSendHistory?.forEach(item => {
    delete item.providerOrigin
    delete item.providerOriginExpiresAt
  })
}

/** Compare checkpoint data without relying on object insertion order. */
function stableRecoveryJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableRecoveryJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableRecoveryJson(record[key])}`)
    .join(',')}}`
}

/** Snapshot polling timestamps are local freshness metadata, not wallet state. */
function comparableRecoveryState(value: unknown) {
  if (!value || typeof value !== 'object') return value
  const state = value as Record<string, unknown>
  const snapshot = state['snapshot']
  if (!snapshot || typeof snapshot !== 'object') return value
  return {
    ...state,
    snapshot: { ...(snapshot as Record<string, unknown>), syncedAt: 0 },
  }
}

/** JSON persistence is the state boundary; cloning it also preserves blind-seal u64 values. */
function snapshotState(state: RgbServiceState): RgbServiceState {
  return hydrateState(JSON.parse(JSON.stringify(persistState(state))))
}

function hydrateState(state: RgbServiceState) {
  return {
    ...state,
    pendingReceives: state.pendingReceives?.map(receive => ({
      ...receive,
      ...(receive.seal ? { seal: hydrateBlindSeal(receive.seal) } : {}),
    })),
    receivedBlindSeals: state.receivedBlindSeals?.map(hydrateBlindSeal),
  } as RgbServiceState
}

function persistBlindSeal(seal: import('./protocol/receive').RgbBlindSeal) {
  return { ...seal, blinding: seal.blinding.toString() }
}

function isRgbServiceState(value: unknown): value is RgbServiceState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<RgbServiceState>
  return (
    state.version === 1 &&
    !!state.wallet &&
    typeof state.wallet.fundingAddress === 'string' &&
    !!state.snapshot &&
    Array.isArray(state.snapshot.utxos) &&
    !!state.pending &&
    typeof state.pending === 'object'
  )
}

function sameRecoveryWallet(recovery: RgbWalletRef, current: RgbWalletRef) {
  return (
    recovery.fundingAddress === current.fundingAddress &&
    recovery.network === current.network &&
    recovery.walletId === current.walletId
  )
}

/** Validate structural/identity invariants before an imported state becomes live. */
function validateRecoveredState(state: RgbServiceState, currentWallet: RgbWalletRef) {
  if (!sameRecoveryWallet(state.wallet, currentWallet)) {
    throw new RgbServiceError('RGB recovery checkpoint does not belong to this wallet')
  }
  if (!Number.isSafeInteger(state.snapshot.syncedAt) || state.snapshot.syncedAt < 0) {
    throw new RgbServiceError('RGB recovery checkpoint snapshot is invalid')
  }
  if (
    state.releasedReceiveRecipientIds !== undefined &&
    (!Array.isArray(state.releasedReceiveRecipientIds) ||
      state.releasedReceiveRecipientIds.length > 65_535 ||
      !state.releasedReceiveRecipientIds.every(
        recipientId =>
          typeof recipientId === 'string' && recipientId.length > 0 && recipientId.length <= 2_048
      ))
  ) {
    throw new RgbServiceError('RGB recovery checkpoint contains invalid receive release records')
  }
  for (const utxo of state.snapshot.utxos) {
    if (
      !utxo ||
      !/^[0-9a-f]{64}$/i.test(utxo.outpoint?.txid || '') ||
      !Number.isInteger(utxo.outpoint?.vout) ||
      utxo.outpoint.vout < 0 ||
      !Number.isSafeInteger(utxo.satoshis) ||
      utxo.satoshis < 0 ||
      !Array.isArray(utxo.allocations)
    ) {
      throw new RgbServiceError('RGB recovery checkpoint contains an invalid UTXO')
    }
    for (const allocation of utxo.allocations) {
      if (
        !allocation ||
        typeof allocation.amount !== 'string' ||
        !/^(0|[1-9][0-9]*)$/.test(allocation.amount) ||
        typeof allocation.settled !== 'boolean' ||
        typeof allocation.spendable !== 'boolean'
      ) {
        throw new RgbServiceError('RGB recovery checkpoint contains an invalid allocation')
      }
    }
  }
  for (const [assetId, contract] of Object.entries(state.contracts || {})) {
    try {
      normalizeAssetId(assetId)
    } catch {
      throw new RgbServiceError('RGB recovery checkpoint contains an invalid contract asset ID')
    }
    if (!contract || typeof contract.consignment !== 'string') {
      throw new RgbServiceError('RGB recovery checkpoint contains an invalid contract')
    }
    if (contract.history) {
      const { payload, opIds, updatedAt } = contract.history
      // Check the JSON/base64 boundary here. Full strict decoding is repeated
      // by the local encoder before any spend, where asset and parent links
      // are also verified against the selected allocations.
      if (
        typeof payload !== 'string' ||
        !isBase64(payload) ||
        payload.length > MAX_RECOVERY_HISTORY_PAYLOAD_LENGTH ||
        !Array.isArray(opIds) ||
        opIds.length > MAX_RECOVERY_HISTORY_OPERATION_IDS ||
        !opIds.every(opId => typeof opId === 'string' && /^[0-9a-f]{64}$/i.test(opId)) ||
        !Number.isSafeInteger(updatedAt) ||
        updatedAt < 0
      ) {
        throw new RgbServiceError('RGB recovery checkpoint contains an invalid local history')
      }
    }
  }
  for (const issue of state.issueHistory || []) {
    try {
      normalizeAssetId(issue.assetId)
    } catch {
      throw new RgbServiceError(
        'RGB recovery checkpoint contains an invalid issue history asset ID'
      )
    }
    if (
      !/^(0|[1-9][0-9]*)$/.test(issue.amount) ||
      !/^[0-9a-f]{64}$/i.test(issue.txid) ||
      !Number.isSafeInteger(issue.createdAt) ||
      issue.createdAt < 0 ||
      !issue.asset ||
      typeof issue.asset.ticker !== 'string' ||
      typeof issue.asset.name !== 'string' ||
      !Number.isInteger(issue.asset.precision) ||
      typeof issue.asset.schema !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(issue.asset.issuedSupply) ||
      (issue.chainStatus !== undefined &&
        !['mempool', 'confirmed', 'pending_spend', 'spent', 'replaced', 'unknown'].includes(
          issue.chainStatus
        ))
    ) {
      throw new RgbServiceError('RGB recovery checkpoint contains an invalid issue history item')
    }
  }
}

function isBase64(value: string) {
  return (
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
}

function hydrateBlindSeal(seal: import('./protocol/receive').RgbBlindSeal) {
  return { ...seal, blinding: BigInt(seal.blinding as any) }
}

function sameBlindSeal(
  left: import('./protocol/receive').RgbBlindSeal,
  right: import('./protocol/receive').RgbBlindSeal
) {
  return left.txid === right.txid && left.vout === right.vout && left.blinding === right.blinding
}

function randomU64() {
  const bytes = randomBytes(8)
  return bytes.reduce((value, byte, index) => value | (BigInt(byte) << BigInt(index * 8)), 0n)
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length)
  if (!globalThis.crypto?.getRandomValues)
    throw new RgbServiceError('Secure random generation is unavailable')
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

function isInvoiceUnavailableUploadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.toLowerCase().includes('cannot change uploaded file')
}

function normalizeAssetId(assetId: string) {
  return normalizeRgbAssetId(assetId)
}

function contractOperationId(assetId: string) {
  try {
    return rgbContractIdHex(assetId)
  } catch {
    // Lightweight test doubles may use a symbolic asset ID instead of a real ContractId.
    return assetId.replace(/^rgb:/i, '').toLowerCase()
  }
}

function normalizeSnapshot(snapshot: RgbWalletSnapshot): RgbWalletSnapshot {
  return {
    ...snapshot,
    utxos: snapshot.utxos.map(utxo => ({
      ...utxo,
      allocations: utxo.allocations.map(allocation => ({
        ...allocation,
        assetId: normalizeAssetId(allocation.assetId),
      })),
    })),
  }
}

/** syncedAt is polling metadata, not recoverable RGB wallet state. */
function sameSnapshotContents(left: RgbWalletSnapshot, right: RgbWalletSnapshot) {
  return JSON.stringify(left.utxos) === JSON.stringify(right.utxos)
}

function normalizeStateAssetIds(state: RgbServiceState): RgbServiceState {
  state.snapshot = normalizeSnapshot(state.snapshot)
  for (const pending of Object.values(state.pending)) {
    pending.request.assetId = normalizeAssetId(pending.request.assetId)
  }
  state.pendingReceives?.forEach(receive => {
    if (receive.assetId) receive.assetId = normalizeAssetId(receive.assetId)
    if (receive.pendingAccept)
      receive.pendingAccept.assetId = normalizeAssetId(receive.pendingAccept.assetId)
    if (receive.receivedConsignment?.assetId)
      receive.receivedConsignment.assetId = normalizeAssetId(receive.receivedConsignment.assetId)
  })
  state.pendingReceiveHistory?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  state.pendingSendHistory?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  state.pendingIssues?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  state.issueHistory?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  state.pendingAssetMetadata?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  if (state.contracts) {
    state.contracts = Object.fromEntries(
      Object.entries(state.contracts).map(([assetId, contract]) => [
        normalizeAssetId(assetId),
        contract.history
          ? {
              ...contract,
              history: {
                ...contract.history,
                opIds: contract.history.opIds.map(opId => opId.toLowerCase()),
              },
            }
          : contract,
      ])
    )
  }
  return state
}
