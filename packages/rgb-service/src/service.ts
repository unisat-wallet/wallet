import {
  RgbBfaValidationUnavailableError,
  RgbInvoiceUnavailableError,
  RgbInsufficientBalanceError,
  RgbProxyOperationNotFoundError,
  RgbServiceError,
  RgbTransferAwaitingAckError,
  RgbTransferCanceledError,
  RgbTransferRejectedError,
} from './errors'
import {
  appendRgbInvoiceRecipientNonce,
  decodeRgbInvoice,
  encodeWitnessRgbInvoice,
  witnessRgbInvoiceRecipientId,
} from './protocol/invoice'
import { normalizeRgbAssetId, rgbContractIdHex } from './protocol/contract-id'
import { hashBfaBurnDestinationV1, normalizeBfaBurnDestination } from './protocol/bfa-burn-destination'
import {
  decodeNiaConsignment,
  niaConsignmentSpendableOutputScripts,
  validateNiaConsignmentParentSpends,
  validateNiaConsignmentParentState,
} from './protocol/nia-consignment'
import { mergeNiaConsignmentHistory } from './protocol/nia-history'
import {
  encodeBfaContractConsignment,
  isSupportedV1ContractConsignment,
  isSupportedV1TransferConsignment,
  unwrapRgbContractConsignment,
} from './protocol/bfa-consignment'
import {
  bfaConsignmentWitnessTxids,
  mergeBfaValidatedHistories,
  pruneConfirmedBfaWitnesses,
} from './protocol/bfa-validator'
import { convertNiaV0ConsignmentToV1, unwrapNiaV0Contract } from './protocol/nia-v0-migration'
import { encodeNiaContract, encodeNiaTransferConsignment } from './protocol/nia-contract'
import {
  blindRgbInvoiceRecipientId,
  concealBlindSeal,
  encodeBlindRgbInvoice,
} from './protocol/receive'
import { getSwapPsbtInputOutpoints } from './protocol/opret-transfer'
import { planFungibleTransition } from './protocol/transition'
import type {
  RgbCompletedTransfer,
  RgbFeePoolUtxo,
  RgbLocalAssetBalance,
  RgbLocalAssetDetail,
  RgbPreparedTransfer,
  RgbReceivedConsignment,
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
  private readonly v1AllocationRepairAttempts = new Map<string, number>()

  constructor(private readonly dependencies: RgbServiceDependencies) {
    this.now = dependencies.now || (() => Date.now())
  }

  async open(wallet: RgbWalletRef) {
    this.v1AllocationRepairAttempts.clear()
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
    if (this.state.confirmedBitcoinWitnesses)
      pruneConfirmedBfaWitnesses(this.state.confirmedBitcoinWitnesses)
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
    // A matching wallet can still contain malformed legacy data or encounter
    // a storage failure. Preserve the actual error instead of reporting those
    // failures as a wallet identity mismatch.
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
    const localSnapshotBeforeRequest = JSON.stringify(state.snapshot.utxos)
    const snapshot = normalizeSnapshot(
      await this.dependencies.stateSource.getSnapshot(state.wallet)
    )
    // A receive or broadcast may have queued a newer local allocation while
    // the indexer request was in flight. Never apply that older response.
    if (this.hasPendingSnapshotProtection() ||
      JSON.stringify(state.snapshot.utxos) !== localSnapshotBeforeRequest) return state.snapshot
    // Keep the local funding update while the indexer still returns the RGB
    // allocations that this installation already spent in a broadcast tx.
    // Once those outpoints disappear from the remote snapshot, it is safe to
    // accept the remote state again, once it includes any local burn change.
    if (this.hasStaleBroadcastedFundingOutpoints(snapshot)) return state.snapshot
    if (await this.reconcileLocalBurnChange(snapshot)) return state.snapshot
    // A replica can briefly return the same live outpoint without the
    // allocation we have already validated and settled. Re-publish the local
    // observation rather than treating that omission as a zero balance.
    const remoteOutpoints = new Map(snapshot.utxos.map(utxo => [outpointKey(utxo), utxo]))
    const missingAllocation = state.snapshot.utxos.find(local => {
      const remote = remoteOutpoints.get(outpointKey(local))
      return remote &&
        local.chainStatus !== 'spent' && local.chainStatus !== 'replaced' &&
        local.scriptPubKey === remote.scriptPubKey && local.satoshis === remote.satoshis &&
        local.allocations.some(allocation =>
        !remote.allocations.some(candidate =>
          candidate.opId === allocation.opId &&
          candidate.assignmentIndex === allocation.assignmentIndex &&
          candidate.assetId === allocation.assetId
        )
      )
    })
    if (missingAllocation) {
      state.pendingUtxoSync = {
        txid: missingAllocation.outpoint.txid,
        outpoints: state.snapshot.utxos,
      }
      await this.persist()
      return state.snapshot
    }
    if (await this.repairMissingV1Allocations(snapshot, localSnapshotBeforeRequest))
      return state.snapshot
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

  /** Rebuild an already accepted v1 receive if an older snapshot erased its color. */
  private async repairMissingV1Allocations(
    snapshot: RgbWalletSnapshot,
    localSnapshotBeforeRequest: string
  ): Promise<boolean> {
    const state = this.requireState()
    const validate = this.dependencies.validateBfaConsignment
    const verifyUtxos = this.dependencies.stateSource.verifyUtxos
    if (!validate || !verifyUtxos) return false
    const network = state.wallet.network === 'mainnet' ||
      state.wallet.network === 'fractal-mainnet' || state.wallet.network === 'fractal-test'
      ? 0 : state.wallet.network === 'testnet' ? 1 : state.wallet.network === 'testnet4' ? 2 : 3
    const live = snapshot.utxos.filter(utxo => utxo.chainStatus === 'confirmed')
    if (!live.length) return false
    const receivedBlindOutpoints = new Set((state.receivedBlindSeals || [])
      .map(seal => `${seal.txid}:${seal.vout}`))
    for (const [assetId, contract] of Object.entries(state.contracts || {})) {
      const payload = Uint8Array.from(Buffer.from(contract.history?.payload || contract.consignment, 'base64'))
      let witnessTxids: Set<string>
      try {
        if (!isSupportedV1TransferConsignment(payload)) continue
        witnessTxids = new Set(bfaConsignmentWitnessTxids(payload, network))
      } catch {
        continue
      }
      const candidates = live.filter(utxo =>
        (witnessTxids.has(utxo.outpoint.txid) || receivedBlindOutpoints.has(outpointKey(utxo))) &&
        !utxo.allocations.some(allocation => allocation.assetId === assetId)
      )
      if (!candidates.length) continue
      const key = `${assetId}:${candidates.map(utxo => outpointKey(utxo)).join(',')}`
      const now = this.now()
      if ((this.v1AllocationRepairAttempts.get(key) || 0) + 5 * 60_000 > now) continue
      this.v1AllocationRepairAttempts.set(key, now)
      let validated: Awaited<ReturnType<NonNullable<RgbServiceDependencies['validateBfaConsignment']>>>
      try {
        validated = await validate({
          wallet: state.wallet, payload,
          knownBlindSeals: this.getKnownBlindSeals(),
          confirmedBitcoinWitnesses: state.confirmedBitcoinWitnesses ||= {},
        })
      } catch (error) {
        console.warn('Unable to repair a locally validated RGB v1 allocation', error)
        continue
      }
      if (validated.assetId !== assetId) continue
      const possible = candidates.filter(utxo => validated.allocations.some(allocation =>
        allocation.txid === utxo.outpoint.txid && allocation.vout === utxo.outpoint.vout &&
        (!allocation.scriptPubKey || allocation.scriptPubKey === utxo.scriptPubKey)
      ))
      if (!possible.length) continue
      let verified: Awaited<ReturnType<NonNullable<RgbServiceDependencies['stateSource']['verifyUtxos']>>>
      try {
        verified = await verifyUtxos(state.wallet, possible)
      } catch (error) {
        console.warn('Unable to verify a missing RGB v1 allocation output', error)
        continue
      }
      if (this.hasPendingSnapshotProtection() ||
        JSON.stringify(state.snapshot.utxos) !== localSnapshotBeforeRequest) return true
      const confirmed = new Set(verified.filter(item => item.status === 'confirmed')
        .map(item => `${item.outpoint.txid}:${item.outpoint.vout}`))
      let repairedTxid: string | undefined
      for (const utxo of possible) {
        if (!confirmed.has(outpointKey(utxo))) continue
        for (const allocation of validated.allocations) {
          if (allocation.txid !== utxo.outpoint.txid || allocation.vout !== utxo.outpoint.vout ||
            (allocation.scriptPubKey && allocation.scriptPubKey !== utxo.scriptPubKey)) continue
          if (utxo.allocations.some(item =>
            item.opId === allocation.opId && item.assignmentIndex === allocation.assignmentIndex
          )) continue
          utxo.allocations.push({
            assetId, amount: allocation.amount, settled: true, spendable: true,
            opId: allocation.opId, assignmentIndex: allocation.assignmentIndex,
            assignmentType: 4000,
          })
          repairedTxid = utxo.outpoint.txid
        }
      }
      if (!repairedTxid) continue
      const rollback = snapshotState(state)
      state.snapshot = snapshot
      state.pendingUtxoSync = { txid: repairedTxid, outpoints: snapshot.utxos }
      await this.persistWithRecoveryRollback(rollback)
      return true
    }
    return false
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

  /** Settle verified burn change locally while the indexer catches up with its RGB allocation. */
  private async reconcileLocalBurnChange(snapshot: RgbWalletSnapshot) {
    const state = this.requireState()
    const burnTxids = new Set((state.pendingSendHistory || [])
      .filter(item => item.burn && item.status === 'broadcasted' && item.txid)
      .map(item => item.txid!))
    if (!burnTxids.size) return false
    const remoteOutpoints = new Map(snapshot.utxos.map(utxo => [outpointKey(utxo), utxo]))
    const localChange = state.snapshot.utxos.filter(utxo =>
      burnTxids.has(utxo.outpoint.txid) && utxo.allocations.length > 0 &&
      utxo.chainStatus !== 'spent' && utxo.chainStatus !== 'replaced'
    )
    let changed = false
    let missing = false
    for (const utxo of localChange) {
      const remote = remoteOutpoints.get(outpointKey(utxo))
      const hasRemoteAllocation = remote && utxo.allocations.every(allocation =>
        remote.allocations.some(candidate => candidate.assetId === allocation.assetId &&
          candidate.amount === allocation.amount && candidate.opId === allocation.opId &&
          candidate.assignmentIndex === allocation.assignmentIndex &&
          (remote.chainStatus !== 'confirmed' || (candidate.settled && candidate.spendable)))
      )
      if (hasRemoteAllocation && (remote.chainStatus === 'confirmed' ||
        utxo.allocations.every(allocation => !allocation.settled))) continue
      let status = remote?.chainStatus
      let confirmations = remote?.confirmations || 0
      if (status !== 'confirmed') {
        const verify = this.dependencies.stateSource.verifyUtxos
        if (verify) {
          try {
            const result = await verify(state.wallet, [utxo])
            const verified = result.find(item =>
              item.outpoint.txid === utxo.outpoint.txid && item.outpoint.vout === utxo.outpoint.vout
            )
            status = verified?.status
            confirmations = verified?.confirmations || 0
          } catch {
            // Keep the local allocation until its outpoint can be verified.
          }
        }
      }
      if (status === 'spent' || status === 'replaced') continue
      if (!hasRemoteAllocation || (remote?.chainStatus !== 'confirmed' &&
        utxo.allocations.some(allocation => allocation.settled))) missing = true
      if (status !== 'confirmed' || confirmations < 1 ||
        !utxo.allocations.some(allocation => !allocation.settled || !allocation.spendable)) continue
      utxo.chainStatus = 'confirmed'
      utxo.confirmations = confirmations
      utxo.allocations = utxo.allocations.map(allocation => ({
        ...allocation, settled: true, spendable: true,
      }))
      state.pendingUtxoSync = { txid: utxo.outpoint.txid, outpoints: state.snapshot.utxos }
      changed = true
    }
    if (changed) {
      await this.persist()
      return true
    }
    // A missing output can only be discarded once its exact outpoint is known
    // to be spent or replaced. Transaction confirmation alone is insufficient.
    return missing
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
          else if ((pending.request.donation || pending.request.burn) && pending.delivery?.broadcastError)
            // A failed donation needs an explicit sender retry. Do not let an
            // unavailable broadcaster interrupt synchronization of other sends.
            return
          else if (pending.request.burn && pending.delivery)
            // Burn has no recipient. Only an explicit user action may retry its broadcast.
            return
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
    minConfirmations?: number
    providerOrigin?: string
    /** The caller will immediately claim the recipient and persist the combined state. */
    deferRecoveryCheckpoint?: boolean
  }) {
    const state = this.requireState()
    if (input.minConfirmations !== undefined && (!Number.isSafeInteger(input.minConfirmations) || input.minConfirmations < 1))
      throw new RgbServiceError('RGB receive minConfirmations must be a positive integer')
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
    const expirationTimestamp = Math.floor(now / 1000) + (input.durationSeconds ?? 24 * 60 * 60)
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
    const recipientId = blindRgbInvoiceRecipientId(state.wallet.network, seal)
    const proxyRegistration = this.dependencies.transport.prepareInvoice
      ? await this.dependencies.transport.prepareInvoice({
          recipientId,
          endpoints: transportEndpoints,
          expirationTimestamp,
      })
      : undefined
    const invoiceExpirationTimestamp = proxyRegistration?.expirationTimestamp ?? expirationTimestamp
    const invoice = encodeBlindRgbInvoice({
      network: state.wallet.network,
      seal,
      assetId,
      amount: input.amount,
      expirationTimestamp: invoiceExpirationTimestamp,
      transportEndpoints,
      proxyPublicKey: proxyRegistration?.publicKey,
    })
    const decoded = decodeRgbInvoice(invoice)
    if (
      decoded.recipientType !== 'blind' ||
      decoded.recipientId !== recipientId ||
      decoded.assetId !== assetId
    ) {
      throw new RgbServiceError('Created RGB blind invoice does not match the local receive seal')
    }
    const pending = {
      invoice,
      recipientId,
      ...(proxyRegistration ? { proxyRecipientId: proxyRegistration.invoiceId } : {}),
      ...(proxyRegistration ? {
        proxyPrivateKey: proxyRegistration.privateKey,
        proxyPublicKey: proxyRegistration.publicKey,
        proxyInvoiceId: proxyRegistration.invoiceId,
      } : {}),
      ...(input.minConfirmations === undefined ? {} : { minConfirmations: input.minConfirmations }),
      ...(input.providerOrigin ? { providerOrigin: input.providerOrigin } : {}),
      assetId,
      amount: input.amount,
      expirationTimestamp: invoiceExpirationTimestamp,
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
    minConfirmations?: number
    providerOrigin?: string
    deferRecoveryCheckpoint?: boolean
  }) {
    const state = this.requireState()
    if (input.minConfirmations !== undefined && (!Number.isSafeInteger(input.minConfirmations) || input.minConfirmations < 1))
      throw new RgbServiceError('RGB receive minConfirmations must be a positive integer')
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
    const expirationTimestamp = Math.floor(now / 1000) + (input.durationSeconds ?? 24 * 60 * 60)
    const recipientId = witnessRgbInvoiceRecipientId(state.wallet.network, input.scriptPubKey)
    const proxyRegistration = this.dependencies.transport.prepareInvoice
      ? await this.dependencies.transport.prepareInvoice({
          recipientId,
          endpoints: transportEndpoints,
          expirationTimestamp,
      })
      : undefined
    const invoiceExpirationTimestamp = proxyRegistration?.expirationTimestamp ?? expirationTimestamp
    const invoice = encodeWitnessRgbInvoice({
      network: state.wallet.network,
      scriptPubKey: input.scriptPubKey,
      assetId,
      amount: input.amount,
      expirationTimestamp: invoiceExpirationTimestamp,
      transportEndpoints,
      proxyPublicKey: proxyRegistration?.publicKey,
    })
    const decoded = decodeRgbInvoice(invoice)
    if (
      decoded.recipientType !== 'witness' ||
      decoded.recipientId !== recipientId ||
      decoded.assetId !== assetId
    ) {
      throw new RgbServiceError('Created RGB witness invoice does not match the local receive seal')
    }
    const pending = {
      invoice,
      recipientId,
      ...(proxyRegistration ? {
        proxyPrivateKey: proxyRegistration.privateKey,
        proxyPublicKey: proxyRegistration.publicKey,
        proxyInvoiceId: proxyRegistration.invoiceId,
      } : {}),
      ...(input.minConfirmations === undefined ? {} : { minConfirmations: input.minConfirmations }),
      ...(input.providerOrigin ? { providerOrigin: input.providerOrigin } : {}),
      proxyRecipientId: decoded.proxyRecipientId,
      recipientType: 'witness' as const,
      witnessScriptPubKey: input.scriptPubKey.toLowerCase(),
      witnessPublicKey: input.publicKey.toLowerCase(),
      assetId,
      amount: input.amount,
      expirationTimestamp: invoiceExpirationTimestamp,
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
        !!item.pendingAccept ||
        item.receivedConsignment?.accepted === true ||
        item.receivedConsignment?.acknowledgementPending === true
    )
  }

  hasStoredPendingReceives() {
    return (this.requireState().pendingReceives?.length || 0) > 0
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

  async markUtxoSyncCompleted(txid: string, completed?: RgbPendingUtxoSync) {
    const state = this.requireState()
    if (!state.pendingUtxoSync || state.pendingUtxoSync.txid !== txid ||
      (completed && state.pendingUtxoSync !== completed)) return
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
    return (this.requireState().pendingAssetMetadata || []).filter(item => !item.synced)
  }

  async markAssetMetadataSynced(assetId: string) {
    const state = this.requireState()
    const normalized = normalizeAssetId(assetId)
    const pending = state.pendingAssetMetadata || []
    const item = pending.find(candidate => candidate.assetId === normalized)
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
    if (!item && !markedReceive) return
    if (item) {
      if (state.contracts?.[normalized]?.metadata) {
        state.pendingAssetMetadata = pending.filter(candidate => candidate !== item)
      } else {
        item.synced = true
      }
    }
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
    orderId?: string
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
      ...(input.orderId ? { orderId: input.orderId } : {}),
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

  /** Observe late legacy ACK/NACKs without changing the chain broadcast state. */
  async syncBroadcastedSendAcknowledgements() {
    const getAcknowledgement = this.dependencies.transport.getAcknowledgement
    if (!getAcknowledgement) return
    const history = this.requireState().pendingSendHistory || []
    for (const send of history) {
      if (
        send.status !== 'broadcasted' ||
        !send.recipientAckExpected ||
        send.recipientAck !== undefined ||
        !send.invoice ||
        !send.txid
      ) continue
      let invoice: ReturnType<typeof decodeRgbInvoice>
      try {
        invoice = decodeRgbInvoice(send.invoice)
      } catch {
        continue
      }
      // Proxy v1 donations have no ACK operation. Only the legacy proxy can
      // report a decision after the sender has already broadcast.
      if (invoice.proxyInvoiceId) continue
      let ack: boolean | undefined
      try {
        ack = await getAcknowledgement({
          recipientId: invoice.proxyRecipientId,
          endpoints: invoice.transportEndpoints,
          txid: send.txid,
          assetId: send.assetId,
          payload: '',
          opIds: [],
        })
      } catch {
        // An unavailable proxy must not interrupt unrelated RGB sync work.
        continue
      }
      if (ack === undefined) continue
      send.recipientAck = ack
      await this.persist()
    }
  }

  async markSendHistoryConfirmed(transferId: string) {
    const state = this.requireState()
    const history = state.pendingSendHistory || []
    const next = history.filter(item => item.transferId !== transferId || item.burn)
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
    // Claimed consignments have no txid field. Let validation recover the
    // witness txid from the payload instead of treating an empty ID as a match constraint.
    const receivedItems: Array<RgbReceivedConsignment> = [...received, ...proxyReceived]
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
              proxyTransferId: receipt.proxyTransferId,
              proxySenderPublicKey: receipt.proxySenderPublicKey,
              proxySenderEndpoint: receipt.proxySenderEndpoint,
              proxyConsignmentHash: receipt.proxyConsignmentHash,
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
        const match = await this.validateIncomingConsignment(receive, item)
        if (!match) {
          if (!(await this.rejectInvalidProxyConsignment(receive, item))) continue
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
            } catch (error) {
              if (!(error instanceof RgbProxyOperationNotFoundError &&
                await this.isReceiveAnchorBroadcast(match.txid))) {
                if (isProxySignedTransactionCleared(error)) {
                  this.recordReceiveOutcome(receive, 'canceled', match.txid)
                  pending.splice(receiveIndex, 1)
                  changed = true
                }
                continue
              }
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
            proxyTransferId: item.proxyTransferId,
            proxySenderPublicKey: item.proxySenderPublicKey,
            proxySenderEndpoint: item.proxySenderEndpoint,
            proxyConsignmentHash: item.proxyConsignmentHash,
            assetId: match.assetId,
            amount: match.amount,
            precision,
            discoveredAt: receive.receivedConsignment?.receivedAt || this.now(),
            counterpartyScriptPubKeys: match.counterpartyScriptPubKeys,
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
        if (error instanceof RgbBfaValidationUnavailableError) continue
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
          if (!(await this.rejectInvalidProxyConsignment(receive, item))) continue
        } catch {
          throw error
        }
        pending.splice(receiveIndex, 1)
        changed = true
      }
    }
    // Expiration alone does not prove that an offline receiver has not been
    // sent a consignment. Check the proxy once more before releasing an unused
    // invoice, and keep it if the proxy is unavailable or has a payload.
    const getConsignment = this.dependencies.transport.getConsignment
    if (getConsignment) {
      const now = Math.floor(this.now() / 1000)
      for (let index = pending.length - 1; index >= 0; index--) {
        const receive = pending[index]!
        if (
          !receive.expirationTimestamp || receive.expirationTimestamp > now ||
          receive.pendingAccept || receive.receivedConsignment ||
          receivedByRecipient.has(receive.proxyRecipientId || receive.recipientId)
        ) continue
        let endpoints: string[]
        try {
          endpoints = decodeRgbInvoice(receive.invoice).transportEndpoints
          if (!endpoints.length) continue
          const consignment = await getConsignment({
            recipientId: receive.proxyRecipientId || receive.recipientId,
            endpoints,
            proxyPrivateKey: receive.proxyPrivateKey,
          })
          if (consignment) continue
        } catch {
          // A network or proxy failure cannot establish that this invoice is unused.
          continue
        }
        pending.splice(index, 1)
        this.recordReleasedReceiveRecipient(receive.recipientId)
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
      proxyTransferId: receive.pendingAccept.proxyTransferId,
      proxySenderPublicKey: receive.pendingAccept.proxySenderPublicKey,
      proxySenderEndpoint: receive.pendingAccept.proxySenderEndpoint,
      proxyConsignmentHash: receive.pendingAccept.proxyConsignmentHash,
    }
    const acknowledgementWasPending = receive.receivedConsignment?.acknowledgementPending === true
    if (!acknowledgementWasPending) {
      await this.preflightReceiveHistory(receive.pendingAccept.assetId, item.payload, item.txid)
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
        proxyTransferId: receive.pendingAccept.proxyTransferId,
        proxySenderPublicKey: receive.pendingAccept.proxySenderPublicKey,
        proxySenderEndpoint: receive.pendingAccept.proxySenderEndpoint,
        proxyConsignmentHash: receive.pendingAccept.proxyConsignmentHash,
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
    try {
      await this.acknowledgeProxyConsignment(item, true)
    } catch (error) {
      if (!(error instanceof RgbProxyOperationNotFoundError &&
        await this.isReceiveAnchorBroadcast(item.txid))) {
        if (!isProxySignedTransactionCleared(error)) throw error
        this.recordReceiveOutcome(receive, 'canceled', receive.pendingAccept.txid)
        state.pendingReceives = pending.filter(item => item !== receive)
        await this.persist()
        return { accepted: false, status: 'canceled' as const }
      }
    }
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

    try {
      await this.acknowledgeProxyConsignment(
        {
          recipientId: receive.proxyRecipientId || receive.recipientId,
          endpoint: pendingAccept!.endpoint,
          proxyTransferId: pendingAccept!.proxyTransferId,
          proxySenderPublicKey: pendingAccept!.proxySenderPublicKey,
          proxySenderEndpoint: pendingAccept!.proxySenderEndpoint,
          proxyConsignmentHash: pendingAccept!.proxyConsignmentHash,
        },
        false
      )
    } catch (error) {
      // Donations have no sender ACK operation. Rejection is still a local
      // decision even though the Bitcoin transaction may already be public.
      if (!(error instanceof RgbProxyOperationNotFoundError)) throw error
    }
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

  private async validateIncomingConsignment(
    receive: import('./types').RgbPendingReceive,
    item: { recipientId: string; payload: string; txid?: string; endpoint?: string }
  ) {
    // Proxy v1 consignments have no Bitcoin txid field. Older adapters stored
    // that absence as '', which must not constrain the witness in a NIA payload.
    const expectedTxid = item.txid || undefined
    const payload = Uint8Array.from(Buffer.from(item.payload, 'base64'))
    if (isSupportedV1TransferConsignment(payload)) {
      const validate = this.dependencies.validateBfaConsignment
      if (!validate) throw new RgbServiceError('RGB v1 receive validation is unavailable')
      const bfa = await validate({
        wallet: this.requireState().wallet, payload,
        ...(expectedTxid ? { pendingWitnessTxid: expectedTxid } : { allowPendingLastWitness: true }),
        knownBlindSeals: this.getKnownBlindSeals(),
        confirmedBitcoinWitnesses: this.requireState().confirmedBitcoinWitnesses ||= {},
      })
      const assetId = bfa.assetId
      if (receive.assetId && receive.assetId !== assetId) return undefined
      const secret = receive.seal ? Buffer.from(concealBlindSeal(receive.seal)).toString('hex') : undefined
      // V1 consignments include unspent ancestors; only the appended witness
      // bundle can satisfy this invoice's witness output.
      const latestBundleId = bfa.bundles.at(-1)?.id
      const candidate = bfa.terminalAssignments.find(assignment => {
        if (expectedTxid && assignment.txid !== expectedTxid) return false
        if (receive.recipientType === 'witness') {
          if (!latestBundleId || assignment.bundleId !== latestBundleId) return false
          return assignment.output?.scriptPubKey.toLowerCase() === receive.witnessScriptPubKey?.toLowerCase()
        }
        return assignment.secretSeal === secret && bfa.terminals.some(terminal =>
          terminal.bundleId === assignment.bundleId && terminal.secretSeals.includes(secret!))
      })
      if (!candidate || (receive.amount && receive.amount !== candidate.amount)) return undefined
      const output = candidate.output
      return {
        decoded: { metadata: bfa.metadata, genesis: { strict: bfa.genesis } },
        witness: { outputs: output && candidate.vout >= 0 ? Array.from({ length: candidate.vout + 1 }, (_, index) =>
          index === candidate.vout ? output : undefined) : [] },
        assetId, amount: candidate.amount, txid: candidate.txid,
        vout: receive.seal?.vout ?? candidate.vout,
        opId: candidate.opId, assignmentIndex: candidate.assignmentIndex,
        counterpartyScriptPubKeys: bfa.witnessOutputScripts,
      }
    }
    const decoded = decodeNiaConsignment(payload)
    validateNiaConsignmentParentSpends(decoded)
    if (receive.recipientType === 'witness') {
      const expectedScript = receive.witnessScriptPubKey?.toLowerCase()
      if (!expectedScript) return undefined
      const witness = decoded.witnessBundles.at(-1)
      const match = witness?.transitions
        .flatMap(transition =>
          transition.assignments.map((assignment, assignmentIndex) => ({
            witness,
            transition,
            assignment,
            assignmentIndex,
          }))
        )
        .find(({ witness, assignment }) => {
          if ('secretSeal' in assignment.seal) return false
          const txid = assignment.seal.txid || witness.txid
          const output = witness.outputs[assignment.seal.vout]
          return (
            txid === witness.txid &&
            output?.scriptPubKey.toLowerCase() === expectedScript &&
            (expectedTxid === undefined || witness.txid === expectedTxid)
          )
        })
      if (
        !match ||
        'secretSeal' in match.assignment.seal ||
        (expectedTxid !== undefined && match.witness.txid !== expectedTxid)
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
        counterpartyScriptPubKeys: niaConsignmentSpendableOutputScripts(item.payload),
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
    if (!match || !witness || (expectedTxid !== undefined && witness.txid !== expectedTxid)) {
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
      counterpartyScriptPubKeys: niaConsignmentSpendableOutputScripts(item.payload),
    }
  }

  private async advanceAcceptedReceive(
    receive: import('./types').RgbPendingReceive,
    item: { recipientId: string; payload: string; txid?: string; endpoint?: string },
    validated: NonNullable<Awaited<ReturnType<RgbService['validateIncomingConsignment']>>>,
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
    if (chain.status !== 'confirmed' || chain.confirmations < (receive.minConfirmations || 1)) return false

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
    if (this.needsV1HistoryMerge(assetId, item.payload)) {
      await this.storeAcceptedBfaHistory(assetId, item.payload)
    } else {
      this.storeAcceptedHistory({
        assetId,
        payload: item.payload,
        opId: validated.opId,
        genesis: Buffer.from(validated.decoded.genesis.strict).toString('base64'),
        metadata: validated.decoded.metadata,
      })
    }
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
    if (receive.proxyPrivateKey) return undefined
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
        proxyPrivateKey: receive.proxyPrivateKey,
      })
      return !consignment
    } catch {
      return false
    }
  }

  /** A v1 donation has no sender ACK operation; its valid witness must already be on Bitcoin. */
  private async isReceiveAnchorBroadcast(txid: string) {
    const getStatus = this.dependencies.stateSource.getTransactionStatus
    if (!getStatus) return false
    try {
      const chain = await getStatus(this.requireState().wallet, txid)
      return chain.status === 'mempool' || chain.status === 'confirmed'
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
    const index = receives.findIndex(
      item => item.proxyRecipientId === recipientId || item.recipientId === recipientId
    )
    if (index < 0) return { cancelled: false }
    const removed = receives[index]
    if (!removed) return { cancelled: false }
    // Acceptance ACKs the consignment and allows the sender to broadcast. The
    // local record is then the durable receipt needed to settle the allocation,
    // so it cannot be released as an unused invoice.
    if (
      removed.receivedConsignment?.accepted ||
      removed.receivedConsignment?.acknowledgementPending ||
      removed.pendingAccept
    ) {
      return { cancelled: false }
    }
    const rollback = snapshotState(state)
    receives.splice(index, 1)
    this.recordReleasedReceiveRecipient(removed.proxyRecipientId ?? removed.recipientId)
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

  /** Export the history-free RGB Contract strict body for an asset known locally. */
  exportContractConsignment(assetId: string): Uint8Array {
    const normalized = normalizeAssetId(assetId)
    const contract = this.requireState().contracts?.[normalized]
    if (!contract) throw new RgbServiceError(`RGB contract ${normalized} is not known locally`)

    // Received assets keep transfer history in `consignment`; rebuilding from
    // Genesis ensures that no ownership history leaks into a contract export.
    const stored = Uint8Array.from(Buffer.from(contract.consignment, 'base64'))
    if (isSupportedV1TransferConsignment(stored)) {
      if (!contract.genesis) throw new RgbServiceError('Stored RGB v1 Genesis is missing')
      return encodeBfaContractConsignment(Uint8Array.from(Buffer.from(contract.genesis, 'base64')))
    }
    if (isSupportedV1ContractConsignment(stored)) return unwrapRgbContractConsignment(stored)
    const decoded = decodeNiaConsignment(stored)
    if (decoded.assetId !== normalized) {
      throw new RgbServiceError('Stored RGB contract ID does not match its Genesis')
    }
    return encodeNiaContract(decoded.genesis).strict
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
    state.pendingAssetMetadata = state.pendingAssetMetadata?.filter(
      item => item.assetId !== input.assetId || !item.synced
    )
  }

  private needsV1HistoryMerge(assetId: string, payload: string) {
    const existing = this.requireState().contracts?.[assetId]
    const existingPayload = existing?.history?.payload ?? existing?.consignment
    return [existingPayload, payload].some(item => {
      if (!item) return false
      const bytes = Uint8Array.from(Buffer.from(item, 'base64'))
      return isSupportedV1TransferConsignment(bytes) || isSupportedV1ContractConsignment(bytes)
    })
  }

  /** Check the exact merge before ACK makes the receive irrevocable to the sender. */
  private async preflightReceiveHistory(assetId: string, payload: string, pendingWitnessTxid?: string) {
    const existing = this.requireState().contracts?.[assetId]
    if (!existing) return
    if (this.needsV1HistoryMerge(assetId, payload)) {
      await this.prepareV1HistoryMerge(assetId, payload, pendingWitnessTxid)
      return
    }
    mergeNiaConsignmentHistory({
      assetId,
      consignments: [
        { opId: contractOperationId(assetId), payload: existing.history?.payload ?? existing.consignment },
        { opId: contractOperationId(assetId), payload },
      ],
      requiredOpIds: [],
      knownBlindSeals: this.getKnownBlindSeals(),
    })
  }

  private async prepareV1HistoryMerge(assetId: string, payload: string, pendingWitnessTxid?: string) {
    const validate = this.dependencies.validateBfaConsignment
    if (!validate) throw new RgbServiceError('RGB v1 receive validation is unavailable')
    const state = this.requireState()
    const existing = state.contracts?.[assetId]
    const existingPayload = existing?.history?.payload ?? existing?.consignment
    const originals = [...new Set([existingPayload, payload].filter((item): item is string => Boolean(item)))]
    const legacyPayloads = [...(existing?.history?.legacyPayloads || [])]
    const transfers: Uint8Array[] = []
    const rootGenesises: string[] = []
    for (const original of originals) {
      const bytes = Uint8Array.from(Buffer.from(original, 'base64'))
      const isV1 = isSupportedV1TransferConsignment(bytes) || isSupportedV1ContractConsignment(bytes)
      if (!isV1) {
        const decoded = decodeNiaConsignment(unwrapNiaV0Contract(bytes))
        if (decoded.assetId !== assetId) throw new RgbServiceError('RGB v0 history asset ID mismatch')
        if (!decoded.transfer) rootGenesises.push(Buffer.from(decoded.genesis.strict).toString('base64'))
      } else if (isSupportedV1ContractConsignment(bytes)) {
        const body = unwrapRgbContractConsignment(bytes)
        rootGenesises.push(Buffer.from(body.slice(4, -4)).toString('base64'))
      }
      const converted = isV1 ? bytes : convertNiaV0ConsignmentToV1(bytes)
      if (converted !== bytes && !legacyPayloads.includes(original)) legacyPayloads.push(original)
      if (isSupportedV1TransferConsignment(converted)) transfers.push(converted)
    }
    if (!transfers.length) throw new RgbServiceError('RGB v1 history has no transfer')
    const knownBlindSeals = this.getKnownBlindSeals()
    const evmRpcCache = new Map<string, Promise<unknown>>()
    const bitcoinStatusCache = new Map<string, Promise<boolean>>()
    const confirmedBitcoinWitnesses = state.confirmedBitcoinWitnesses ||= {}
    const validated = await Promise.all(transfers.map(bytes => validate({
      wallet: state.wallet, payload: bytes,
      ...(pendingWitnessTxid ? { pendingWitnessTxid } : {}), knownBlindSeals, evmRpcCache, bitcoinStatusCache, confirmedBitcoinWitnesses,
    })))
    if (validated.some(item => item.assetId !== assetId))
      throw new RgbServiceError('RGB v1 history asset ID mismatch')
    const canonical = mergeBfaValidatedHistories(validated)
    const complete = await validate({
      wallet: state.wallet, payload: canonical,
      ...(pendingWitnessTxid ? { pendingWitnessTxid } : {}), knownBlindSeals, evmRpcCache, bitcoinStatusCache, confirmedBitcoinWitnesses,
    })
    if (complete.assetId !== assetId)
      throw new RgbServiceError('RGB v1 merged history asset ID mismatch')
    if (rootGenesises.some(item => item !== Buffer.from(complete.genesis).toString('base64')) ||
      (existing?.genesis && existing.genesis !== Buffer.from(complete.genesis).toString('base64')))
      throw new RgbServiceError('RGB v1 history Genesis mismatch')
    const canonicalPayload = Buffer.from(canonical).toString('base64')
    const opIds = complete.bundles.flatMap(bundle => bundle.operationIds)
    if (canonicalPayload.length > MAX_RECOVERY_HISTORY_PAYLOAD_LENGTH ||
      opIds.length > MAX_RECOVERY_HISTORY_OPERATION_IDS ||
      legacyPayloads.reduce((size, item) => size + item.length, 0) > MAX_RECOVERY_HISTORY_PAYLOAD_LENGTH)
      throw new RgbServiceError('RGB v1 history exceeds recovery checkpoint limits')
    return { canonicalPayload, complete, opIds, legacyPayloads }
  }

  private async storeAcceptedBfaHistory(assetId: string, payload: string, pendingWitnessTxid?: string) {
    const state = this.requireState()
    const existing = state.contracts?.[assetId]
    const { canonicalPayload, complete, opIds, legacyPayloads } =
      await this.prepareV1HistoryMerge(assetId, payload, pendingWitnessTxid)
    const contracts = state.contracts || (state.contracts = {})
    contracts[assetId] = {
      consignment: canonicalPayload,
      genesis: Buffer.from(complete.genesis).toString('base64'),
      metadata: complete.metadata,
      createdAt: existing?.createdAt || this.now(),
      history: { payload: canonicalPayload, opIds, updatedAt: this.now(),
        ...(legacyPayloads.length ? { legacyPayloads } : {}) },
    }
    if (state.validatedV1SendHistories) delete state.validatedV1SendHistories[assetId]
    state.pendingAssetMetadata = state.pendingAssetMetadata?.filter(
      item => item.assetId !== assetId || !item.synced
    )
  }

  getContractGenesis(assetId: string) {
    const contract = this.requireState().contracts?.[normalizeAssetId(assetId)]
    return contract?.genesis
  }

  getSnapshot() {
    return this.requireState().snapshot
  }

  /** Keep polling a previously used wallet after a temporary empty snapshot. */
  hasKnownAssetHistory() {
    const state = this.requireState()
    return Boolean(
      Object.keys(state.contracts || {}).length ||
      state.issueHistory?.length ||
      state.pendingSendHistory?.length ||
      state.pendingReceiveHistory?.length
    )
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

  /** Return a local balance for an asset represented by allocations or accepted receives. */
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
    const burnChangeTxids = new Set([
      ...(state.pendingSendHistory || [])
        .filter(item => item.burn && item.status === 'broadcasted' && item.txid)
        .map(item => item.txid!),
      ...Object.values(state.pending)
        .filter(item => item.request.burn && item.broadcast)
        .map(item => item.broadcast!.completed.txid),
    ])
    const amounts = new Map<string, { settled: bigint; spendable: bigint; pending: bigint; incomingPending: bigint; locked: bigint }>()
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
          incomingPending: 0n,
          locked: 0n,
        }
        const amount = BigInt(allocation.amount)
        if (allocation.settled) current.settled += amount
        else if (burnChangeTxids.has(utxo.outpoint.txid)) current.locked += amount
        else current.pending += amount
        if (allocation.settled && allocation.spendable && !locked.has(outpointKey(utxo))) {
          current.spendable += amount
        }
        amounts.set(allocation.assetId, current)
      }
    }
    for (const receive of state.pendingReceives || []) {
      const receipt = receive.receivedConsignment
      if (!receipt?.accepted || !receipt.assetId || !receipt.amount || !/^\d+$/.test(receipt.amount)) {
        continue
      }
      const assetId = normalizeAssetId(receipt.assetId)
      const amount = BigInt(receipt.amount)
      const current = amounts.get(assetId) || {
        settled: 0n,
        spendable: 0n,
        pending: 0n,
        incomingPending: 0n,
        locked: 0n,
      }
      // A remote snapshot can report the same allocation before the local
      // receive finishes. Count it once, and never present a settled output as
      // still incoming while the receive record is being finalized.
      const allocation = state.snapshot.utxos
        .filter(utxo =>
          receive.seal
            ? outpointKey(utxo) === `${receive.seal.txid}:${receive.seal.vout}`
            : utxo.outpoint.txid === receipt.txid
        )
        .flatMap(utxo => utxo.allocations)
        .find(item => normalizeAssetId(item.assetId) === assetId && item.amount === receipt.amount)
      if (allocation?.settled) continue
      if (!allocation) current.pending += amount
      current.incomingPending += amount
      amounts.set(assetId, current)
    }
    return [...amounts.entries()]
      .map(([assetId, amount]) => this.getEmptyLocalAssetBalance(assetId, amount))
      .sort((left, right) => left.assetId.localeCompare(right.assetId))
  }

  private getEmptyLocalAssetBalance(
    assetId: string,
    amount: { settled: bigint; spendable: bigint; pending: bigint; incomingPending: bigint; locked: bigint } = {
      settled: 0n,
      spendable: 0n,
      pending: 0n,
      incomingPending: 0n,
      locked: 0n,
    }
  ): RgbLocalAssetDetail {
    const state = this.requireState()
    const knownMetadata = state.contracts?.[assetId]?.metadata ||
      state.pendingAssetMetadata?.find(item => item.assetId === assetId)?.metadata
    // Older installations removed indexed metadata before the Bitcoin
    // transaction confirmed. The accepted receipt still has the validated
    // consignment, so recover its display metadata locally.
    const receipt = knownMetadata ? undefined : state.pendingReceives?.find(receive =>
      receive.receivedConsignment?.assetId === assetId &&
      receive.receivedConsignment?.accepted &&
      receive.receivedConsignment.payload
    )?.receivedConsignment
    let receiptMetadata: RgbPendingAssetMetadata['metadata'] | undefined
    if (receipt?.payload) {
      try {
        receiptMetadata = decodeNiaConsignment(
          Uint8Array.from(Buffer.from(receipt.payload, 'base64'))
        ).metadata
      } catch {
        // Older incomplete receipts still render the pending amount.
      }
    }
    const metadata = knownMetadata || receiptMetadata
    return {
      assetId,
      balance: amount.settled.toString(),
      settled: amount.settled.toString(),
      spendable: amount.spendable.toString(),
      pending: amount.pending.toString(),
      incomingPending: amount.incomingPending.toString(),
      ...(amount.locked > 0n ? { lockedAmount: amount.locked.toString() } : {}),
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
      invoiceReservations: this.getPendingReceives().map(receive => ({
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

  /** Exact RGB\0TFR file bytes, retained after a BFA burn has been broadcast. */
  exportBurnConsignment(txid: string): Uint8Array {
    const state = this.requireState()
    const proof = state.burnProofs?.[txid]
    const pending = Object.values(state.pending).find(item =>
      item.request.burn && (item.delivery?.completed.txid === txid || item.broadcast?.completed.txid === txid)
    )
    const payload = proof?.payload || pending?.delivery?.completed.consignments[0]?.payload ||
      pending?.broadcast?.completed.consignments[0]?.payload
    if (!payload) throw new RgbServiceError('BFA burn consignment is unavailable')
    return Uint8Array.from(Buffer.from(payload, 'base64'))
  }

  /** The V1 payout record in the gateway's BfaBurnDestination JSON format. */
  exportBurnDestination(txid: string) {
    const state = this.requireState()
    const proof = state.burnProofs?.[txid]
    const pending = Object.values(state.pending).find(item => item.request.burn &&
      (item.delivery?.completed.txid === txid || item.broadcast?.completed.txid === txid))
    const destination = proof?.burnDestination || pending?.request.burnDestination
    if (!destination) throw new RgbServiceError('BFA V1 burn destination is unavailable')
    const burnReason = hashBfaBurnDestinationV1(destination)
    if (burnReason !== (proof?.burnReason || pending?.request.burnReason))
      throw new RgbServiceError('BFA burn destination does not match the proof')
    return { ...destination, recipient: `0x${destination.recipient}` }
  }

  /** Observe a recorded burn on Bitcoin so its local history can show confirmation. */
  async getBurnTransactionStatus(txid: string): Promise<'confirmed' | 'mempool' | 'unknown'> {
    const state = this.requireState()
    if (!state.burnProofs?.[txid] && !state.pendingSendHistory?.some(item => item.burn && item.txid === txid))
      throw new RgbServiceError('BFA burn transaction is unavailable')
    const getStatus = this.dependencies.stateSource.getTransactionStatus
    if (!getStatus) return 'unknown'
    const status = (await getStatus(state.wallet, txid)).status
    return status === 'confirmed' || status === 'mempool' ? status : 'unknown'
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
      invoice.expirationTimestamp !== undefined &&
      invoice.expirationTimestamp <= Math.floor(this.now() / 1000)
    ) {
      throw new RgbServiceError('RGB invoice has expired')
    }
    if (!invoice.transportEndpoints.length) {
      throw new RgbServiceError('RGB invoice has no proxy transport endpoint')
    }
    const available = await this.dependencies.transport.checkConsignmentAvailability?.({
      recipientId: invoice.proxyRecipientId,
      endpoints: invoice.transportEndpoints,
      protocol: invoice.proxyInvoiceId ? 'v1' : 'legacy',
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

  /** Prepare a BFA burn using the same local allocation reservation as a send. */
  async prepareBurn(request: Omit<RgbTransferRequest, 'invoice' | 'burn'> & { amount: string }) {
    return this.prepareSend({ ...request, invoice: '', burn: true })
  }

  private requireBurnEncoder(): NonNullable<RgbServiceDependencies['encoder']['prepareBurn']> {
    const encode = this.dependencies.encoder.prepareBurn
    if (!encode) throw new RgbServiceError('BFA burn encoder is unavailable')
    return encode.bind(this.dependencies.encoder)
  }

  /** Reserve RGB allocations and persist the pending transfer as one serialized operation. */
  private async prepareSendOnce(request: RgbTransferRequest, options: { providerOrigin?: string }) {
    const state = this.requireState()
    const burn = request.burn === true
    if (burn && (request.donation || request.swapPsbt))
      throw new RgbServiceError('BFA burn cannot use donation or swap delivery')
    if (request.donation && request.swapPsbt) {
      throw new RgbServiceError('RGB donation cannot use a counterparty-signed swap')
    }
    const invoice = burn ? undefined : decodeRgbInvoice(request.invoice)
    const requestedAssetId = normalizeAssetId(request.assetId)
    if (burn && this.getLocalAssetDetail(requestedAssetId).schema?.toUpperCase() !== 'BFA')
      throw new RgbServiceError('Only BFA assets can be burned')
    if (invoice?.assetId && invoice.assetId !== requestedAssetId) {
      throw new RgbServiceError('RGB invoice asset does not match the requested asset')
    }
    if (
      this.getLocalAssetDetail(requestedAssetId).schema?.toUpperCase() === 'BFA' &&
      !burn && !invoice?.proxyPublicKey
    ) {
      throw new RgbServiceError('This invoice does not support the selected asset')
    }
    if (invoice?.network && !isCompatibleInvoiceNetwork(invoice.network, state.wallet.network)) {
      throw new RgbServiceError('RGB invoice network does not match the current wallet')
    }
    if (
      invoice?.expirationTimestamp !== undefined &&
      invoice.expirationTimestamp <= Math.floor(this.now() / 1000)
    ) {
      throw new RgbServiceError('RGB invoice has expired')
    }
    if (!burn && !invoice?.transportEndpoints.length) {
      throw new RgbServiceError('RGB invoice has no proxy transport endpoint')
    }
    const amount = request.amount === undefined ? invoice?.amount : request.amount
    if (!amount) {
      throw new RgbServiceError('RGB transfer amount must be provided by the request or invoice')
    }
    if (burn) {
      const precision = this.getLocalAssetDetail(requestedAssetId).precision
      if (precision === undefined || !Number.isInteger(precision) || precision < 0 || precision > 18)
        throw new RgbServiceError('BFA burn asset precision is unavailable')
      if (!/^\d+$/.test(amount) || BigInt(amount) < 10n ** BigInt(precision))
        throw new RgbServiceError('BFA burn amount must be at least one token')
    }
    if (invoice?.amount && invoice.amount !== amount) {
      throw new RgbServiceError('RGB invoice amount does not match the requested amount')
    }
    const resolvedRequest = {
      ...request, assetId: requestedAssetId, amount,
      ...(burn ? {
        burnReason: request.burnDestination
          ? hashBfaBurnDestinationV1(request.burnDestination)
          : normalizeBfaBurnDestination(request.burnReason),
      } : {}),
    }
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
      history.confirmedBitcoinWitnesses = state.confirmedBitcoinWitnesses ||= {}
      history.validatedV1SendHistories = state.validatedV1SendHistories ||= {}
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
    const intent = invoice ? {
      assetId: requestedAssetId,
      amount,
      invoice,
      transition: planFungibleTransition({
        assetId: requestedAssetId,
        amount,
        recipientId: invoice.recipientId,
        selectedUtxos,
      }),
    } : undefined
    const encoderInput = () => ({
      wallet: state.wallet,
      snapshot: state.snapshot,
      request: resolvedRequest,
      intent: intent!,
      selectedUtxos,
      ...(availableFeeFunding === undefined ? {} : { feeFunding: availableFeeFunding }),
      validationHistory,
    })
    let prepared: RgbPreparedTransfer
    try {
      prepared = burn
        ? await this.requireBurnEncoder()(encoderInput())
        : await this.dependencies.encoder.prepareTransfer(encoderInput())
    } catch (error) {
      // `history.opIds` is metadata from the encrypted checkpoint. Older
      // checkpoints can claim an allocation Transition while their compact
      // payload no longer reveals that assignment. Do not trust that index
      // blindly: obtain the authoritative history once and retry before
      // failing the send.
      if (!usingLocalHistory || !isIncompleteLocalHistoryError(error)) throw error
      validationHistory = enrichValidationHistory(await getRemoteHistory())
      prepared = burn
        ? await this.requireBurnEncoder()(encoderInput())
        : await this.dependencies.encoder.prepareTransfer(encoderInput())
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
      ...(invoice?.proxyPublicKey ? { proxySenderPrivateKey: Buffer.from(randomBytes(32)).toString('hex') } : {}),
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
      if (pending.request.burn) {
        const validate = this.dependencies.validateBfaConsignment
        const proof = completed.consignments[0]
        if (!validate || !proof) throw new RgbServiceError('BFA burn validation is unavailable')
        const checked = await validate({
          wallet: state.wallet,
          payload: Uint8Array.from(Buffer.from(proof.payload, 'base64')),
          pendingWitnessTxid: completed.txid,
          knownBlindSeals: this.getKnownBlindSeals(),
          evmRpcCache: new Map(),
          bitcoinStatusCache: new Map(),
          confirmedBitcoinWitnesses: state.confirmedBitcoinWitnesses ||= {},
        })
        if (checked.assetId !== pending.request.assetId || checked.metadata.schema !== 'BFA' ||
          checked.terminals.length !== 0 ||
          !checked.bundles.at(-1)?.operationIds.includes(pending.prepared.metadata?.['transitionId'] || ''))
          throw new RgbServiceError('BFA burn proof does not match the prepared operation')
      }
      const endpoints = pending.request.burn ? [] : decodeRgbInvoice(pending.request.invoice).transportEndpoints
      if (!pending.request.burn && !endpoints.length)
        throw new RgbServiceError('RGB invoice has no proxy transport endpoint')
      const rollback = snapshotState(state)
      pending.delivery = { completed, endpoints }
      await this.persistWithRecoveryRollback(rollback)
    }
    if (pending.request.burn) return this.advanceBurnDelivery(transferId, pending)
    return this.advancePendingDelivery(transferId, pending)
  }

  /** Broadcast a receiver-accepted wallet send only after the sender requests it. */
  async broadcastPendingSend(transferId: string) {
    return this.runPendingTransferOperation(transferId, async () => {
      const pending = this.requireState().pending[transferId]
      if (
        !(pending?.delivery?.acknowledgedAt || pending?.delivery?.donationReadyAt || pending?.request.burn) ||
        pending.delivery.externalBroadcast ||
        pending.delivery.requiresCounterpartySignature
      ) {
        throw new RgbServiceError('RGB transfer is not ready for sender broadcast')
      }
      if (pending.request.burn) return this.advanceBurnDelivery(transferId, pending)
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
      if (!pending.delivery?.broadcastError || pending.broadcast || pending.request.burn) continue
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
    if (!delivery?.broadcastError || !report || pending.request.burn) return
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
    if (pending.broadcast || (pending.delivery?.acknowledgedAt && !allowAcknowledged) ||
      (pending.request.donation && pending.delivery?.publishedAt))
      return { aborted: false }
    if (allowAcknowledged && !pending.delivery) return { aborted: false }

    // V1 must clear the unreleased signed transaction before its local inputs
    // can be reused. Legacy transport retains its best-effort cancel signal.
    if (!pending.request.burn && !pending.delivery?.acknowledgedAt && pending.delivery) {
      const invoice = decodeRgbInvoice(pending.request.invoice)
      if (invoice.proxyInvoiceId) {
        if (!pending.proxySenderPrivateKey || !this.dependencies.transport.cancelConsignment) {
          throw new RgbServiceError('RGB proxy v1 cancellation is unavailable')
        }
        await this.dependencies.transport.cancelConsignment({
          proxyInvoiceId: invoice.proxyInvoiceId,
          proxySenderPrivateKey: pending.proxySenderPrivateKey,
          endpoints: pending.delivery.endpoints,
          allowMissing: !pending.delivery.publishedAt,
        })
      } else if (this.dependencies.transport.acknowledgeConsignment) {
        for (const consignment of pending.delivery.completed.consignments) {
          try {
            await this.dependencies.transport.acknowledgeConsignment({
              recipientId: invoice.proxyRecipientId,
              endpoints: pending.delivery.endpoints,
              acknowledged: false,
            })
          } catch {
            // Legacy local abort still proceeds if the proxy signal fails.
          }
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
      // The change output is known locally after broadcast, but Bitcoin has
      // not confirmed it yet. Keep it visible as pending until the backend
      // snapshot verifies the output on-chain.
      state.snapshot.utxos.push({
        ...update.createdUtxo,
        chainStatus: 'mempool',
        confirmations: 0,
        allocations: update.createdUtxo.allocations.map(allocation => ({
          ...allocation,
          settled: false,
          spendable: false,
        })),
      })
    }
    state.snapshot.syncedAt = this.now()
    const pending = Object.values(state.pending).find(
      item => item.delivery?.completed === completed
    )
    // Burn skips syncBroadcast because there is no recipient consignment to
    // publish. Its colored change still needs to reach the indexer, including
    // when a broadcast timeout is later reconciled as successful.
    if (pending?.request.burn && update.createdUtxo?.allocations.length) {
      state.pendingUtxoSync = { txid: completed.txid, outpoints: state.snapshot.utxos }
    }
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
  private async retainCompletedLocalHistory(completed: RgbCompletedTransfer) {
    for (const consignment of completed.consignments) {
      try {
        const assetId = normalizeAssetId(consignment.assetId)
        const bytes = Uint8Array.from(Buffer.from(consignment.payload, 'base64'))
        if (isSupportedV1TransferConsignment(bytes)) {
          await this.storeAcceptedBfaHistory(assetId, consignment.payload, completed.txid)
          continue
        }
        const decoded = decodeNiaConsignment(bytes)
        if (decoded.assetId !== assetId) continue
        const opId = consignment.opIds.find(candidate =>
          decoded.transitions.some(transition => transition.opId === candidate)
        )
        if (!opId) continue
        if (this.needsV1HistoryMerge(assetId, consignment.payload)) {
          await this.storeAcceptedBfaHistory(assetId, consignment.payload, completed.txid)
        } else {
          this.storeAcceptedHistory({
            assetId,
            payload: consignment.payload,
            opId,
            genesis: Buffer.from(decoded.genesis.strict).toString('base64'),
            metadata: decoded.metadata,
          })
        }
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
    // Consignments were durably posted before this transaction was broadcast.
    // Regular sends also waited for the recipient ACK.
    if (!pending.request.burn) await this.dependencies.stateSource.syncBroadcast?.(
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
      ...(pending.request.burn ? { burn: true } : {}),
      ...(pending.request.burnDestination
        ? { burnDestinationChainId: pending.request.burnDestination.destinationChainId }
        : {}),
      ...(pending.request.donation ? { donation: true } : {}),
      ...(pending.request.donation && !pending.request.burn && !decodeRgbInvoice(pending.request.invoice).proxyInvoiceId
        ? { recipientAckExpected: true }
        : {}),
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
    await this.retainCompletedLocalHistory(delivery.completed)
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
    const invoice = decodeRgbInvoice(pending.request.invoice)
    const proxyRecipientId = invoice.proxyRecipientId
    const consignments = delivery.completed.consignments.map((consignment, index) => ({
      ...consignment,
      recipientId: proxyRecipientId,
      transportId: `${transferId}:${index}`,
      txid: delivery.completed.txid,
      endpoints: delivery.endpoints,
      ...(pending.request.donation ? { donation: true } : {}),
      ...(invoice.proxyInvoiceId ? {
        proxyInvoiceId: invoice.proxyInvoiceId,
        proxyRecipientPublicKey: invoice.proxyPublicKey,
        proxySenderPrivateKey: pending.proxySenderPrivateKey,
        signedRawTx: delivery.completed.rawTx,
        proxyExpirationTimestamp: invoice.expirationTimestamp,
      } : {}),
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

  /** Burn is a unilateral Bitcoin operation. Persist its signed proof before broadcasting. */
  private async advanceBurnDelivery(transferId: string, pending: RgbPendingTransfer) {
    const state = this.requireState()
    const delivery = pending.delivery
    if (!pending.request.burn || !delivery) throw new RgbServiceError('BFA burn is not signed')
    if (!delivery.donationReadyAt) {
      const rollback = snapshotState(state)
      delivery.donationReadyAt = this.now()
      await this.persistWithRecoveryRollback(rollback)
    }
    let broadcastTxid: string
    try {
      broadcastTxid = await this.dependencies.broadcaster.broadcast(delivery.completed.rawTx)
    } catch (error) {
      delivery.broadcastError = error instanceof Error ? error.message : String(error)
      await this.persist({ waitForRecovery: true })
      const recovery = await this.reconcileFailedBroadcast(transferId, pending)
      if (recovery === 'broadcasted') return this.syncBroadcastedTransfer(transferId, pending)
      throw error
    }
    if (broadcastTxid !== delivery.completed.txid)
      throw new RgbServiceError('Broadcast transaction ID does not match the BFA burn')
    this.applyFundingUpdate(delivery.completed)
    await this.retainCompletedLocalHistory(delivery.completed)
    this.recordBurnProof(pending, delivery.completed)
    pending.broadcast = { completed: delivery.completed, broadcastAt: this.now() }
    delete pending.delivery
    await this.persist({ waitForRecovery: true })
    return this.syncBroadcastedTransfer(transferId, pending)
  }

  private recordBurnProof(pending: RgbPendingTransfer, completed: RgbCompletedTransfer) {
    if (!pending.request.burn) return
    const proof = completed.consignments[0]
    if (!proof) throw new RgbServiceError('BFA burn consignment is missing')
    const state = this.requireState()
    ;(state.burnProofs ||= {})[completed.txid] = {
      assetId: pending.request.assetId, amount: pending.request.amount,
      payload: proof.payload, createdAt: this.now(),
      ...(pending.request.burnReason ? { burnReason: pending.request.burnReason } : {}),
      ...(pending.request.burnDestination ? { burnDestination: pending.request.burnDestination } : {}),
    }
  }

  private async advancePendingDelivery(
    transferId: string,
    pending: RgbPendingTransfer,
    mode: 'manual' | 'broadcast' | 'external' = 'manual'
  ) {
    const state = this.requireState()
    const delivery = pending.delivery
    if (!delivery) throw new RgbServiceError(`RGB transfer ${transferId} has not been signed`)
    const invoice = decodeRgbInvoice(pending.request.invoice)
    const proxyRecipientId = invoice.proxyRecipientId
    const consignments = delivery.completed.consignments.map((consignment, index) => ({
      ...consignment,
      recipientId: proxyRecipientId,
      transportId: `${transferId}:${index}`,
      txid: delivery.completed.txid,
      endpoints: delivery.endpoints,
      ...(pending.request.donation ? { donation: true } : {}),
      ...(invoice.proxyInvoiceId ? {
        proxyInvoiceId: invoice.proxyInvoiceId,
        proxyRecipientPublicKey: invoice.proxyPublicKey,
        proxySenderPrivateKey: pending.proxySenderPrivateKey,
        signedRawTx: delivery.completed.rawTx,
        proxyExpirationTimestamp: invoice.expirationTimestamp,
      } : {}),
    }))
    if (!delivery.publishedAt || !invoice.proxyInvoiceId) {
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
        // The v1 proxy operation is immutable after publication. Poll ACKs
        // without re-preparing it after the recipient responds.
        await this.persist({ skipRecovery: true })
      }
    }
    if (pending.request.donation) {
      if (!delivery.donationReadyAt) {
        const rollback = snapshotState(state)
        delivery.donationReadyAt = this.now()
        // The signed transaction must be recoverable before it can be broadcast.
        await this.persistWithRecoveryRollback(rollback)
      }
    } else {
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
    }

    if (mode === 'manual' && !pending.request.donation) return delivery.completed

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
      // Keep the signed transfer retryable until a reviewed cancellation is
      // published. A donation may already be broadcast by its recipient.
      try { await this.reportPendingBroadcastFailure(transferId, pending) }
      catch { /* Reporting is best effort; background polling retries it. */ }
      throw error
    }
    if (broadcastTxid !== delivery.completed.txid) {
      throw new RgbServiceError('Broadcast transaction ID does not match the RGB transfer')
    }
    this.applyFundingUpdate(delivery.completed)
    await this.retainCompletedLocalHistory(delivery.completed)
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
          await this.retainCompletedLocalHistory(delivery.completed)
          this.recordBurnProof(pending, delivery.completed)
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
          ? [{ recipientId: receive.proxyRecipientId || receive.recipientId, endpoints, proxyPrivateKey: receive.proxyPrivateKey }]
          : []
      })
    if (getConsignments) return getConsignments(pending)
    if (!getConsignment) return []
    return (await Promise.all(pending.map(input => getConsignment(input)))).filter(
      (item): item is NonNullable<typeof item> => !!item
    )
  }

  private async acknowledgeProxyConsignment(
    item: { recipientId: string; endpoint?: string; proxyTransferId?: string; proxySenderPublicKey?: string; proxySenderEndpoint?: string; proxyConsignmentHash?: string },
    acknowledged: boolean
  ) {
    if (!item.endpoint || !this.dependencies.transport.acknowledgeConsignment) return
    const receive = this.getPendingReceives().find(receive =>
      (receive.proxyRecipientId || receive.recipientId) === item.recipientId
    )
    await this.dependencies.transport.acknowledgeConsignment({
      recipientId: item.recipientId,
      endpoints: [item.endpoint],
      acknowledged,
      proxyPrivateKey: receive?.proxyPrivateKey,
      proxyTransferId: item.proxyTransferId,
      proxySenderPublicKey: item.proxySenderPublicKey,
      proxySenderEndpoint: item.proxySenderEndpoint,
      proxyConsignmentHash: item.proxyConsignmentHash,
    })
  }

  private async rejectInvalidProxyConsignment(
    receive: import('./types').RgbPendingReceive,
    item: { recipientId: string; txid?: string; endpoint?: string }
  ) {
    try {
      await this.acknowledgeProxyConsignment(item, false)
    } catch (error) {
      // Broadcast-first v1 transfers do not create an ACK operation. A proxy
      // 404 therefore cannot prove that the recipient rejected the transfer.
      // Keep the invoice so a later valid consignment can still be accepted.
      if (error instanceof RgbProxyOperationNotFoundError) return false
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
    return true
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
      if (changed) {
        existing.metadata = metadata
        existing.synced = false
      }
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
    confirmedBitcoinWitnesses: _confirmedBitcoinWitnesses,
    validatedV1SendHistories: _validatedV1SendHistories,
    pending,
    pendingSendHistory,
    ...snapshot
  } = state
  return {
    ...snapshot,
    ...(snapshot.pendingReceives
      ? {
          pendingReceives: snapshot.pendingReceives.map(receive => {
            const { providerOrigin: _providerOrigin, ...recoveryReceive } = receive
            return recoveryReceive
          }),
        }
      : {}),
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
  state.pendingReceives?.forEach(receive => delete receive.providerOrigin)
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
      const { payload, opIds, updatedAt, legacyPayloads } = contract.history
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
        updatedAt < 0 ||
        (legacyPayloads !== undefined && (
          !Array.isArray(legacyPayloads) ||
          legacyPayloads.reduce((size, item) => size + (typeof item === 'string' ? item.length : 0), 0) > MAX_RECOVERY_HISTORY_PAYLOAD_LENGTH ||
          !legacyPayloads.every(item => typeof item === 'string' && isBase64(item))
        ))
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
    // Accept the existing UUID-style IDs and wallet API's YYYYMM-RGB20-XXXXXXXX IDs.
    if (
      !/^(0|[1-9][0-9]*)$/.test(issue.amount) ||
      (issue.orderId !== undefined &&
        !/^(?:[0-9a-f-]{36}|\d{6}-RGB20-[A-Z0-9]{8})$/i.test(issue.orderId)) ||
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
  return message.toLowerCase().includes('cannot change uploaded file') ||
    message.includes('Invoice quota exceeded') || message.includes('Invoice expired')
}

function isProxySignedTransactionCleared(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('RGB proxy signed transaction was cleared by sender')
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
  // Older Any Asset cancellations may store a missing ID as either '' or
  // 'rgb:'. Normalize the latter to the former without discarding the record.
  state.pendingReceiveHistory?.forEach((item, index) => {
    if (!item.assetId) return
    if ((item.status === 'canceled' || item.status === 'rejected') && item.assetId.trim().toLowerCase() === 'rgb:') {
      item.assetId = ''
      return
    }
    try {
      item.assetId = normalizeAssetId(item.assetId)
    } catch {
      console.warn('RGB receive history contains an invalid asset ID', {
        index,
        status: item.status ?? 'unknown',
        assetId: item.assetId,
      })
      throw new RgbServiceError('RGB receive history contains an invalid asset ID')
    }
  })
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
