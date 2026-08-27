import {
  RgbInvoiceUnavailableError,
  RgbInsufficientBalanceError,
  RgbServiceError,
  RgbTransferAwaitingAckError,
  RgbTransferRejectedError,
} from './errors'
import { decodeRgbInvoice } from './protocol/invoice'
import { normalizeRgbAssetId, rgbContractIdHex } from './protocol/contract-id'
import {
  decodeNiaConsignment,
  niaConsignmentSpendableOutputScripts,
  validateNiaConsignmentParentSpends,
  validateNiaConsignmentParentState,
} from './protocol/nia-consignment'
import { concealBlindSeal, encodeBlindRgbInvoice } from './protocol/receive'
import { planFungibleTransition } from './protocol/transition'
import type {
  RgbCompletedTransfer,
  RgbPreparedTransfer,
  RgbPendingIssue,
  RgbPendingAssetMetadata,
  RgbPendingTransfer,
  RgbPendingUtxoSync,
  RgbServiceDependencies,
  RgbServiceState,
  RgbTransferRequest,
  RgbUtxo,
  RgbWalletRef,
  RgbWalletSnapshot,
} from './types'

const STORAGE_PREFIX = 'rgb-service:v1:'

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
  private openedFromStorage = false
  private recoveryBackupEnabled = false

  constructor(private readonly dependencies: RgbServiceDependencies) {
    this.now = dependencies.now || (() => Date.now())
  }

  async open(wallet: RgbWalletRef) {
    const storageKey = this.storageKey(wallet)
    const stored = await this.dependencies.storage.get<RgbServiceState>(storageKey)
    this.openedFromStorage = Boolean(stored && stored.wallet.fundingAddress === wallet.fundingAddress)
    this.recoveryBackupEnabled =
      this.openedFromStorage && stored?.recoveryRemoteStateKnown !== false && !stored?.recoveryConflict
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

  hasRecoveryConflict() {
    return this.requireState().recoveryConflict === true
  }

  getRecoveryCheckpointStatus() {
    const checkpoint = this.requireState().recoveryCheckpoint
    return {
      dirty: checkpoint?.dirty === true,
      verified: checkpoint?.verified === true,
      ...(checkpoint?.lastError ? { lastError: checkpoint.lastError } : {}),
    }
  }

  async retryRecoveryCheckpoint() {
    const state = this.requireState()
    if (!this.recoveryBackupEnabled || !this.dependencies.onStatePersisted) return false
    if (!state.recoveryCheckpoint?.dirty && state.recoveryCheckpoint?.verified) return true
    await this.persist({ waitForRecovery: true })
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

  async markRecoveryConflict() {
    const state = this.requireState()
    this.recoveryBackupEnabled = false
    state.recoveryConflict = true
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
      validateRecoveredState(restored, current.wallet)
      restored.recoveryRemoteStateKnown = true
      // Checkpoint delivery metadata is installation-local and must never be
      // accepted from a remote snapshot (including old snapshot formats).
      delete restored.recoveryCheckpoint
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
    const snapshot = normalizeSnapshot(await this.dependencies.stateSource.getSnapshot(state.wallet))
    // Indexers commonly advance syncedAt on every response even if neither
    // UTXOs nor allocations changed. Keep that local freshness marker, but
    // do not turn polling into a full encrypted checkpoint upload.
    const checkpointSnapshotChanged = !sameSnapshotContents(state.snapshot, snapshot)
    state.snapshot = snapshot
    await this.persist({ skipRecovery: !checkpointSnapshotChanged })
    return state.snapshot
  }

  /** Advance sender ACK/broadcast state without fetching the full UTXO snapshot. */
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
          else if (pending.delivery) await this.advancePendingDelivery(transferId, pending)
        } catch (error) {
          // A delivery awaiting its recipient is a durable local state, not a
          // wallet-wide sync failure. A rejection has already removed its
          // pending transfer and recorded history, so later work can continue too.
          if (
            error instanceof RgbTransferAwaitingAckError ||
            error instanceof RgbTransferRejectedError
          ) {
            return
          }
          throw error
        }
      })
    }
  }

  async createBlindReceive(input: { assetId?: string; amount?: string; durationSeconds?: number }) {
    const state = this.requireState()
    if (!state.snapshot.syncedAt) await this.sync()
    const assetId = input.assetId ? normalizeAssetId(input.assetId) : undefined
    if (input.amount !== undefined && !assetId) {
      throw new RgbServiceError('A fixed RGB receive amount requires an asset ID')
    }
    if (input.amount !== undefined && !/^(0|[1-9][0-9]*)$/.test(input.amount)) {
      throw new RgbServiceError('RGB receive amount must be an unsigned integer')
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
      address: state.wallet.fundingAddress,
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
    await this.persistWithRecoveryRollback(rollback)
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

  getPendingReceiveHistory() {
    return this.requireState().pendingReceiveHistory || []
  }

  getPendingUtxoSync() {
    return this.requireState().pendingUtxoSync
  }

  getPendingIssues() {
    return this.requireState().pendingIssues || []
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
    if (next.length === pending.length) return
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
      ...this.getPendingReceives().map(receive => receive.seal),
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

  private getUnallocatedReceiveUtxos(chainStatus: RgbUtxo['chainStatus']) {
    const state = this.requireState()
    const reserved = new Set(
      this.getPendingReceives().map(receive => `${receive.seal.txid}:${receive.seal.vout}`)
    )
    return state.snapshot.utxos.filter(
      utxo =>
        utxo.chainStatus === chainStatus &&
        utxo.allocations.length === 0 &&
        !reserved.has(outpointKey(utxo))
    )
  }

  async processClaimedReceives({
    includeClaimed = true,
    deferConfirmedSettlement = false,
  }: { includeClaimed?: boolean; deferConfirmedSettlement?: boolean } = {}) {
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
              recipientId: receive.recipientId,
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
      const receiveIndex = pending.findIndex(receive => receive.recipientId === item.recipientId)
      if (receiveIndex < 0) continue
      const receive = pending[receiveIndex]!
      try {
        const match = this.validateIncomingConsignment(receive, item)
        if (!match) {
          await this.acknowledgeProxyConsignment(item, false)
          continue
        }
        if (receive.rejectedConsignmentTxids?.includes(match.txid)) continue

        const metadataChanged = this.queueAssetMetadata(match.assetId, match.decoded.metadata)
        changed = metadataChanged || changed

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

        // Sender cancellation only applies before acceptance. Once the user
        // ACKs, the sender may have broadcast already, so the local receipt
        // must be retained until chain settlement even if the proxy later
        // reports ack=false.
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
          } else if (receive.receivedConsignment.broadcastDetectedAt) {
            changed = true
          }
          continue
        }

        // Stage for explicit Accept/Reject — do not ACK yet.
        if (
          !receive.pendingAccept ||
          receive.pendingAccept.txid !== match.txid ||
          receive.pendingAccept.payload !== item.payload
        ) {
          receive.pendingAccept = {
            payload: item.payload,
            txid: match.txid,
            endpoint: item.endpoint,
            assetId: match.assetId,
            amount: match.amount,
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
        await this.acknowledgeProxyConsignment(item, false)
        throw error
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
    const state = this.requireState()
    const pending = state.pendingReceives || []
    const receive = pending.find(item => item.recipientId === recipientId)
    if (!receive?.pendingAccept) {
      throw new RgbServiceError(`RGB receive ${recipientId} is not awaiting acceptance`)
    }
    if (
      !receive.receivedConsignment?.acknowledgementPending &&
      (await this.isReceiveCanceledBySender(receive))
    ) {
      this.recordReceiveOutcome(receive, 'canceled', receive.pendingAccept.txid)
      state.pendingReceives = pending.filter(item => item.recipientId !== recipientId)
      await this.persist()
      return { accepted: false, status: 'canceled' as const }
    }

    const item = {
      recipientId,
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
        state.pendingReceives = pending.filter(item => item.recipientId !== recipientId)
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
    const state = this.requireState()
    const pending = state.pendingReceives || []
    const receive = pending.find(item => item.recipientId === recipientId)
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
        recipientId,
        endpoint: pendingAccept!.endpoint,
      },
      false
    )
    this.recordReceiveOutcome(receive, 'rejected', pendingAccept!.txid)
    // Proxy recipient IDs are single-use upload keys. Once a consignment has
    // been posted, a later transfer cannot replace its file even after NACK.
    // Discard the invoice so the user creates a fresh blinded recipient ID.
    state.pendingReceives = pending.filter(item => item.recipientId !== recipientId)
    await this.persist()
    return { rejected: true }
  }

  private validateIncomingConsignment(
    receive: import('./types').RgbPendingReceive,
    item: { recipientId: string; payload: string; txid?: string; endpoint?: string }
  ) {
    const secretSeal = Buffer.from(concealBlindSeal(receive.seal)).toString('hex')
    const decoded = decodeNiaConsignment(Uint8Array.from(Buffer.from(item.payload, 'base64')))
    validateNiaConsignmentParentSpends(decoded)
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
    if (deferConfirmedSettlement) return 'snapshot_required' as const

    const utxo = state.snapshot.utxos.find(
      candidate =>
        candidate.outpoint.txid === receive.seal.txid &&
        candidate.outpoint.vout === receive.seal.vout
    )
    if (!utxo) return false
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
    const receivedBlindSeals = state.receivedBlindSeals || (state.receivedBlindSeals = [])
    if (!receivedBlindSeals.some(seal => sameBlindSeal(seal, receive.seal))) {
      receivedBlindSeals.push(receive.seal)
    }
    this.recordReceiveOutcome(receive, 'settled', validated.txid)
    const contracts = state.contracts || (state.contracts = {})
    const assetId = normalizeAssetId(validated.assetId)
    contracts[assetId] = {
      consignment: item.payload,
      genesis: Buffer.from(validated.decoded.genesis.strict).toString('base64'),
      metadata: validated.decoded.metadata,
      createdAt: this.now(),
    }
    this.queueAssetMetadata(assetId, validated.decoded.metadata)
    return true
  }

  private recordReceiveOutcome(
    receive: import('./types').RgbPendingReceive,
    status: 'settled' | 'canceled' | 'rejected',
    txid: string
  ) {
    const state = this.requireState()
    const pendingReceiveHistory = state.pendingReceiveHistory || (state.pendingReceiveHistory = [])
    const transferId = `receive:${receive.recipientId}`
    const existing = pendingReceiveHistory.find(item => item.transferId === transferId)
    if (existing) {
      existing.status = status
      existing.txid = txid || existing.txid
      existing.counterpartyScriptPubKeys =
        existing.counterpartyScriptPubKeys ||
        receive.pendingAccept?.counterpartyScriptPubKeys ||
        receive.receivedConsignment?.counterpartyScriptPubKeys
      return
    }
    pendingReceiveHistory.push({
      transferId,
      assetId: receive.assetId || receive.pendingAccept?.assetId || '',
      amount: receive.amount || receive.pendingAccept?.amount || '',
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
        recipientId: receive.recipientId,
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
      const consignment = await getConsignment({ recipientId: receive.recipientId, endpoints })
      return !consignment
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
    const pending = this.getPendingReceives()
    try {
      const claimed = await Promise.all(
        pending.map(receive => claim(state.wallet, receive.recipientId))
      )
      return { claimed: claimed.reduce((total, count) => total + count, 0) }
    } catch (error) {
      if (this.dependencies.transport.getConsignment) return { claimed: 0 }
      throw error
    }
  }

  async cancelBlindReceive(recipientId: string) {
    const state = this.requireState()
    const receives = state.pendingReceives || []
    const index = receives.findIndex(item => item.recipientId === recipientId)
    if (index < 0) return { cancelled: false }
    // Acceptance ACKs the consignment and allows the sender to broadcast. The
    // local record is then the durable receipt needed to settle the allocation,
    // so it cannot be released as an unused invoice.
    if (
      receives[index]!.receivedConsignment?.accepted ||
      receives[index]!.receivedConsignment?.acknowledgementPending
    ) {
      return { cancelled: false }
    }
    receives.splice(index, 1)
    await this.persist()
    return { cancelled: true }
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

  getContractGenesis(assetId: string) {
    const contract = this.requireState().contracts?.[normalizeAssetId(assetId)]
    return contract?.genesis
  }

  getSnapshot() {
    return this.requireState().snapshot
  }

  /** Pending sends survive a background restart until completed or explicitly aborted. */
  getPendingTransfers() {
    return Object.entries(this.requireState().pending).map(([id, pending]) => ({ id, ...pending }))
  }

  async prepareSend(request: RgbTransferRequest) {
    const previous = this.prepareSendInFlight
    let release = () => undefined
    const current = new Promise<void>(resolve => {
      release = resolve
    })
    this.prepareSendInFlight = current
    if (previous) await previous

    try {
      return await this.prepareSendOnce(request)
    } finally {
      release()
      if (this.prepareSendInFlight === current) this.prepareSendInFlight = undefined
    }
  }

  /** Reserve RGB allocations and persist the pending transfer as one serialized operation. */
  private async prepareSendOnce(request: RgbTransferRequest) {
    const state = this.requireState()
    const invoice = decodeRgbInvoice(request.invoice)
    const requestedAssetId = normalizeAssetId(request.assetId)
    if (invoice.assetId && invoice.assetId !== requestedAssetId) {
      throw new RgbServiceError('RGB invoice asset does not match the requested asset')
    }
    if (invoice.network && invoice.network !== state.wallet.network) {
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
    const selectedUtxos = this.selectUtxos(requestedAssetId, amount)
    const validationHistory = await this.dependencies.stateSource.getValidationHistory(
      state.wallet,
      {
        assetId: requestedAssetId,
        allocations: selectedUtxos.flatMap(utxo =>
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
        ),
      }
    )
    const localContract = this.getContractConsignment(requestedAssetId)
    const localGenesis = this.getContractGenesis(requestedAssetId)
    if (
      localContract &&
      !validationHistory.consignments.some(item => item.payload === localContract)
    ) {
      validationHistory.consignments.unshift({
        opId: contractOperationId(requestedAssetId),
        payload: localContract,
      })
    }
    if (localContract) validationHistory.localContract = localContract
    if (localGenesis) validationHistory.localGenesis = localGenesis
    validationHistory.knownBlindSeals = this.getKnownBlindSeals()
    const feeFunding = await this.dependencies.feeSource?.getFeeFunding(state.wallet)
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
    const prepared: RgbPreparedTransfer = await this.dependencies.encoder.prepareTransfer({
      wallet: state.wallet,
      snapshot: state.snapshot,
      request: resolvedRequest,
      intent,
      selectedUtxos,
      ...(feeFunding === undefined ? {} : { feeFunding }),
      validationHistory,
    })

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
    state.pending[prepared.id] = { prepared, request: resolvedRequest, createdAt: this.now() }
    await this.persistWithRecoveryRollback(rollback)
    return prepared
  }

  async completeSend(transferId: string, signedPsbt: string): Promise<RgbCompletedTransfer> {
    return this.runPendingTransferOperation(transferId, () =>
      this.completeSendOnce(transferId, signedPsbt)
    )
  }

  private async completeSendOnce(
    transferId: string,
    signedPsbt: string
  ): Promise<RgbCompletedTransfer> {
    const state = this.requireState()
    const pending = state.pending[transferId]
    if (!pending) throw new RgbServiceError(`RGB transfer ${transferId} does not exist`)
    if (pending.broadcast) return this.syncBroadcastedTransfer(transferId, pending)

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

  async abortSend(transferId: string) {
    return this.runPendingTransferOperation(transferId, () => this.abortSendOnce(transferId))
  }

  private async abortSendOnce(transferId: string) {
    const state = this.requireState()
    const pending = state.pending[transferId]
    if (!pending) return { aborted: false }
    // Allow cancel until the Bitcoin transaction is broadcast. Consignment
    // delivery alone is still off-chain and can be discarded by the sender.
    // An acknowledged consignment is committed to the receiver and is about
    // to be broadcast. It is no longer safe to signal cancellation, including
    // while the broadcast request itself is in flight.
    if (pending.broadcast || pending.delivery?.acknowledgedAt) return { aborted: false }

    // Best-effort cancel signal: post ACK=false on the proxy so the receiver
    // can surface "Canceled by sender" instead of waiting forever.
    if (pending.delivery && this.dependencies.transport.acknowledgeConsignment) {
      for (const consignment of pending.delivery.completed.consignments) {
        try {
          await this.dependencies.transport.acknowledgeConsignment({
            recipientId: consignment.recipientId,
            endpoints: pending.delivery.endpoints,
            acknowledged: false,
          })
        } catch {
          // Local abort still proceeds if the proxy signal fails.
        }
      }
    }

    const sendHistory = state.pendingSendHistory || (state.pendingSendHistory = [])
    if (!sendHistory.some(item => item.transferId === transferId)) {
      sendHistory.push({
        transferId,
        assetId: pending.request.assetId,
        amount: pending.request.amount,
        txid: pending.delivery?.completed.txid,
        invoice: pending.request.invoice,
        createdAt: pending.createdAt,
        status: 'canceled',
      })
    }

    delete state.pending[transferId]
    await this.persist()
    return { aborted: true, status: 'canceled' as const }
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
      txid: broadcast.completed.txid,
      invoice: pending.request.invoice,
      createdAt: broadcast.broadcastAt,
      status: 'broadcasted' as const,
    }
    if (existingHistory) Object.assign(existingHistory, broadcastedHistory)
    else sendHistory.push(broadcastedHistory)
    delete state.pending[transferId]
    await this.persist()
    return broadcast.completed
  }

  private async advancePendingDelivery(transferId: string, pending: RgbPendingTransfer) {
    const state = this.requireState()
    const delivery = pending.delivery
    if (!delivery) throw new RgbServiceError(`RGB transfer ${transferId} has not been signed`)
    const consignments = delivery.completed.consignments.map((consignment, index) => ({
      ...consignment,
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
        if (isInvoiceUnavailableUploadError(error)) throw new RgbInvoiceUnavailableError()
        throw error
      }
    }
    if (!delivery.publishedAt) {
      delivery.publishedAt = this.now()
      await this.persist({ waitForRecovery: true })
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
          txid: delivery.completed.txid,
          invoice: pending.request.invoice,
          createdAt: pending.createdAt,
          status: 'rejected',
        })
      }
      delete state.pending[transferId]
      await this.persist()
      throw new RgbTransferRejectedError(transferId, delivery.completed.txid)
    }
    if (acknowledgements.some(acknowledged => acknowledged === undefined)) {
      throw new RgbTransferAwaitingAckError(transferId)
    }
    delivery.acknowledgedAt ||= this.now()
    delete delivery.broadcastError
    await this.persist({ waitForRecovery: true })

    let broadcastTxid: string
    try {
      broadcastTxid = await this.dependencies.broadcaster.broadcast(delivery.completed.rawTx)
    } catch (error) {
      delivery.broadcastError = error instanceof Error ? error.message : String(error)
      await this.persist({ waitForRecovery: true })
      throw error
    }
    if (broadcastTxid !== delivery.completed.txid) {
      throw new RgbServiceError('Broadcast transaction ID does not match the RGB transfer')
    }
    this.applyFundingUpdate(delivery.completed)
    pending.broadcast = { completed: delivery.completed, broadcastAt: this.now() }
    delete pending.delivery
    await this.persist({ waitForRecovery: true })
    return this.syncBroadcastedTransfer(transferId, pending)
  }

  private async getProxyConsignments() {
    const getConsignment = this.dependencies.transport.getConsignment
    if (!getConsignment) return []
    return (
      await Promise.all(
        this.getPendingReceives()
          .filter(
            receive =>
              (!receive.receivedConsignment?.accepted &&
                !receive.receivedConsignment?.acknowledgementPending) ||
              !receive.receivedConsignment.payload
          )
          .map(async receive => {
            const endpoints = decodeRgbInvoice(receive.invoice).transportEndpoints
            if (!endpoints.length) return undefined
            return getConsignment({ recipientId: receive.recipientId, endpoints })
          })
      )
    ).filter((item): item is NonNullable<typeof item> => !!item)
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

  private selectUtxos(assetId: string, amount: string) {
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
          (utxo.chainStatus === undefined || utxo.chainStatus === 'confirmed') &&
          !locked.has(outpointKey(utxo))
      )
      .map(utxo => ({ utxo, amount: getSpendableAmount(utxo, assetId) }))
      .filter(candidate => candidate.amount > 0n)
      .sort((a, b) => (a.amount === b.amount ? 0 : a.amount < b.amount ? -1 : 1))

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

  private requireState() {
    if (!this.state) throw new RgbServiceError('RGB service is not open')
    return this.state
  }

  /** Only tasks that can be overwritten by a stale snapshot may block its refresh. */
  private hasPendingSnapshotProtection() {
    const state = this.requireState()
    return Boolean(state.pendingUtxoSync || state.pendingIssues?.length)
  }

  private async persist(options: { waitForRecovery?: boolean; skipRecovery?: boolean } = {}) {
    const state = this.requireState()
    // A dirty or unverified checkpoint must still retry during a later sync,
    // even when the latest snapshot itself is unchanged.
    const shouldQueueRecovery =
      this.recoveryBackupEnabled &&
      this.dependencies.onStatePersisted &&
      (!options.skipRecovery || state.recoveryCheckpoint?.dirty || !state.recoveryCheckpoint?.verified)
    if (shouldQueueRecovery) {
      state.recoveryCheckpoint = { ...state.recoveryCheckpoint, dirty: true, verified: false }
    }
    const persisted = persistState(state)
    await this.dependencies.storage.set(this.storageKey(state.wallet), persisted)
    if (shouldQueueRecovery) {
      const recovery = Promise.resolve(this.dependencies.onStatePersisted(recoverySnapshot(persisted)))
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
            await this.recordRecoveryCheckpointResult(result)
          })
          .catch(() => undefined)
      }
    }
  }

  private async recordRecoveryCheckpointResult(
    result:
      | void
      | { verified?: boolean; checksum?: string; totalLength?: number; revision?: string }
  ) {
    const state = this.requireState()
    const metadata = result && typeof result === 'object' ? result : undefined
    state.recoveryCheckpoint = {
      dirty: false,
      verified: metadata?.verified === true,
      ...(metadata?.checksum ? { checksum: metadata.checksum } : {}),
      ...(metadata?.totalLength === undefined ? {} : { totalLength: metadata.totalLength }),
      ...(metadata?.verified === true ? {} : { lastError: 'checkpoint read-back is pending verification' }),
    }
    await this.dependencies.storage.set(this.storageKey(state.wallet), persistState(state))
  }

  /**
   * A user-visible operation is not committed until its recovery checkpoint
   * succeeds. Restore both memory and encrypted storage when it fails, so a
   * reported failure cannot leave an invisible invoice or locked send behind.
   */
  private async persistWithRecoveryRollback(rollback: RgbServiceState) {
    try {
      await this.persist({ waitForRecovery: true })
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
      seal: persistBlindSeal(receive.seal),
    })),
    receivedBlindSeals: state.receivedBlindSeals?.map(persistBlindSeal),
  }
}

/** Delivery progress is local metadata, never part of the remotely encrypted checkpoint. */
function recoverySnapshot(state: ReturnType<typeof persistState>) {
  const { recoveryCheckpoint: _recoveryCheckpoint, ...snapshot } = state
  return snapshot
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
      seal: hydrateBlindSeal(receive.seal),
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
  const bytes = new Uint8Array(8)
  if (!globalThis.crypto?.getRandomValues)
    throw new RgbServiceError('Secure random generation is unavailable')
  globalThis.crypto.getRandomValues(bytes)
  return bytes.reduce((value, byte, index) => value | (BigInt(byte) << BigInt(index * 8)), 0n)
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
    if (receive.pendingAccept) receive.pendingAccept.assetId = normalizeAssetId(receive.pendingAccept.assetId)
  })
  state.pendingReceiveHistory?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  state.pendingSendHistory?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  state.pendingIssues?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  state.pendingAssetMetadata?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  if (state.contracts) {
    state.contracts = Object.fromEntries(
      Object.entries(state.contracts).map(([assetId, contract]) => [normalizeAssetId(assetId), contract])
    )
  }
  return state
}
