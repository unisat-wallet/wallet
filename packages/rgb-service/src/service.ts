import { crypto as bitcoinCrypto, Transaction } from 'bitcoinjs-lib'
import {
  RgbBfaValidationUnavailableError,
  RgbInvoiceUnavailableError,
  RgbInsufficientBalanceError,
  RgbMissingAncestorError,
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
import type { RgbInvoice, RgbInvoiceSeal, RgbWitnessAddressType } from './protocol/invoice'
import { normalizeRgbAssetId, rgbContractIdHex } from './protocol/contract-id'
import { hashBfaBurnDestinationV1, normalizeBfaBurnDestination } from './protocol/bfa-burn-destination'
import { decodeNiaConsignment } from './protocol/nia-consignment'
import { getNiaAssetSpecIssue } from './protocol/nia-genesis'
import { mergeNiaConsignmentHistory } from './protocol/nia-history'
import {
  BFA_SCHEMA_ID,
  encodeBfaContractConsignment,
  isSupportedV1ContractConsignment,
  isSupportedV1TransferConsignment,
  normalizeLegacyV1Consignment,
  unwrapRgbContractConsignment,
  v1TransferSchemaId,
} from './protocol/bfa-consignment'
import {
  bfaConsignmentAllocationOutpointHints,
  mergeBfaValidatedHistories,
  pruneConfirmedBfaWitnesses,
} from './protocol/bfa-validator'
import type { ValidatedBfaConsignment } from './protocol/bfa-validator'
import { convertNiaV0ConsignmentToV1, unwrapNiaV0Contract } from './protocol/nia-v0-migration'
import { encodeNiaContract, encodeNiaTransferConsignment } from './protocol/nia-contract'
import {
  blindRgbInvoiceRecipientId,
  concealBlindSeal,
  encodeBlindRgbInvoice,
} from './protocol/receive'
import { getSwapPsbtInputOutpoints } from './protocol/opret-transfer'
import { deriveProxyV1SealBlinding } from './protocol/proxy-v1'
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
  RgbPendingReceive,
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

type ReceiveValidationCaches = {
  evmRpcCache: Map<string, Promise<unknown>>
  bitcoinStatusCache: Map<string, Promise<boolean>>
  consignments: Map<string, Promise<ValidatedBfaConsignment>>
}

const STORAGE_PREFIX = 'rgb-service:v1:'
const MAX_RGB_AMOUNT = 0xffff_ffff_ffff_ffffn
const MAX_PENDING_RECEIVE_INVOICES = 10
const PROVIDER_ORIGIN_HISTORY_TTL_MS = 24 * 60 * 60 * 1000
// Keep these in sync with recovery checkpoint validation. Canonical history is
// wallet state, so accepting a history that cannot be restored would make the
// wallet locally usable only until its next recovery.
const MAX_RECOVERY_HISTORY_PAYLOAD_LENGTH = 48_000_000
const MAX_RECOVERY_HISTORY_OPERATION_IDS = 65_535
const MAX_EXACT_BURN_SELECTION_STATES = 100_000

function canonicalHistoryHash(payload: string) {
  return bitcoinCrypto.sha256(Buffer.from(payload, 'base64')).toString('hex')
}

class RgbExactBurnSelectionError extends RgbServiceError {}

function burnSplitInvoice(
  wallet: RgbWalletRef,
  utxo: RgbUtxo,
  assetId: string,
  amount: string
): RgbInvoice {
  const script = utxo.scriptPubKey.toLowerCase()
  let addressType: RgbWitnessAddressType
  let payload: Buffer
  if (/^5120[0-9a-f]{64}$/.test(script)) {
    addressType = 'p2tr'
    payload = Buffer.from(script.slice(4), 'hex')
  } else if (/^0014[0-9a-f]{40}$/.test(script)) {
    addressType = 'p2wpkh'
    payload = Buffer.from(script.slice(4), 'hex')
  } else if (/^0020[0-9a-f]{64}$/.test(script)) {
    addressType = 'p2wsh'
    payload = Buffer.from(script.slice(4), 'hex')
  } else if (/^76a914[0-9a-f]{40}88ac$/.test(script)) {
    addressType = 'p2pkh'
    payload = Buffer.from(script.slice(6, -4), 'hex')
  } else if (/^a914[0-9a-f]{40}87$/.test(script)) {
    addressType = 'p2sh'
    payload = Buffer.from(script.slice(4, -2), 'hex')
  } else {
    throw new RgbServiceError('BFA burn allocation split requires a standard wallet funding script')
  }
  const tags: Record<RgbWitnessAddressType, number> = {
    p2pkh: 1, p2sh: 2, p2wpkh: 3, p2wsh: 4, p2tr: 5,
  }
  const seal: RgbInvoiceSeal = {
    type: 'witness',
    pay2vout: Uint8Array.from([tags[addressType], ...payload]),
    addressType,
    addressPayload: Uint8Array.from(payload),
  }
  const recipientId = witnessRgbInvoiceRecipientId(wallet.network, script)
  return {
    raw: '', assetId, amount, schema: 'BFA', assignmentName: 'assetOwner',
    encryption: 'unsupported', recipientId, proxyRecipientId: recipientId,
    recipientType: 'witness', seal, network: wallet.network, transportEndpoints: [],
  }
}

/** Node responses which unambiguously mean these exact transaction bytes were already accepted. */
function isDuplicateBitcoinBroadcastError(error: unknown) {
  let detail: string
  if (error instanceof Error) detail = error.message
  else if (error && typeof error === 'object') {
    try { detail = JSON.stringify(error) }
    catch { detail = String(error) }
  } else detail = String(error)
  const message = detail.toLowerCase()
  return [
    'transaction outputs already in utxo set',
    'txn-already-known',
    'transaction already in mempool',
    'already in block chain',
    'already in blockchain',
  ].some(fragment => message.includes(fragment))
}

function describeReceiveMismatch(
  reason: string,
  details: Record<string, unknown>,
  receive: import('./types').RgbPendingReceive
) {
  switch (reason) {
    case 'asset_id':
      return `Invoice asset ID does not match the consignment (offered: ${details['actualAssetId'] || 'unknown'})`
    case 'amount':
      return `Invoice amount does not match the consignment (offered: ${details['actualAmount'] || 'unknown'})`
    case 'asset_or_amount':
      return receive.assetId && receive.assetId !== details['actualAssetId']
        ? `Invoice asset ID does not match the consignment (offered: ${details['actualAssetId'] || 'unknown'})`
        : `Invoice amount does not match the consignment (offered: ${details['actualAmount'] || 'unknown'})`
    case 'v1_recipient_assignment':
      return 'No recipient assignment matched this RGB v1 invoice'
    case 'nia_witness_assignment':
      return 'No matching witness assignment was found in the latest NIA witness bundle'
    case 'nia_blind_assignment':
      return 'No matching blind assignment was found in the NIA consignment'
    case 'missing_witness_script':
      return 'The receive invoice is missing its witness script'
    case 'missing_blind_seal':
      return 'The receive invoice is missing its blind seal'
    default:
      return `Consignment does not match this invoice (${reason})`
  }
}

function outpointKey(utxo: RgbUtxo) {
  return `${utxo.outpoint.txid}:${utxo.outpoint.vout}`
}

function getSpendableAmount(utxo: RgbUtxo, assetId: string) {
  return utxo.allocations
    .filter(
      allocation => allocation.assetId === assetId && allocation.settled && allocation.spendable &&
        allocation.historyAvailable !== false
    )
    .reduce((total, allocation) => total + BigInt(allocation.amount), 0n)
}

/** Deterministic bounded subset-sum selection for current-schema terminal burns. */
function selectExactBurnUtxos(
  candidates: Array<{ utxo: RgbUtxo; amount: bigint }>,
  required: bigint
) {
  const states = new Map<bigint, number[]>([[0n, []]])
  for (let index = 0; index < candidates.length; index++) {
    for (const [sum, selected] of [...states]) {
      const next = sum + candidates[index]!.amount
      if (next > required) continue
      const proposal = [...selected, index]
      const existing = states.get(next)
      if (!existing || proposal.length < existing.length) states.set(next, proposal)
    }
    if (states.size > MAX_EXACT_BURN_SELECTION_STATES) {
      const exact = states.get(required)
      if (exact) return exact.map(selected => candidates[selected]!.utxo)
      throw new RgbServiceError(
        'Current BFA burn allocations are too fragmented for exact selection'
      )
    }
  }
  return states.get(required)?.map(index => candidates[index]!.utxo)
}

function isIncompleteLocalHistoryError(error: unknown) {
  return (
    error instanceof RgbServiceError &&
    (error.message === 'RGB allocation parent Transition is missing from local history' ||
      error instanceof RgbMissingAncestorError)
  )
}

function isNonRetryableTransportError(error: unknown) {
  return Boolean(error && typeof error === 'object' &&
    (error as { automaticRetry?: unknown }).automaticRetry === false)
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
  private pendingReceiveOperation?: Promise<void>
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
            witnessBlindingPolicyVersion: 1,
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
      const local = normalizeStateAssetIds(snapshotState(current))
      const candidate = normalizeStateAssetIds(snapshotState(recovery))
      canonicalizeRecoveryComparisonState(local)
      canonicalizeRecoveryComparisonState(candidate)
      validateRecoveredState(candidate, current.wallet)
      return (
        stableRecoveryJson(comparableRecoveryState(recoverySnapshot(persistState(local)))) ===
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

  /**
   * Adopt a generation returned by this installation's own checkpoint write.
   * If that exact checkpoint contained an unsigned prepared transfer, the
   * generation advance does not make its PSBT stale: it is the publication of
   * the reservation itself. Rebase only those still-unsigned transfers. A
   * generation learned from a remote read continues to use
   * setRecoveryCheckpointGeneration and therefore still fences old PSBTs.
   */
  private async setPublishedRecoveryCheckpointGeneration(
    generation: number | undefined,
    publishedPending: RgbServiceState['pending']
  ) {
    if (generation === undefined) return
    const state = this.requireState()
    let changed = state.recoveryCheckpointGeneration !== generation
    state.recoveryCheckpointGeneration = generation
    for (const [transferId, published] of Object.entries(publishedPending)) {
      const current = state.pending[transferId]
      if (
        !current ||
        current.delivery ||
        current.broadcast ||
        published.delivery ||
        published.broadcast ||
        current.prepared.id !== published.prepared.id ||
        current.preparedCheckpointGeneration === generation
      ) continue
      current.preparedCheckpointGeneration = generation
      changed = true
    }
    if (changed) {
      await this.dependencies.storage.set(this.storageKey(state.wallet), persistState(state))
    }
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

  /** Clear a stale local fence only after the controller proves the remote state is identical. */
  async clearRecoveryConflict() {
    const state = this.requireState()
    if (state.recoveryConflict !== true) return
    state.recoveryConflict = undefined
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
    const restored = normalizeStateAssetIds(snapshotState(recovery))
    hydrateStoredContractMetadataState(restored)
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
    // An unsigned PSBT protects only the exact RGB outpoints it spends. Other
    // assets and change outputs must keep receiving chain-state updates.
    // A remote snapshot may still expose consumed outpoints. Finish durable
    // post-broadcast delivery first, or leave the locally updated snapshot intact.
    if (Object.keys(state.pending).length) await this.advancePendingTransfers()
    if (state.pendingBroadcastSyncs) await this.flushBroadcastSyncOutbox()
    // Keep allocations that have not reached the indexer from being overwritten
    // by a stale snapshot. Prepared sends are instead pinned to their checkpoint
    // generation and rejected before signing if another device advances it.
    if (this.hasBlockingSnapshotProtection()) return state.snapshot
    const localSnapshotBeforeRequest = JSON.stringify(state.snapshot.utxos)
    const pendingUtxoSyncBeforeRequest = state.pendingUtxoSync
    const remoteSnapshot = state.snapshot.revision === undefined
      ? await this.dependencies.stateSource.getSnapshot(state.wallet)
      : await this.dependencies.stateSource.getSnapshot(state.wallet, {
          knownRevision: state.snapshot.revision,
        })
    if (remoteSnapshot.unchanged) {
      state.snapshot = {
        ...state.snapshot,
        syncedAt: remoteSnapshot.syncedAt,
        revision: remoteSnapshot.revision ?? state.snapshot.revision,
      }
      await this.persist({ skipRecovery: true })
      return state.snapshot
    }
    const snapshot = normalizeSnapshot(remoteSnapshot)
    const discardedOutpoints = new Set(
      Object.values(state.discardedAssets || {}).flatMap(item =>
        item.outpoints.map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
      )
    )
    if (discardedOutpoints.size) {
      snapshot.utxos = snapshot.utxos.filter(utxo => !discardedOutpoints.has(outpointKey(utxo)))
    }
    // A receive or broadcast may have queued a newer local allocation while
    // the indexer request was in flight. Never apply that older response.
    if (this.hasBlockingSnapshotProtection() ||
      state.pendingUtxoSync !== pendingUtxoSyncBeforeRequest ||
      JSON.stringify(state.snapshot.utxos) !== localSnapshotBeforeRequest) return state.snapshot
    this.mergePendingUtxoSync(snapshot)
    this.mergeUnsignedPreparedTransferProtection(snapshot)
    // Keep the local funding update while the indexer still returns the RGB
    // allocations that this installation already spent in a broadcast tx.
    // Once those outpoints disappear from the remote snapshot, it is safe to
    // accept the remote state again, once it includes any local burn change.
    if (await this.reconcileStaleBroadcastedFundingOutpoints(snapshot)) return state.snapshot
    if (await this.reconcileLocalBurnChange(snapshot)) return state.snapshot
    // A replica can briefly omit a validated allocation or return its old
    // pending state after local confirmation. Keep the settled observation
    // until the replica catches up.
    const remoteOutpoints = new Map(snapshot.utxos.map(utxo => [outpointKey(utxo), utxo]))
    const staleAllocation = state.snapshot.utxos.find(local => {
      const remote = remoteOutpoints.get(outpointKey(local))
      return remote &&
        local.chainStatus !== 'spent' && local.chainStatus !== 'replaced' &&
        remote.chainStatus !== 'spent' && remote.chainStatus !== 'replaced' &&
        remote.chainStatus !== 'pending_spend' &&
        local.scriptPubKey === remote.scriptPubKey && local.satoshis === remote.satoshis &&
        local.allocations.some(allocation => {
          const candidate = remote.allocations.find(candidate =>
            candidate.opId === allocation.opId &&
            candidate.assignmentIndex === allocation.assignmentIndex &&
            candidate.assetId === allocation.assetId
          )
          return !candidate || candidate.amount !== allocation.amount || (
            local.chainStatus === 'confirmed' && allocation.settled &&
            (remote.chainStatus === 'mempool' ||
              !candidate.settled || (allocation.spendable && !candidate.spendable))
          )
        })
    })
    if (staleAllocation) {
      state.pendingUtxoSync = {
        txid: staleAllocation.outpoint.txid,
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
    // Updating unrelated outpoints must not advance the recovery generation
    // bound to an externally held unsigned PSBT. Its locked outpoints were
    // preserved above; upload the refreshed snapshot after signing/canceling.
    await this.persist({
      skipRecovery: !checkpointSnapshotChanged || this.hasUnsignedPreparedTransfer(),
    })
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
    const knownBlindSeals = this.getKnownBlindSeals()
    for (const [assetId, contract] of Object.entries(state.contracts || {})) {
      const payload = Uint8Array.from(Buffer.from(contract.history?.payload || contract.consignment, 'base64'))
      let allocationOutpoints: Set<string>
      try {
        if (!isSupportedV1TransferConsignment(payload)) continue
        allocationOutpoints = new Set(
          bfaConsignmentAllocationOutpointHints(payload, network, knownBlindSeals)
        )
      } catch {
        continue
      }
      const candidates = live.filter(utxo =>
        allocationOutpoints.has(outpointKey(utxo)) &&
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
          evmLogRequestLimit: 4,
          knownBlindSeals,
          confirmedBitcoinWitnesses: state.confirmedBitcoinWitnesses ||= {},
        })
      } catch {
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
      } catch {
        continue
      }
      if (this.hasBlockingSnapshotProtection() ||
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

  private async reconcileStaleBroadcastedFundingOutpoints(snapshot: RgbWalletSnapshot) {
    const state = this.requireState()
    const histories = (state.pendingSendHistory || []).filter(item =>
      item.status === 'broadcasted' && item.txid && item.spentOutpoints?.some(outpoint =>
        snapshot.utxos.some(utxo => outpointKey(utxo) === `${outpoint.txid}:${outpoint.vout}`)
      )
    )
    if (!histories.length) return false
    const getTransactionStatus = this.dependencies.stateSource.getTransactionStatus
    if (!getTransactionStatus) return true
    for (const history of histories) {
      try {
        const chain = await getTransactionStatus(state.wallet, history.txid!)
        if (chain.status !== 'mempool' && chain.status !== 'confirmed') return true
      } catch {
        return true
      }
      const spent = new Set((history.spentOutpoints || []).map(outpoint =>
        `${outpoint.txid}:${outpoint.vout}`
      ))
      snapshot.utxos = snapshot.utxos.filter(utxo => !spent.has(outpointKey(utxo)))
      const remoteOutpoints = new Set(snapshot.utxos.map(outpointKey))
      for (const local of state.snapshot.utxos) {
        if (local.outpoint.txid !== history.txid || remoteOutpoints.has(outpointKey(local))) continue
        snapshot.utxos.push(local)
      }
    }
    return false
  }

  /** Preserve only the locally queued transaction outputs while refreshing unrelated assets. */
  private mergePendingUtxoSync(snapshot: RgbWalletSnapshot) {
    const pending = this.requireState().pendingUtxoSync
    if (!pending) return
    const remoteByOutpoint = new Map(snapshot.utxos.map(utxo => [outpointKey(utxo), utxo]))
    for (const local of pending.outpoints) {
      if (local.outpoint.txid !== pending.txid) continue
      const key = outpointKey(local)
      const remote = remoteByOutpoint.get(key)
      if (remote?.chainStatus === 'spent' || remote?.chainStatus === 'replaced') continue
      const remoteCoversLocal = remote && local.allocations.every(allocation =>
        remote.allocations.some(candidate =>
          candidate.assetId === allocation.assetId &&
          candidate.amount === allocation.amount &&
          candidate.opId === allocation.opId &&
          candidate.assignmentIndex === allocation.assignmentIndex &&
          (!allocation.settled || candidate.settled) &&
          (!allocation.spendable || candidate.spendable)
        )
      )
      if (remoteCoversLocal) continue
      if (remote) {
        snapshot.utxos[snapshot.utxos.indexOf(remote)] = local
      } else {
        snapshot.utxos.push(local)
      }
    }
  }

  /** Keep unsigned PSBT inputs stable while refreshing every unrelated outpoint. */
  private mergeUnsignedPreparedTransferProtection(snapshot: RgbWalletSnapshot) {
    const state = this.requireState()
    const protectedOutpoints = new Set(
      Object.values(state.pending)
        .filter(pending => !pending.delivery && !pending.broadcast)
        .flatMap(pending => pending.prepared.lockedOutpoints.map(
          outpoint => `${outpoint.txid}:${outpoint.vout}`
        ))
    )
    if (!protectedOutpoints.size) return
    const remoteByOutpoint = new Map(snapshot.utxos.map(utxo => [outpointKey(utxo), utxo]))
    for (const local of state.snapshot.utxos) {
      const key = outpointKey(local)
      if (!protectedOutpoints.has(key)) continue
      const remote = remoteByOutpoint.get(key)
      if (remote) snapshot.utxos[snapshot.utxos.indexOf(remote)] = local
      else snapshot.utxos.push(local)
    }
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
    const sync = (async () => {
      await this.advancePendingTransfers()
      await this.flushBroadcastSyncOutbox()
    })()
    this.pendingTransferSyncInFlight = sync
    try {
      await sync
    } finally {
      if (this.pendingTransferSyncInFlight === sync) this.pendingTransferSyncInFlight = undefined
    }
  }

  /**
   * Recover a send whose irreversible backend/chain effects survived while an
   * older checkpoint restored only its prepared reservation. The wallet
   * backend indexes sends with the local transfer ID, but do not trust that
   * record alone: the exact Bitcoin transaction must also be observable.
   */
  async reconcileIndexedBroadcast(input: {
    transferId: string
    txid: string
    assetId?: string
    amount?: string
  }): Promise<boolean> {
    const state = this.requireState()
    const pending = state.pending[input.transferId]
    if (!pending || pending.delivery || pending.broadcast || pending.request.burn) return false
    if (!/^[0-9a-f]{64}$/i.test(input.txid)) return false
    if (input.assetId) {
      try {
        if (normalizeAssetId(input.assetId) !== normalizeAssetId(pending.request.assetId)) return false
      } catch {
        return false
      }
    }
    if (input.amount !== undefined && input.amount !== pending.request.amount) return false

    const getTransactionStatus = this.dependencies.stateSource.getTransactionStatus
    if (!getTransactionStatus) return false
    try {
      const chain = await getTransactionStatus(state.wallet, input.txid)
      if (chain.status !== 'mempool' && chain.status !== 'confirmed') return false
    } catch {
      return false
    }

    const rollback = snapshotState(state)
    const history = state.pendingSendHistory || (state.pendingSendHistory = [])
    const recovered = {
      transferId: input.transferId,
      assetId: pending.request.assetId,
      amount: pending.request.amount,
      ...(pending.request.precision === undefined ? {} : { precision: pending.request.precision }),
      txid: input.txid.toLowerCase(),
      invoice: pending.request.invoice,
      ...(pending.request.donation ? { donation: true } : {}),
      ...(pending.request.donation && !decodeRgbInvoice(pending.request.invoice).proxyInvoiceId
        ? { recipientAckExpected: true }
        : {}),
      spentOutpoints: pending.prepared.lockedOutpoints,
      createdAt: pending.createdAt,
      status: 'broadcasted' as const,
      ...(pending.providerOrigin ? { providerOrigin: pending.providerOrigin } : {}),
      ...(pending.providerOrigin
        ? { providerOriginExpiresAt: this.now() + PROVIDER_ORIGIN_HISTORY_TTL_MS }
        : {}),
    }
    const existing = history.find(item => item.transferId === input.transferId)
    if (existing) Object.assign(existing, recovered)
    else history.push(recovered)
    delete state.pending[input.transferId]
    await this.persistWithRecoveryRollback(rollback)
    return true
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
          else if ((pending.request.donation || pending.request.burn || pending.burnSplit) && pending.delivery?.broadcastError)
            // A failed donation needs an explicit sender retry. Do not let an
            // unavailable broadcaster interrupt synchronization of other sends.
            return
          else if ((pending.request.burn || pending.burnSplit) && pending.delivery)
            // Burn and its internal split have no recipient. Only an explicit
            // user action may retry their broadcast.
            return
          else if (pending.delivery?.publishError)
            // An untrusted endpoint exhausted a local resource budget. Only an
            // explicit user retry may attempt publication again.
            return
          else if (pending.delivery && !pending.delivery.requiresCounterpartySignature) {
            await this.advancePendingDelivery(transferId, pending)
            const current = state.pending[transferId]
            if (
              current?.delivery?.acknowledgedAt &&
              await this.observePendingDeliveryBroadcast(current)
            ) {
              await this.syncBroadcastedTransfer(transferId, current)
            }
          }
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
          // One malformed or temporarily unavailable transfer must not block
          // ACK observation, broadcast reconciliation, or outbox delivery for others.
          return
        }
      })
    }
  }

  private validateReceiveAmount(assetId: string | undefined, amount: string | undefined) {
    if (amount === undefined) return
    if (!assetId) {
      throw new RgbServiceError('A fixed RGB receive amount requires an asset ID')
    }
    if (!/^(0|[1-9][0-9]*)$/.test(amount)) {
      throw new RgbServiceError('RGB receive amount must be an unsigned integer')
    }
    if (BigInt(amount) > MAX_RGB_AMOUNT) {
      throw new RgbServiceError('RGB receive amount exceeds the maximum u64 value')
    }
    if (this.getLocalAssetDetail(assetId).schema?.toUpperCase() === 'BFA') {
      throw new RgbServiceError('BFA bridge invoices cannot specify a fixed amount')
    }
  }

  private assertReceiveInvoiceCapacity() {
    const capacity = this.getReceiveInvoiceCapacity()
    if (!capacity.available) {
      throw new RgbServiceError(
        `RGB receive invoice limit reached (maximum ${MAX_PENDING_RECEIVE_INVOICES})`
      )
    }
  }

  getReceiveInvoiceCapacity() {
    // Durable expired/rejected tombstones remain recoverable, but only
    // invoices visible to the active receive state machine consume slots.
    const count = this.getPendingReceives().filter(
      receive => !receive.rejection
    ).length
    return {
      count,
      limit: MAX_PENDING_RECEIVE_INVOICES,
      available: count < MAX_PENDING_RECEIVE_INVOICES,
    }
  }

  async createBlindReceive(input: {
    assetId?: string
    amount?: string
    durationSeconds?: number
    minConfirmations?: number
    transportEndpoints?: string[]
    providerOrigin?: string
    acceptancePolicy?: 'buy_swap_backend_commit'
    /** The caller will immediately claim the recipient and persist the combined state. */
    deferRecoveryCheckpoint?: boolean
  }) {
    return this.runPendingReceiveOperation(() => this.createBlindReceiveOnce(input))
  }

  private async createBlindReceiveOnce(input: {
    assetId?: string
    amount?: string
    durationSeconds?: number
    minConfirmations?: number
    transportEndpoints?: string[]
    providerOrigin?: string
    acceptancePolicy?: 'buy_swap_backend_commit'
    deferRecoveryCheckpoint?: boolean
  }) {
    const state = this.requireState()
    if (input.minConfirmations !== undefined && (!Number.isSafeInteger(input.minConfirmations) || input.minConfirmations < 1))
      throw new RgbServiceError('RGB receive minConfirmations must be a positive integer')
    if (!state.snapshot.syncedAt) await this.sync()
    const assetId = input.assetId ? normalizeAssetId(input.assetId) : undefined
    this.validateReceiveAmount(assetId, input.amount)
    const now = this.now()
    const expirationTimestamp = Math.floor(now / 1000) + (input.durationSeconds ?? 24 * 60 * 60)
    if (
      input.durationSeconds !== undefined &&
      (!Number.isInteger(input.durationSeconds) || input.durationSeconds <= 0)
    ) {
      throw new RgbServiceError('RGB receive duration must be positive')
    }
    this.assertReceiveInvoiceCapacity()
    const receives = state.pendingReceives || (state.pendingReceives = [])
    const transportEndpoints = input.transportEndpoints ?? this.dependencies.transport.getEndpoints?.() ?? []
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
      ...(input.acceptancePolicy ? { acceptancePolicy: input.acceptancePolicy } : {}),
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
    transportEndpoints?: string[]
    providerOrigin?: string
    acceptancePolicy?: 'buy_swap_backend_commit'
    deferRecoveryCheckpoint?: boolean
  }) {
    return this.runPendingReceiveOperation(() => this.createWitnessReceiveOnce(input))
  }

  private async createWitnessReceiveOnce(input: {
    scriptPubKey: string
    publicKey: string
    assetId?: string
    amount?: string
    durationSeconds?: number
    minConfirmations?: number
    transportEndpoints?: string[]
    providerOrigin?: string
    acceptancePolicy?: 'buy_swap_backend_commit'
    deferRecoveryCheckpoint?: boolean
  }) {
    const state = this.requireState()
    if (input.minConfirmations !== undefined && (!Number.isSafeInteger(input.minConfirmations) || input.minConfirmations < 1))
      throw new RgbServiceError('RGB receive minConfirmations must be a positive integer')
    const assetId = input.assetId ? normalizeAssetId(input.assetId) : undefined
    this.validateReceiveAmount(assetId, input.amount)
    if (
      input.durationSeconds !== undefined &&
      (!Number.isInteger(input.durationSeconds) || input.durationSeconds <= 0)
    ) {
      throw new RgbServiceError('RGB receive duration must be positive')
    }
    this.assertReceiveInvoiceCapacity()
    const endpoints = input.transportEndpoints ?? this.dependencies.transport.getEndpoints?.() ?? []
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
      ...(input.acceptancePolicy ? { acceptancePolicy: input.acceptancePolicy } : {}),
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
        !!item.pendingValidationFailure ||
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
    const pending = this.requireState().pendingUtxoSync
    if (pending) {
      pending.outpoints = this.withCanonicalHistoryRefs({ syncedAt: 0, utxos: pending.outpoints }).utxos
    }
    return pending
  }

  private withCanonicalHistoryRefs(snapshot: RgbWalletSnapshot): RgbWalletSnapshot {
    const state = this.requireState()
    const refs = new Map<string, string>()
    for (const [assetId, contract] of Object.entries(state.contracts || {})) {
      const history = contract.history
      if (!history?.payload) continue
      const historyRef = canonicalHistoryHash(history.payload)
      for (const opId of history.opIds) refs.set(`${assetId}:${opId}`, historyRef)
    }
    return {
      ...snapshot,
      utxos: snapshot.utxos.map(utxo => ({
        ...utxo,
        allocations: utxo.allocations.map(allocation => {
          const derived = allocation.opId
            ? refs.get(`${allocation.assetId}:${allocation.opId.replace(/^rgb:/, '').toLowerCase()}`)
            : undefined
          const retained = /^[0-9a-f]{64}$/i.test(allocation.historyRef || '')
            ? allocation.historyRef!.toLowerCase()
            : undefined
          return { ...allocation, ...((derived || retained) ? { historyRef: derived || retained } : {}) }
        }),
      })),
    }
  }

  getPendingHistoryFragments() {
    const state = this.requireState()
    const synced = state.syncedHistoryFragments || {}
    return Object.entries(state.contracts || {}).flatMap(([assetId, contract]) => {
      const history = contract.history
      if (!history?.payload || !history.opIds.length) return []
      const payloadHash = canonicalHistoryHash(history.payload)
      if (synced[assetId] === payloadHash) return []
      return [{ assetId, opIds: history.opIds, payloadHash, payload: history.payload }]
    })
  }

  async syncPendingHistoryFragments() {
    const store = this.dependencies.stateSource.storeValidationHistory
    if (!store) return false
    const state = this.requireState()
    let changed = false
    for (const fragment of this.getPendingHistoryFragments()) {
      const result = await store(state.wallet, fragment)
      if (result.payloadHash !== fragment.payloadHash) {
        throw new RgbServiceError('RGB history fragment hash was not acknowledged')
      }
      const synced = state.syncedHistoryFragments ||= {}
      synced[fragment.assetId] = fragment.payloadHash
      changed = true
    }
    if (changed) await this.persist({ skipRecovery: true })
    return changed
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
    issuanceTxid?: string
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
      ...(input.issuanceTxid ? { issuanceTxid: input.issuanceTxid } : {}),
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
            !!receive.seal && !receive.rejection
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
    const pending = state.pendingReceives || []
    let changed = false
    const refreshValidationReview = async (
      receive: RgbPendingReceive,
      failure: NonNullable<RgbPendingReceive['pendingValidationFailure']>,
      payload?: string
    ) => {
      const now = this.now()
      const payloadNeedsReport = !!payload && failure.reviewPayloadReported !== true
      // Polling the transfer list can run every few seconds. Review state is
      // operational metadata, so a one-minute refresh is enough. A newly
      // recovered payload bypasses the throttle so it reaches an existing
      // metadata-only case immediately.
      if (
        failure.reviewCheckedAt &&
        now - failure.reviewCheckedAt < 60_000 &&
        !payloadNeedsReport
      ) return
      try {
        const shouldReport = !failure.reviewCaseId || payloadNeedsReport
        const result = shouldReport
          ? await this.dependencies.stateSource.reportReceiveValidationFailure?.(
              state.wallet,
              {
                recipientId: receive.proxyRecipientId || receive.recipientId,
                ...(failure.txid ? { txid: failure.txid } : {}),
                ...(payload ? { payload } : {}),
                reason: failure.reason,
                ...(failure.endpoint ? { endpoint: failure.endpoint } : {}),
                ...(failure.proxyTransferId
                  ? { proxyTransferId: failure.proxyTransferId }
                  : {}),
                ...(failure.proxyConsignmentHash
                  ? { proxyConsignmentHash: failure.proxyConsignmentHash }
                  : {}),
              }
            )
          : await this.dependencies.stateSource.getReceiveValidationFailureStatus?.(
              state.wallet,
              failure.reviewCaseId!
            )
        if (!result) return
        const previous = JSON.stringify(failure)
        const caseId = (result as { caseId?: string }).caseId
        if (caseId) failure.reviewCaseId = caseId
        if (shouldReport && payload) failure.reviewPayloadReported = true
        failure.reviewStatus = result.status
        failure.reviewCheckedAt = now
        if (result.reviewReason) failure.reviewReason = result.reviewReason
        else delete failure.reviewReason
        if (JSON.stringify(failure) !== previous) changed = true
      } catch {
        // Reporting is best effort. Never turn a diagnostics outage into a
        // NACK or prevent the local validator from retrying the consignment.
      }
    }
    const getClaimed = this.dependencies.stateSource.getClaimedConsignments
    let received: Array<{ recipientId: string; payload: string }> = []
    if (includeClaimed) {
      try {
        received = getClaimed ? await getClaimed(state.wallet) : []
      } catch (error) {
        if (!this.dependencies.transport.getConsignment) throw error
      }
    }
    let proxyReceived: RgbReceivedConsignment[]
    try {
      proxyReceived = await this.getProxyConsignments()
    } catch (error) {
      // Existing failures must still become visible to support when the proxy
      // itself is offline or has already removed the consignment payload.
      for (const receive of pending) {
        if (receive.pendingValidationFailure) {
          await refreshValidationReview(receive, receive.pendingValidationFailure)
        }
      }
      if (changed) {
        try { await this.persistWithRecoveryRollback(rollback) } catch { /* retry on the next sync */ }
      }
      throw error
    }
    // Claimed consignments have no txid field. Let validation recover the
    // witness txid from the payload instead of treating an empty ID as a match constraint.
    const receivedItems: Array<RgbReceivedConsignment> = [...received, ...proxyReceived]
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
              batch: receipt.batch,
            },
          ]
        : []
    })
    const receivedByRecipient = new Map(
      [...receivedItems, ...localReceipts].map(item => [item.recipientId, item])
    )
    const itemsToProcess = [...receivedByRecipient.values()]
    // A sender creates one consignment per asset and delivers the same history
    // to every recipient in a batch. Share immutable chain reads for this
    // polling pass so ten recipients do not repeat the same EVM and Bitcoin
    // validation requests ten times. The caches intentionally expire at the
    // end of this operation so a later poll observes fresh chain state.
    const receiveValidationCaches = {
      evmRpcCache: new Map<string, Promise<unknown>>(),
      bitcoinStatusCache: new Map<string, Promise<boolean>>(),
      consignments: new Map<string, Promise<ValidatedBfaConsignment>>(),
    }
    let count = 0
    let snapshotRequired = false

    // A prior validation error may outlive the proxy payload. Report its
    // metadata and poll its review decision even when there is nothing left
    // to validate during this pass.
    for (const receive of pending) {
      const failure = receive.pendingValidationFailure
      if (!failure || receivedByRecipient.has(receive.proxyRecipientId || receive.recipientId)) continue
      await refreshValidationReview(receive, failure)
    }

    // Detect sender cancel for consignments already staged for manual accept.
    for (let index = pending.length - 1; index >= 0; index--) {
      const receive = pending[index]!
      if (receive.rejection || !receive.pendingAccept || receive.receivedConsignment) continue
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
      // A proxy NACK and an explicit user rejection of a donation are
      // terminal. Only a local rejection caused by an old validation failure
      // may be reconsidered after a later wallet upgrade validates it.
      const revalidatableLocalRejection =
        receive.rejection?.kind === 'local_validation_reject' ||
        // Migration compatibility: before the rejection kinds were split,
        // validation rejects used local_donation_reject while retaining the
        // pending validation failure that distinguishes them from a user's
        // explicit rejection of an otherwise valid donation.
        (receive.rejection?.kind === 'local_donation_reject' &&
          !!receive.pendingValidationFailure)
      if (receive.rejection && !revalidatableLocalRejection) continue
      const acceptedBeforeValidation = receive.receivedConsignment?.accepted === true
      let acceptedChain: {
        status: 'mempool' | 'confirmed' | 'pending_spend' | 'spent' | 'replaced' | 'unknown'
        confirmations: number
      } | undefined
      let mismatchReason: string | undefined
      const stageValidationFailure = (reason: string) => {
        const previous = receive.pendingValidationFailure
        const failure = {
          reason,
          discoveredAt: previous?.discoveredAt || this.now(),
          ...(item.txid ? { txid: item.txid } : {}),
          ...(item.endpoint ? { endpoint: item.endpoint } : {}),
          ...(item.proxyTransferId ? { proxyTransferId: item.proxyTransferId } : {}),
          ...(item.proxySenderPublicKey ? { proxySenderPublicKey: item.proxySenderPublicKey } : {}),
          ...(item.proxySenderEndpoint ? { proxySenderEndpoint: item.proxySenderEndpoint } : {}),
          ...(item.proxyConsignmentHash ? { proxyConsignmentHash: item.proxyConsignmentHash } : {}),
          ...(previous?.reviewCaseId ? { reviewCaseId: previous.reviewCaseId } : {}),
          ...(previous?.reviewStatus ? { reviewStatus: previous.reviewStatus } : {}),
          ...(previous?.reviewCheckedAt ? { reviewCheckedAt: previous.reviewCheckedAt } : {}),
          ...(previous?.reviewReason ? { reviewReason: previous.reviewReason } : {}),
          ...(previous?.reviewPayloadReported
            ? { reviewPayloadReported: previous.reviewPayloadReported }
            : {}),
        }
        if (JSON.stringify(previous) !== JSON.stringify(failure)) {
          receive.pendingValidationFailure = failure
          changed = true
        }
      }
      try {
        // ACK-time validation already authenticated the immutable consignment.
        // While its Bitcoin witness remains in the mempool, poll only chain
        // status instead of repeating expensive dynamic BFA/EVM validation on
        // every receive synchronization pass. Revalidate once after the
        // configured confirmation floor is reached, immediately before the
        // allocation becomes settled and spendable.
        if (acceptedBeforeValidation) {
          if (await this.isAcceptedReceiveTerminallyCanceled(receive)) {
            this.recordReceiveOutcome(receive, 'canceled', receive.receivedConsignment!.txid)
            pending.splice(receiveIndex, 1)
            changed = true
            continue
          }
          if (
            receive.receivedConsignment!.signedRawTx &&
            !receive.receivedConsignment!.broadcastDetectedAt
          ) {
            await this.ensureReceiveAnchorBroadcast(
              receive.receivedConsignment!.txid,
              receive.receivedConsignment!.signedRawTx
            )
          }
          const getTransactionStatus = this.dependencies.stateSource.getTransactionStatus
          if (!getTransactionStatus) {
            throw new RgbServiceError('RGB receive chain verification is unavailable')
          }
          acceptedChain = await getTransactionStatus(
            state.wallet,
            receive.receivedConsignment!.txid
          )
          if (
            (acceptedChain.status === 'mempool' || acceptedChain.status === 'confirmed') &&
            !receive.receivedConsignment!.broadcastDetectedAt
          ) {
            receive.receivedConsignment!.broadcastDetectedAt = this.now()
            changed = true
          }
          if (
            acceptedChain.status !== 'confirmed' ||
            acceptedChain.confirmations < (receive.minConfirmations || 1)
          ) {
            continue
          }
        }
        const match = await this.validateIncomingConsignment(
          receive,
          item,
          (reason, details) => {
            mismatchReason = describeReceiveMismatch(reason, details, receive)
          },
          receiveValidationCaches
        )
        if (!match) {
          const reason = mismatchReason || 'Consignment does not match this invoice'
          stageValidationFailure(reason)
          await refreshValidationReview(receive, receive.pendingValidationFailure!, item.payload)
          continue
        }
        if (revalidatableLocalRejection) {
          delete receive.rejection
          this.removeRejectedReceiveHistory(receive)
          changed = true
        }
        const resolvedReviewCaseId = receive.pendingValidationFailure?.reviewCaseId
        if (resolvedReviewCaseId) {
          try {
            await this.dependencies.stateSource.resolveReceiveValidationFailure?.(
              state.wallet,
              resolvedReviewCaseId
            )
          } catch {
            // Review bookkeeping must not block a receive that now validates.
          }
        }
        if (receive.pendingValidationFailure) {
          delete receive.pendingValidationFailure
          changed = true
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
        if (item.batch && receive.receivedConsignment && !receive.receivedConsignment.batch) {
          receive.receivedConsignment.batch = true
          changed = true
        }

        // The proxy may have accepted ACK immediately before an extension
        // shutdown. Reconcile that durable local intent before treating any
        // missing proxy payload as sender cancellation.
        if (receive.receivedConsignment?.acknowledgementPending) {
          const acknowledgement = await this.getProxyAcknowledgement(receive, item.endpoint)
          if (acknowledgement !== false) {
            // The durable intent makes ACK retries safe. A request failure is
            // not evidence of sender cancellation. Even when ACK=true is
            // already visible, repeat the idempotent ACK request to recover
            // the signed transaction released by Proxy v1 before cleaning it.
            try {
              const acknowledgementResult = await this.acknowledgeProxyConsignment(item, true)
              if (acknowledgementResult?.releasePending) {
                if (
                  receive.buySwapIntent?.backendCommittedAt ||
                  item.batch ||
                  receive.pendingAccept?.batch ||
                  receive.receivedConsignment.batch
                ) {
                  if (receive.buySwapIntent?.backendCommittedAt) {
                    receive.receivedConsignment.accepted = true
                    delete receive.receivedConsignment.acknowledgementPending
                    delete receive.pendingAccept
                    this.markProxyDataReleasePending(receive)
                    changed = true
                  }
                  continue
                }
                if (acknowledgement === true) {
                  // ACK is durable, but the released transaction is not
                  // available yet. Keep the receipt recoverable rather than
                  // misclassifying a single-recipient transfer as canceled.
                  continue
                }
                // A single-recipient operation releases its transaction on
                // the first ACK. A successful ACK without signed_tx means the
                // sender removed it with ack.clean before this retry.
                this.recordReceiveOutcome(receive, 'canceled', match.txid)
                pending.splice(receiveIndex, 1)
                changed = true
                continue
              }
              if (acknowledgementResult?.signedRawTx) {
                if (receive.buySwapIntent?.backendCommittedAt) {
                  this.assertReceiveAnchorTransaction(
                    match.txid,
                    acknowledgementResult.signedRawTx,
                    match.signedRawTx || receive.pendingAccept?.signedRawTx
                  )
                } else {
                  await this.persistAndBroadcastReceiveAnchor(
                    receive,
                    match.txid,
                    acknowledgementResult.signedRawTx,
                    match.signedRawTx || receive.pendingAccept?.signedRawTx
                  )
                }
              }
            } catch (error) {
              if (acknowledgement === true) {
                // The ACK cannot be rolled back. If the proxy temporarily
                // cannot replay the released transaction, retain the durable
                // receipt and retry instead of reporting cancellation.
                continue
              }
              if (!(error instanceof RgbProxyOperationNotFoundError &&
                !receive.buySwapIntent?.backendCommittedAt &&
                await this.ensureDonationAnchorBroadcast(
                  receive, match.txid, match.signedRawTx || receive.pendingAccept?.signedRawTx
                ))) {
                if (
                  isProxySignedTransactionCleared(error) ||
                  (error instanceof RgbProxyOperationNotFoundError &&
                    !!receive.buySwapIntent?.backendCommittedAt)
                ) {
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
            this.markProxyDataReleasePending(receive)
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
          if (acceptedChain &&
            match.txid.toLowerCase() !== receive.receivedConsignment.txid.toLowerCase()) {
            throw new RgbServiceError('RGB accepted receive transaction changed before settlement')
          }
          // A receipt may become accepted earlier in this same pass while an
          // ACK retry is reconciled. It has not gone through the early gate.
          if (!acceptedBeforeValidation) {
            if (await this.isAcceptedReceiveTerminallyCanceled(receive)) {
              this.recordReceiveOutcome(receive, 'canceled', match.txid)
              pending.splice(receiveIndex, 1)
              changed = true
              continue
            }
            if (
              receive.receivedConsignment.signedRawTx &&
              !receive.receivedConsignment.broadcastDetectedAt
            ) {
              await this.ensureReceiveAnchorBroadcast(
                match.txid,
                receive.receivedConsignment.signedRawTx
              )
            }
          }
          const broadcastDetectedAt = receive.receivedConsignment.broadcastDetectedAt
          const settled = await this.advanceAcceptedReceive(
            receive,
            item,
            match,
            deferConfirmedSettlement,
            acceptedChain
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
        const operationIds = [...new Set(
          (match.assignments || [{ opId: match.opId }]).map(assignment => assignment.opId)
        )]
        if (
          !receive.pendingAccept ||
          receive.pendingAccept.txid !== match.txid ||
          receive.pendingAccept.payload !== item.payload ||
          receive.pendingAccept.operationIds?.join(',') !== operationIds.join(',') ||
          receive.pendingAccept.precision !== precision ||
          receive.pendingAccept.batch !== item.batch
        ) {
          receive.pendingAccept = {
            payload: item.payload,
            txid: match.txid,
            endpoint: item.endpoint,
            proxyTransferId: item.proxyTransferId,
            proxySenderPublicKey: item.proxySenderPublicKey,
            proxySenderEndpoint: item.proxySenderEndpoint,
            proxyConsignmentHash: item.proxyConsignmentHash,
            batch: item.batch,
            signedRawTx: match.signedRawTx,
            assetId: match.assetId,
            amount: match.amount,
            operationIds,
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
        if (receive.receivedConsignment?.accepted) {
          // ACK is immutable once accepted. A local settlement failure (for
          // example, while merging recovered history) is retriable and must
          // never turn a successfully acknowledged transfer into a NACK or a
          // user-visible rejected receive.
          continue
        }
        if (error instanceof RgbBfaValidationUnavailableError) {
          // Missing chain finality, RPC data, or another transient validation
          // dependency must remain retriable and must never invite a NACK.
          if (receive.pendingValidationFailure) {
            delete receive.pendingValidationFailure
            changed = true
          }
          continue
        }
        const message = error instanceof Error ? error.message : String(error)
        const reason = `Consignment validation failed: ${message.slice(0, 300)}`
        stageValidationFailure(reason)
        await refreshValidationReview(receive, receive.pendingValidationFailure!, item.payload)
      }
    }
    // Expiration alone does not prove that an offline receiver has not been
    // sent a consignment. The durable proxy poll above includes expired
    // entries and must succeed before this point. Release only entries it did
    // not return, whether the transport uses single or batch retrieval.
    if (
      this.dependencies.transport.getConsignment ||
      this.dependencies.transport.getConsignments
    ) {
      const now = Math.floor(this.now() / 1000)
      for (let index = pending.length - 1; index >= 0; index--) {
        const receive = pending[index]!
        if (
          !receive.expirationTimestamp || receive.expirationTimestamp > now ||
          receive.pendingAccept || receive.pendingValidationFailure || receive.receivedConsignment ||
          receivedByRecipient.has(receive.proxyRecipientId || receive.recipientId)
        ) continue
        try {
          const endpoints = decodeRgbInvoice(receive.invoice).transportEndpoints
          if (!endpoints.length) continue
        } catch {
          // A malformed legacy invoice cannot be confirmed unused.
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
    if (await this.releaseHandledProxyData()) {
      await this.persist({ waitForRecovery: true })
    }
    return { received: count, snapshotRequired }
  }

  /** Bind a buyer-only PSBT to the validated Proxy v1 consignment before exposing it. */
  async stageBuySwapIntent(
    recipientId: string,
    input: { txid: string; buyerSignedPsbtHash: string }
  ) {
    return this.runPendingReceiveOperation(async () => {
      const state = this.requireState()
      const receive = (state.pendingReceives || []).find(
        item => item.recipientId === recipientId || item.proxyRecipientId === recipientId
      )
      if (!receive?.pendingAccept) {
        throw new RgbServiceError(`RGB receive ${recipientId} is not awaiting acceptance`)
      }
      if (
        !receive.proxyPrivateKey ||
        !receive.pendingAccept.proxyTransferId ||
        !receive.pendingAccept.proxySenderPublicKey
      ) {
        throw new RgbServiceError('RGB buy swap requires a Proxy v1 sender operation')
      }
      if (receive.pendingAccept.txid.toLowerCase() !== input.txid.toLowerCase()) {
        throw new RgbServiceError('RGB buy swap PSBT does not match the validated consignment')
      }
      if (!/^[0-9a-f]{64}$/i.test(input.buyerSignedPsbtHash)) {
        throw new RgbServiceError('RGB buy swap signed PSBT hash is invalid')
      }
      const existing = receive.buySwapIntent
      if (
        existing &&
        (existing.txid.toLowerCase() !== input.txid.toLowerCase() ||
          existing.buyerSignedPsbtHash.toLowerCase() !== input.buyerSignedPsbtHash.toLowerCase())
      ) {
        throw new RgbServiceError('RGB buy swap already has a different signed proposal')
      }
      if (!existing) {
        receive.acceptancePolicy = 'buy_swap_backend_commit'
        receive.buySwapIntent = {
          txid: input.txid.toLowerCase(),
          buyerSignedPsbtHash: input.buyerSignedPsbtHash.toLowerCase(),
          stagedAt: this.now(),
        }
        await this.persist({ waitForRecovery: true })
      }
      return receive.buySwapIntent
    })
  }

  async acceptReceive(
    recipientId: string,
    options: { buySwapBackendCommitted?: boolean } = {}
  ) {
    return this.runPendingReceiveOperation(() => this.acceptReceiveOnce(recipientId, options))
  }

  async acceptReceives(recipientIds: string[]) {
    return this.runPendingReceiveOperation(async () => {
      const caches: ReceiveValidationCaches = {
        evmRpcCache: new Map<string, Promise<unknown>>(),
        bitcoinStatusCache: new Map<string, Promise<boolean>>(),
        consignments: new Map<string, Promise<ValidatedBfaConsignment>>(),
      }
      const results: Array<{
        recipientId: string
        accepted: boolean
        status: 'accepted' | 'pending' | 'canceled' | 'failed'
        error?: string
      }> = []
      const staged: string[] = []
      for (const recipientId of [...new Set(recipientIds)]) {
        try {
          const result = await this.acceptReceiveOnce(recipientId, {}, caches, { stageOnly: true })
          if (result.status === 'staged') staged.push(recipientId)
          else results.push({ recipientId, ...result })
        } catch (error) {
          results.push({
            recipientId,
            accepted: false,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      // Persist every local receipt before the first irreversible ACK. A crash
      // after any later ACK can then recover the whole batch from the durable
      // acknowledgementPending records.
      if (staged.length) await this.persist({ waitForRecovery: true })
      for (const recipientId of staged) {
        try {
          const result = await this.acceptReceiveOnce(recipientId, {}, caches, {
            deferFinalPersist: true,
            deferProxyRelease: true,
          })
          if (result.status === 'staged') {
            throw new RgbServiceError('RGB batch receive remained in staging')
          }
          results.push({ recipientId, ...result })
        } catch (error) {
          results.push({
            recipientId,
            accepted: false,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      if (staged.length) {
        await this.persist({ waitForRecovery: true })
        if (await this.releaseHandledProxyData()) {
          await this.persist({ waitForRecovery: true })
        }
      }
      return results
    })
  }

  private async acceptReceiveOnce(
    recipientId: string,
    options: { buySwapBackendCommitted?: boolean },
    caches?: ReceiveValidationCaches,
    control: {
      stageOnly?: boolean
      deferFinalPersist?: boolean
      deferProxyRelease?: boolean
    } = {}
  ) {
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
      receive.acceptancePolicy === 'buy_swap_backend_commit' &&
      options.buySwapBackendCommitted !== true
    ) {
      throw new RgbServiceError('RGB buy swap requires a verified backend commitment before ACK')
    }
    if (
      options.buySwapBackendCommitted === true &&
      (receive.acceptancePolicy !== 'buy_swap_backend_commit' || !receive.buySwapIntent)
    ) {
      throw new RgbServiceError('RGB receive is not a staged buy swap')
    }
    if (options.buySwapBackendCommitted === true && !receive.proxyPrivateKey) {
      throw new RgbServiceError('RGB buy swap ACK requires Proxy v1')
    }
    if (receive.rejection) {
      throw new RgbServiceError(`RGB receive ${recipientId} was already rejected`)
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
      let requiredOperationIds = receive.pendingAccept.operationIds
      if (
        !requiredOperationIds?.length &&
        this.requireState().contracts?.[receive.pendingAccept.assetId] &&
        this.needsV1HistoryMerge(receive.pendingAccept.assetId, item.payload)
      ) {
        // Pending accepts restored from an older checkpoint predate operationIds.
        // Revalidate the proposal against this invoice before using its branch
        // to scope mutable Bitcoin witness checks.
        const refreshed = await this.validateIncomingConsignment(receive, item, undefined, caches)
        if (!refreshed) {
          throw new RgbServiceError('RGB receive no longer matches its invoice')
        }
        requiredOperationIds = [...new Set(
          (refreshed.assignments || [{ opId: refreshed.opId }]).map(assignment => assignment.opId)
        )]
        receive.pendingAccept.operationIds = requiredOperationIds
      }
      await this.preflightReceiveHistory(
        receive.pendingAccept.assetId,
        item.payload,
        item.txid,
        requiredOperationIds,
        caches
      )
      if (
        options.buySwapBackendCommitted === true &&
        receive.buySwapIntent &&
        !receive.buySwapIntent.backendCommittedAt
      ) {
        receive.buySwapIntent.backendCommittedAt = this.now()
      }
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
        batch: receive.pendingAccept.batch,
        counterpartyScriptPubKeys: receive.pendingAccept.counterpartyScriptPubKeys,
      }
      if (!control.stageOnly) await this.persist({ waitForRecovery: true })
    }
    if (control.stageOnly) return { accepted: false, status: 'staged' as const }
    let acknowledgementConfirmed = false
    if (acknowledgementWasPending) {
      const acknowledgement = await this.getProxyAcknowledgement(receive, item.endpoint)
      acknowledgementConfirmed = acknowledgement === true
      if (acknowledgement === false) {
        this.recordReceiveOutcome(receive, 'canceled', receive.pendingAccept.txid)
        state.pendingReceives = pending.filter(item => item !== receive)
        await this.persist()
        return { accepted: false, status: 'canceled' as const }
      }
    }
    let acknowledgementResult: Awaited<ReturnType<RgbService['acknowledgeProxyConsignment']>> = undefined
    try {
      acknowledgementResult = await this.acknowledgeProxyConsignment(item, true)
    } catch (error) {
      if (acknowledgementConfirmed) {
        // ACK=true is durable. Do not convert a temporary failure to replay
        // the released transaction into sender cancellation.
        return { accepted: false, status: 'pending' as const }
      }
      if (error instanceof RgbProxyOperationNotFoundError) {
        if (receive.buySwapIntent?.backendCommittedAt) {
          // A backend-committed swap must never fall back to the donation
          // broadcast path: Proxy v1 may only hold the maker-partial tx.
          this.recordReceiveOutcome(receive, 'canceled', receive.pendingAccept.txid)
          state.pendingReceives = pending.filter(item => item !== receive)
          await this.persist()
          return { accepted: false, status: 'canceled' as const }
        }
        const alreadyBroadcast = await this.ensureDonationAnchorBroadcast(
          receive, item.txid, receive.pendingAccept.signedRawTx
        )
        if (!alreadyBroadcast) {
          // ack.clean is the only cancellation signal available to a Proxy v1
          // receiver without a read-only operation-status endpoint. Convert
          // the failed Accept into a terminal sender-canceled result instead
          // of leaving a stale Pending acceptance action behind.
          this.recordReceiveOutcome(receive, 'canceled', receive.pendingAccept.txid)
          state.pendingReceives = pending.filter(item => item !== receive)
          await this.persist()
          return { accepted: false, status: 'canceled' as const }
        }
      } else {
        if (!isProxySignedTransactionCleared(error)) throw error
        this.recordReceiveOutcome(receive, 'canceled', receive.pendingAccept.txid)
        state.pendingReceives = pending.filter(item => item !== receive)
        await this.persist()
        return { accepted: false, status: 'canceled' as const }
      }
    }
    if (acknowledgementResult?.releasePending && !receive.buySwapIntent?.backendCommittedAt) {
      if (receive.pendingAccept.batch !== true) {
        if (acknowledgementConfirmed) {
          // A prior ACK succeeded, but its released transaction could not be
          // replayed yet. Retain the receipt for the next recovery cycle.
          return { accepted: false, status: 'pending' as const }
        }
        // For a non-batch operation there are no other recipients to wait
        // for. Proxy 0.4 returns this same shape after ack.clean removed the
        // signed transaction, so surface the sender cancellation instead.
        this.recordReceiveOutcome(receive, 'canceled', receive.pendingAccept.txid)
        state.pendingReceives = pending.filter(item => item !== receive)
        await this.persist()
        return { accepted: false, status: 'canceled' as const }
      }
      return { accepted: false, status: 'pending' as const }
    }
    if (acknowledgementResult?.signedRawTx) {
      if (receive.buySwapIntent?.backendCommittedAt) {
        // Proxy v1 immutable ack.prepare may contain the maker's initial
        // partial transaction. Bind it to the validated consignment, but leave
        // the backend-held final transaction as the only broadcast candidate.
        this.assertReceiveAnchorTransaction(
          item.txid,
          acknowledgementResult.signedRawTx,
          receive.pendingAccept.signedRawTx
        )
      } else {
        await this.persistAndBroadcastReceiveAnchor(
          receive,
          item.txid,
          acknowledgementResult.signedRawTx,
          receive.pendingAccept.signedRawTx
        )
      }
    }
    receive.receivedConsignment!.accepted = true
    delete receive.receivedConsignment!.acknowledgementPending
    delete receive.pendingAccept
    this.markProxyDataReleasePending(receive)
    if (!control.deferFinalPersist) await this.persist({ waitForRecovery: true })
    if (!control.deferProxyRelease && await this.releaseHandledProxyData(receive)) {
      await this.persist({ waitForRecovery: true })
    }

    // Ordinary Proxy v1 receives broadcast the released transaction above.
    // A backend-committed buy swap intentionally leaves broadcast to its
    // sender/backend and never exposes those final bytes through the provider.
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
    if (receive.rejection) {
      throw new RgbServiceError(`RGB receive ${recipientId} was already rejected`)
    }
    const pendingAccept = receive.pendingAccept
    const validationFailure = receive.pendingValidationFailure
    if (!pendingAccept && !validationFailure && !receive.receivedConsignment) {
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
    if (validationFailure && validationFailure.reviewStatus !== 'rejection_allowed') {
      throw new RgbServiceError('RGB receive is still under validation review')
    }

    const proposal = pendingAccept || validationFailure
    if (!proposal) {
      throw new RgbServiceError('RGB receive has no transfer to reject')
    }
    if (!proposal.endpoint && !validationFailure) {
      throw new RgbServiceError('RGB receive cannot be rejected without a proxy endpoint')
    }
    const rollback = snapshotState(state)
    let proxyNackPosted = false
    if (proposal.endpoint) {
      try {
        await this.acknowledgeProxyConsignment(
          {
            recipientId: receive.proxyRecipientId || receive.recipientId,
            endpoint: proposal.endpoint,
            proxyTransferId: proposal.proxyTransferId,
            proxySenderPublicKey: proposal.proxySenderPublicKey,
            proxySenderEndpoint: proposal.proxySenderEndpoint,
            proxyConsignmentHash: proposal.proxyConsignmentHash,
          },
          false
        )
        proxyNackPosted = !!this.dependencies.transport.acknowledgeConsignment
      } catch (error) {
        // Donations have no sender ACK operation. Rejection is still a local
        // decision even though the Bitcoin transaction may already be public.
        if (!(error instanceof RgbProxyOperationNotFoundError)) throw error
      }
    }
    const rejectionKind = proxyNackPosted
      ? 'proxy_nack' as const
      : validationFailure
        ? 'local_validation_reject' as const
        : 'local_donation_reject' as const
    const rejectionReason = validationFailure
      ? `${proxyNackPosted ? 'Rejected by you' : 'Discarded locally by you without notifying the sender'} after validation failed: ${validationFailure.reason}`
      : 'Rejected by you'
    this.recordReceiveOutcome(
      receive, 'rejected', proposal.txid || '',
      rejectionReason,
      false
    )
    // The recipient ID remains single-use, but the random Proxy v1 private key
    // cannot be reconstructed from the wallet seed. Retain the complete
    // receive inside encrypted state/checkpoints instead of conflating Reject
    // with permanent key destruction.
    receive.rejection = {
      kind: rejectionKind,
      rejectedAt: this.now(),
      reason: rejectionReason,
    }
    await this.persistWithRecoveryRollback(rollback)
    return { rejected: true, rejectionReason }
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
    item: {
      recipientId: string
      payload: string
      txid?: string
      endpoint?: string
      proxyTransferId?: string
      proxySenderPublicKey?: string
    },
    onMismatch?: (reason: string, details: Record<string, unknown>) => void,
    caches?: ReceiveValidationCaches
  ) {
    const mismatch = (reason: string, details: Record<string, unknown> = {}): undefined => {
      onMismatch?.(reason, details)
      return undefined
    }
    // Proxy v1 consignments have no Bitcoin txid field. Older adapters stored
    // that absence as '', which must not constrain the witness in a NIA payload.
    const expectedTxid = item.txid || undefined
    const originalPayload = Uint8Array.from(Buffer.from(item.payload, 'base64'))
    // Proxy authentication applies to originalPayload. Only after transport
    // verification/decryption do we canonicalize Wallet 1.8.0-1.8.2 V1 bytes.
    const normalizedPayload = normalizeLegacyV1Consignment(originalPayload)
    const v1SchemaId = v1TransferSchemaId(normalizedPayload)
    const v1 = isSupportedV1TransferConsignment(normalizedPayload)
    if (v1SchemaId && !v1) {
      throw new RgbServiceError(`RGB v1 schema is unsupported: ${v1SchemaId}`)
    }
    // Legacy NIA bytes are only parsed by the constrained migration layer.
    // Acceptance, allocation matching and persisted history all use the same
    // v1 validator as native v1 transfers.
    const payload = v1 ? normalizedPayload : convertNiaV0ConsignmentToV1(originalPayload)
    const validate = this.dependencies.validateBfaConsignment
    if (!validate) throw new RgbServiceError('RGB v1 receive validation is unavailable')
    const validationKey = `${expectedTxid || 'pending-last'}:${Buffer.from(payload).toString('base64')}`
    let validation = caches?.consignments.get(validationKey)
    if (!validation) {
      validation = validate({
        wallet: this.requireState().wallet, payload,
        ...(expectedTxid ? { pendingWitnessTxid: expectedTxid } : { allowPendingLastWitness: true }),
        knownBlindSeals: this.getKnownBlindSeals(),
        ...(caches ? {
          evmRpcCache: caches.evmRpcCache,
          bitcoinStatusCache: caches.bitcoinStatusCache,
        } : {}),
        confirmedBitcoinWitnesses: this.requireState().confirmedBitcoinWitnesses ||= {},
      })
      caches?.consignments.set(validationKey, validation)
    }
    const bfa = await validation
    if (receive.recipientType === 'witness' && !receive.witnessScriptPubKey)
      return mismatch('missing_witness_script')
    if (receive.recipientType !== 'witness' && !receive.seal)
      return mismatch('missing_blind_seal')
    const assetId = bfa.assetId
    if (receive.assetId && receive.assetId !== assetId)
      return mismatch(v1 ? 'asset_id' : 'asset_or_amount', { actualAssetId: assetId })
    const secret = receive.seal ? Buffer.from(concealBlindSeal(receive.seal)).toString('hex') : undefined
    const latestBundleId = bfa.bundles.at(-1)?.id
    const proxyV1Witness = receive.recipientType === 'witness' &&
      Boolean(receive.proxyPrivateKey || receive.proxyPublicKey)
    if (proxyV1Witness && !receive.proxyPrivateKey)
      return mismatch('missing_proxy_receiver_private_key')
    if (proxyV1Witness && !item.proxySenderPublicKey)
      return mismatch('missing_proxy_sender_public_key')
    const expectedWitnessBlinding = receive.recipientType === 'witness' &&
      receive.proxyPrivateKey && item.proxySenderPublicKey
      ? deriveProxyV1SealBlinding(receive.proxyPrivateKey, item.proxySenderPublicKey)
      : undefined
    const matchesRecipient = (assignment: (typeof bfa.terminalAssignments)[number]) => {
      if (expectedTxid && assignment.txid !== expectedTxid) return false
      if (receive.recipientType === 'witness') {
        // A witness recipient is identified by its output script and (for
        // Proxy v1) the operation-key-derived blinding.
        // Matching all bundles also lets the destination check below reject a
        // malformed consignment which pays an out-of-band script more than once.
        if (!v1 && assignment.bundleId !== latestBundleId) return false
        return assignment.output?.scriptPubKey.toLowerCase() === receive.witnessScriptPubKey?.toLowerCase()
      }
      // Current RGB V1 has no serialized terminals map. A blind recipient is
      // identified directly by the concealed seal of an unspent assignment.
      return assignment.secretSeal === secret
    }
    let candidates = bfa.terminalAssignments.filter(assignment =>
      matchesRecipient(assignment) &&
      (expectedWitnessBlinding === undefined || assignment.blinding === expectedWitnessBlinding)
    )
    // Transfers created by older UniSat versions used a random witness
    // blinding. Keep them recoverable, while preferring the Proxy v1-derived
    // match for all newly compliant transfers.
    if (
      !candidates.length &&
      expectedWitnessBlinding !== undefined &&
      receive.allowLegacyWitnessBlinding === true
    ) {
      candidates = bfa.terminalAssignments.filter(matchesRecipient)
    }
    if (!candidates.length) return mismatch(
      v1 ? 'v1_recipient_assignment' :
        receive.recipientType === 'witness' ? 'nia_witness_assignment' : 'nia_blind_assignment',
      { assetId, terminalAssignmentCount: bfa.terminalAssignments.length }
    )
    const destinations = new Set(candidates.map(assignment =>
      `${assignment.bundleId}:${assignment.txid}:${assignment.vout}`
    ))
    if (destinations.size !== 1) return mismatch('ambiguous_recipient_assignment', {
      assetId, destinationCount: destinations.size,
    })
    const candidate = candidates[0]!
    const amount = candidates.reduce((sum, assignment) => sum + BigInt(assignment.amount), 0n).toString()
    if (receive.amount && receive.amount !== amount)
      return mismatch(v1 ? 'amount' : 'asset_or_amount', { actualAmount: amount })
    const output = candidate.output
    return {
      decoded: { metadata: bfa.metadata, genesis: { strict: bfa.genesis } },
      witness: { outputs: output && candidate.vout >= 0 ? Array.from({ length: candidate.vout + 1 }, (_, index) =>
        index === candidate.vout ? output : undefined) : [] },
      assetId, amount, txid: candidate.txid,
      vout: receive.seal?.vout ?? candidate.vout,
      opId: candidate.opId, assignmentIndex: candidate.assignmentIndex,
      assignments: candidates.map(assignment => ({
        opId: assignment.opId,
        assignmentIndex: assignment.assignmentIndex,
        amount: assignment.amount,
      })),
      signedRawTx: bfa.bundles.find(bundle => bundle.id === candidate.bundleId)?.signedRawTx,
      counterpartyScriptPubKeys: bfa.witnessOutputScripts,
      historyPayload: Buffer.from(payload).toString('base64'),
      ...(v1 ? {} : { legacyPayload: item.payload }),
    }
  }

  private async advanceAcceptedReceive(
    receive: import('./types').RgbPendingReceive,
    item: { recipientId: string; payload: string; txid?: string; endpoint?: string },
    validated: NonNullable<Awaited<ReturnType<RgbService['validateIncomingConsignment']>>>,
    deferConfirmedSettlement: boolean,
    knownChain?: {
      status: 'mempool' | 'confirmed' | 'pending_spend' | 'spent' | 'replaced' | 'unknown'
      confirmations: number
    }
  ) {
    const state = this.requireState()
    if (!receive.receivedConsignment) return false
    const getTransactionStatus = this.dependencies.stateSource.getTransactionStatus
    if (!getTransactionStatus) {
      throw new RgbServiceError('RGB receive chain verification is unavailable')
    }
    const chain = knownChain || await getTransactionStatus(state.wallet, validated.txid)
    const expectedConfirmations = receive.minConfirmations || 1
    if (
      (chain.status === 'mempool' || chain.status === 'confirmed') &&
      !receive.receivedConsignment.broadcastDetectedAt
    ) {
      receive.receivedConsignment.broadcastDetectedAt = this.now()
    }
    if (chain.status !== 'confirmed' || chain.confirmations < expectedConfirmations) return false

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
    // A witness output is derived from the already validated Bitcoin
    // transaction above. Settle the output and its RGB allocation atomically;
    // publishing an empty witness UTXO first creates a window where a fresh
    // replica snapshot can erase it and leave the receive permanently pending.
    // Blind receives still refresh their pre-existing seal from the snapshot.
    if (deferConfirmedSettlement && receive.recipientType !== 'witness')
      return 'snapshot_required' as const
    const assetId = normalizeAssetId(validated.assetId)
    const receivedAssignments = validated.assignments || [{
      opId: validated.opId,
      assignmentIndex: validated.assignmentIndex,
      amount: validated.amount,
    }]
    for (const assignment of receivedAssignments) {
      const existing = utxo.allocations.find(allocation =>
        allocation.opId === assignment.opId &&
        allocation.assignmentIndex === assignment.assignmentIndex
      )
      if (existing &&
        (normalizeAssetId(existing.assetId) !== assetId || existing.amount !== assignment.amount)) {
        throw new RgbServiceError('RGB receive allocation conflicts with the validated consignment')
      }
    }
    // Do this before mutating the allocation/receive state. A conflicting or
    // malformed branch must reject atomically rather than leave a spendable
    // UTXO whose required DAG was not durably retained.
    const historyPayload = validated.historyPayload || item.payload
    if (this.needsV1HistoryMerge(assetId, historyPayload)) {
      await this.storeAcceptedBfaHistory(
        assetId,
        historyPayload,
        undefined,
        validated.legacyPayload ? [validated.legacyPayload] : [],
        [...new Set(receivedAssignments.map(assignment => assignment.opId))]
      )
    } else {
      this.storeAcceptedHistory({
        assetId,
        payload: item.payload,
        opId: validated.opId,
        genesis: Buffer.from(validated.decoded.genesis.strict).toString('base64'),
        metadata: validated.decoded.metadata,
      })
    }
    for (const assignment of receivedAssignments) {
      const existing = utxo.allocations.find(allocation =>
        allocation.opId === assignment.opId &&
        allocation.assignmentIndex === assignment.assignmentIndex
      )
      if (existing) {
        existing.settled = true
        existing.spendable = true
      } else {
        utxo.allocations.push({
          assetId: validated.assetId,
          amount: assignment.amount,
          settled: true,
          spendable: true,
          opId: assignment.opId,
          assignmentIndex: assignment.assignmentIndex,
          assignmentType: 4000,
        })
      }
    }
    if (!utxo.chainStatus || utxo.chainStatus === 'mempool' || utxo.chainStatus === 'confirmed') {
      utxo.chainStatus = 'confirmed'
      utxo.confirmations = chain.confirmations
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
    txid: string,
    rejectionReason?: string,
    releaseRecipient = true
  ) {
    const state = this.requireState()
    if (releaseRecipient) this.recordReleasedReceiveRecipient(receive.recipientId)
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
    const batch = receive.receivedConsignment?.batch ?? receive.pendingAccept?.batch
    const existing = pendingReceiveHistory.find(item => item.transferId === transferId)
    if (existing) {
      // Settlement is terminal. A delayed proxy poll (especially after local
      // recovery) must never relabel an already confirmed receive as rejected
      // or canceled.
      if (existing.status !== 'settled' || status === 'settled') existing.status = status
      if (existing.status === 'rejected' && rejectionReason) existing.rejectionReason = rejectionReason
      else if (existing.status !== 'rejected') delete existing.rejectionReason
      existing.txid = txid || existing.txid
      if (assetId) existing.assetId = assetId
      if (amount) existing.amount = amount
      if (precision !== undefined) existing.precision = precision
      if (batch) existing.batch = true
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
      ...(batch ? { batch: true } : {}),
      txid,
      createdAt:
        receive.receivedConsignment?.receivedAt ||
        receive.pendingAccept?.discoveredAt ||
        this.now(),
      status,
      ...(status === 'rejected' && rejectionReason ? { rejectionReason } : {}),
      counterpartyScriptPubKeys:
        receive.pendingAccept?.counterpartyScriptPubKeys ||
        receive.receivedConsignment?.counterpartyScriptPubKeys,
    })
  }

  /** Remove the display-only rejection row when a local donation validates after an upgrade. */
  private removeRejectedReceiveHistory(receive: import('./types').RgbPendingReceive) {
    const state = this.requireState()
    const transferId = `receive:${receive.proxyRecipientId || receive.recipientId}`
    state.pendingReceiveHistory = state.pendingReceiveHistory?.filter(
      item => item.transferId !== transferId || item.status !== 'rejected'
    )
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
    const invoice = decodeRgbInvoice(receive.invoice)
    const endpoints = invoice.transportEndpoints
    if (!endpoints.length) return false
    try {
      const consignment = await getConsignment({
        recipientId: receive.proxyRecipientId || receive.recipientId,
        endpoints,
        proxyPrivateKey: receive.proxyPrivateKey,
        encryption: invoice.encryption,
      })
      return !consignment
    } catch {
      return false
    }
  }

  private markProxyDataReleasePending(receive: import('./types').RgbPendingReceive) {
    const receipt = receive.receivedConsignment
    if (
      receive.proxyPrivateKey &&
      receipt?.endpoint &&
      receipt.proxyTransferId &&
      this.dependencies.transport.markConsignmentRetrieved
    ) {
      receipt.proxyDataReleasePending = true
    }
  }

  /** Best-effort cleanup: failure only retains remote bytes until a later retry or expiry. */
  private async releaseHandledProxyData(only?: import('./types').RgbPendingReceive) {
    const release = this.dependencies.transport.markConsignmentRetrieved
    if (!release) return false
    let changed = false
    const receives = only ? [only] : this.requireState().pendingReceives || []
    for (const receive of receives) {
      const receipt = receive.receivedConsignment
      if (
        !receipt?.accepted ||
        !receipt.proxyDataReleasePending ||
        !receipt.endpoint ||
        !receipt.proxyTransferId ||
        !receive.proxyPrivateKey
      ) continue
      try {
        await release({
          endpoint: receipt.endpoint,
          proxyTransferId: receipt.proxyTransferId,
          proxyPrivateKey: receive.proxyPrivateKey,
        })
        delete receipt.proxyDataReleasePending
        receipt.proxyDataReleasedAt = this.now()
        changed = true
      } catch {
        // The proxy expires payloads independently; retain the retry marker.
      }
    }
    return changed
  }

  /** A v1 donation has no sender ACK operation; broadcast its validated signed witness if needed. */
  private async ensureDonationAnchorBroadcast(
    receive: import('./types').RgbPendingReceive,
    txid: string,
    signedRawTx?: string
  ) {
    if (!signedRawTx) return this.ensureReceiveAnchorBroadcast(txid)
    return this.persistAndBroadcastReceiveAnchor(receive, txid, signedRawTx, signedRawTx)
  }

  /** Persist a released witness before network I/O so a restart can retry the broadcast. */
  private async persistAndBroadcastReceiveAnchor(
    receive: import('./types').RgbPendingReceive,
    txid: string,
    signedRawTx: string,
    expectedSignedRawTx?: string
  ) {
    this.assertReceiveAnchorTransaction(txid, signedRawTx, expectedSignedRawTx)
    const receipt = receive.receivedConsignment
    if (!receipt) throw new RgbServiceError('RGB receive state is incomplete')
    if (receipt.txid !== txid) {
      throw new RgbServiceError('Released transaction ID does not match the RGB receive')
    }
    if (receipt.signedRawTx && receipt.signedRawTx !== signedRawTx) {
      throw new RgbServiceError('RGB proxy released a different signed transaction')
    }
    if (!receipt.signedRawTx) {
      receipt.signedRawTx = signedRawTx
      await this.persist({ waitForRecovery: true })
    }
    return this.ensureReceiveAnchorBroadcast(txid, signedRawTx)
  }

  /** Bind proxy-released bytes to the witness transaction validated from the consignment. */
  private assertReceiveAnchorTransaction(
    txid: string,
    signedRawTx: string,
    expectedSignedRawTx?: string
  ) {
    let transaction: Transaction
    try {
      transaction = Transaction.fromHex(signedRawTx)
    } catch {
      throw new RgbServiceError('RGB proxy released an invalid signed transaction')
    }
    if (transaction.getId().toLowerCase() !== txid.toLowerCase()) {
      throw new RgbServiceError('Released transaction ID does not match the RGB receive')
    }
    // In the ordinary Proxy v1 flow the pre-ACK consignment may contain an
    // unsigned witness transaction. The authenticated signed transaction is
    // released only by ack.post(true), so its txid is the available binding.
    // When the consignment did carry signed bytes, retain the stronger exact
    // comparison used by donation and fully signed bundle flows.
    if (!expectedSignedRawTx) return
    let expected: Transaction
    try {
      expected = Transaction.fromHex(expectedSignedRawTx)
    } catch {
      throw new RgbServiceError('Validated RGB consignment has an invalid signed transaction')
    }
    if (expected.getId().toLowerCase() !== txid.toLowerCase() ||
      !Buffer.from(signedRawTx, 'hex').equals(Buffer.from(expectedSignedRawTx, 'hex'))) {
      throw new RgbServiceError('RGB proxy released a different signed transaction')
    }
  }

  private async ensureReceiveAnchorBroadcast(txid: string, signedRawTx?: string) {
    if (signedRawTx) {
      let broadcastCandidate: Transaction
      try {
        broadcastCandidate = Transaction.fromHex(signedRawTx)
      } catch {
        throw new RgbServiceError('RGB receive signed transaction is invalid')
      }
      if (broadcastCandidate.getId().toLowerCase() !== txid.toLowerCase()) {
        throw new RgbServiceError('Released transaction ID does not match the RGB receive')
      }
    }
    if (await this.isReceiveAnchorBroadcast(txid)) return true
    if (!signedRawTx) return false
    let broadcastTxid: string
    try {
      broadcastTxid = await this.dependencies.broadcaster.broadcast(signedRawTx)
    } catch (error) {
      // A sender and receiver can race to submit the same transaction. Treat
      // an already-visible transaction as success regardless of which side won.
      if (await this.isReceiveAnchorBroadcast(txid)) return true
      throw error
    }
    if (broadcastTxid !== txid) {
      throw new RgbServiceError('Broadcast transaction ID does not match the RGB receive')
    }
    return true
  }

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
    // Acceptance ACKs the consignment and lets either party broadcast the same
    // signed transaction. The local record is then needed to settle the allocation,
    // so it cannot be released as an unused invoice.
    if (
      removed.receivedConsignment?.accepted ||
      removed.receivedConsignment?.acknowledgementPending ||
      removed.pendingAccept ||
      removed.pendingValidationFailure
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
    const histories: Array<{ opId: string; payload: string }> = []
    if (contract?.history) {
      histories.push({ opId: contractOperationId(normalized), payload: contract.history.payload })
    } else if (contract) {
      histories.push({ opId: contractOperationId(normalized), payload: contract.consignment })
    }
    // Burn proofs are self-contained portable histories. Keep them available
    // as a recovery supplement because an address indexer can expose the
    // surviving split change before it has merged the split/Burn DAG.
    for (const proof of Object.values(this.requireState().burnProofs || {})) {
      if (normalizeAssetId(proof.assetId) === normalized &&
        !histories.some(item => item.payload === proof.payload)) {
        histories.push({ opId: contractOperationId(normalized), payload: proof.payload })
      }
    }
    // A newly accepted mempool receive can become spendable before its
    // canonical DAG merge/checkpoint finishes. Its payload was already fully
    // validated, so make it available to a chained send during that window.
    for (const receive of this.requireState().pendingReceives || []) {
      const candidates = [receive.receivedConsignment, receive.pendingAccept]
      for (const candidate of candidates) {
        if (candidate?.assetId && normalizeAssetId(candidate.assetId) === normalized &&
          candidate.payload && !histories.some(item => item.payload === candidate.payload)) {
          histories.push({ opId: contractOperationId(normalized), payload: candidate.payload })
        }
      }
    }
    return histories
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
   * Merge a newly verified receive into a compact canonical Consignment. RGB
   * V1 derives graph terminals from the unspent assignments in the Genesis and
   * WitnessBundle DAG, so the canonical payload needs no delivery metadata.
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
      const bytes = normalizeLegacyV1Consignment(
        Uint8Array.from(Buffer.from(item, 'base64'))
      )
      return isSupportedV1TransferConsignment(bytes) || isSupportedV1ContractConsignment(bytes)
    })
  }

  /** Check the exact merge before ACK makes the receive irrevocable to the sender. */
  private async preflightReceiveHistory(
    assetId: string,
    payload: string,
    pendingWitnessTxid?: string,
    requiredOperationIds?: string[],
    caches?: ReceiveValidationCaches
  ) {
    const existing = this.requireState().contracts?.[assetId]
    if (!existing) return
    const normalizedPayload = Buffer.from(normalizeLegacyV1Consignment(
      Uint8Array.from(Buffer.from(payload, 'base64'))
    )).toString('base64')
    if (this.needsV1HistoryMerge(assetId, normalizedPayload)) {
      await this.prepareV1HistoryMerge(
        assetId,
        normalizedPayload,
        pendingWitnessTxid,
        [],
        requiredOperationIds,
        caches
      )
      return
    }
    mergeNiaConsignmentHistory({
      assetId,
      consignments: [
        { opId: contractOperationId(assetId), payload: existing.history?.payload ?? existing.consignment },
        { opId: contractOperationId(assetId), payload: normalizedPayload },
      ],
      requiredOpIds: [],
      knownBlindSeals: this.getKnownBlindSeals(),
    })
  }

  private async prepareV1HistoryMerge(
    assetId: string,
    payload: string,
    pendingWitnessTxid?: string,
    additionalLegacyPayloads: string[] = [],
    requiredOperationIds?: string[],
    caches?: ReceiveValidationCaches
  ) {
    const validate = this.dependencies.validateBfaConsignment
    if (!validate) throw new RgbServiceError('RGB v1 receive validation is unavailable')
    const state = this.requireState()
    const existing = state.contracts?.[assetId]
    const existingPayload = existing?.history?.payload ?? existing?.consignment
    const originals = [...new Set([existingPayload, payload].filter((item): item is string => Boolean(item)))]
    const legacyPayloads = [...new Set([
      ...(existing?.history?.legacyPayloads || []),
      ...additionalLegacyPayloads,
    ])]
    const transfers: Uint8Array[] = []
    const rootGenesises: string[] = []
    for (const original of originals) {
      const bytes = normalizeLegacyV1Consignment(
        Uint8Array.from(Buffer.from(original, 'base64'))
      )
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
    const evmRpcCache = caches?.evmRpcCache ?? new Map<string, Promise<unknown>>()
    const bitcoinStatusCache = caches?.bitcoinStatusCache ?? new Map<string, Promise<boolean>>()
    const confirmedBitcoinWitnesses = state.confirmedBitcoinWitnesses ||= {}
    const validated = await Promise.all(transfers.map(bytes => validate({
      wallet: state.wallet, payload: bytes,
      ...(pendingWitnessTxid ? { pendingWitnessTxid } : {}), knownBlindSeals, evmRpcCache, bitcoinStatusCache, confirmedBitcoinWitnesses,
      ...(requiredOperationIds?.length ? { requiredOperationIds } : {}),
    })))
    if (pendingWitnessTxid && requiredOperationIds?.length) {
      const pendingOperations = new Set(validated.flatMap(item =>
        item.terminalAssignments
          .filter(assignment => assignment.txid === pendingWitnessTxid)
          .map(assignment => assignment.opId)
      ))
      if (requiredOperationIds.some(opId => !pendingOperations.has(opId))) {
        throw new RgbServiceError('RGB receive operations do not match the pending witness')
      }
    }
    if (validated.some(item => item.assetId !== assetId))
      throw new RgbServiceError('RGB v1 history asset ID mismatch')
    const canonical = mergeBfaValidatedHistories(validated)
    const complete = await validate({
      wallet: state.wallet, payload: canonical,
      ...(pendingWitnessTxid ? { pendingWitnessTxid } : {}), knownBlindSeals, evmRpcCache, bitcoinStatusCache, confirmedBitcoinWitnesses,
      ...(requiredOperationIds?.length ? { requiredOperationIds } : {}),
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

  private async storeAcceptedBfaHistory(
    assetId: string,
    payload: string,
    pendingWitnessTxid?: string,
    additionalLegacyPayloads: string[] = [],
    requiredOperationIds?: string[]
  ) {
    const state = this.requireState()
    const existing = state.contracts?.[assetId]
    const { canonicalPayload, complete, opIds, legacyPayloads } =
      await this.prepareV1HistoryMerge(
        assetId,
        payload,
        pendingWitnessTxid,
        additionalLegacyPayloads,
        requiredOperationIds
      )
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

  /** Inspect the exact single-asset carriers eligible for an irreversible BTC sweep. */
  getAssetAbandonmentPlan(assetId: string) {
    const state = this.requireState()
    const normalized = normalizeAssetId(assetId)
    if (state.discardedAssets?.[normalized]) {
      throw new RgbServiceError('RGB asset has already been permanently abandoned')
    }
    if (Object.values(state.pending).some(item => item.request.assetId === normalized)) {
      throw new RgbServiceError('RGB asset has an active transfer')
    }
    if ((state.pendingReceives || []).some(item =>
      item.assetId === normalized ||
      item.pendingAccept?.assetId === normalized ||
      item.receivedConsignment?.assetId === normalized
    )) throw new RgbServiceError('RGB asset has an active receive or invoice')
    if ((state.pendingIssues || []).some(item => item.assetId === normalized) ||
      Object.values(state.pendingBroadcastSyncs || {}).some(item => item.assetId === normalized)) {
      throw new RgbServiceError('RGB asset still has pending synchronization work')
    }

    const carriers = state.snapshot.utxos.filter(utxo =>
      utxo.chainStatus !== 'spent' &&
      utxo.chainStatus !== 'replaced' &&
      utxo.allocations.some(allocation => normalizeAssetId(allocation.assetId) === normalized)
    )
    if (!carriers.length) throw new RgbServiceError('RGB asset has no live carrier UTXOs')
    if (carriers.some(utxo => utxo.allocations.some(allocation =>
      normalizeAssetId(allocation.assetId) !== normalized
    ))) throw new RgbServiceError('RGB carrier also contains another asset and cannot be abandoned')
    if (carriers.some(utxo =>
      utxo.chainStatus !== 'confirmed' ||
      utxo.allocations.some(allocation => !allocation.settled || !allocation.spendable)
    )) throw new RgbServiceError('RGB asset has an unconfirmed or unspendable allocation')

    const metadata = this.getLocalAssetDetail(normalized)
    return {
      assetId: normalized,
      name: metadata.name,
      ticker: metadata.ticker,
      precision: metadata.precision,
      amount: carriers.flatMap(utxo => utxo.allocations)
        .reduce((sum, allocation) => sum + BigInt(allocation.amount), 0n).toString(),
      satoshis: carriers.reduce((sum, utxo) => sum + utxo.satoshis, 0),
      utxos: carriers.map(utxo => ({
        txid: utxo.outpoint.txid,
        vout: utxo.outpoint.vout,
        satoshis: utxo.satoshis,
        scriptPubKey: utxo.scriptPubKey,
        publicKey: utxo.publicKey,
      })),
    }
  }

  /** Compact an asset only after its exclusive carrier outpoints were broadcast as spent. */
  async finalizeAssetAbandonment(assetId: string, txid: string, outpoints: RgbOutpoint[]) {
    const state = this.requireState()
    const normalized = normalizeAssetId(assetId)
    const plan = this.getAssetAbandonmentPlan(normalized)
    const expected = new Set(plan.utxos.map(item => `${item.txid}:${item.vout}`))
    const actual = new Set(outpoints.map(item => `${item.txid}:${item.vout}`))
    if (expected.size !== actual.size || [...expected].some(item => !actual.has(item))) {
      throw new RgbServiceError('RGB abandonment transaction inputs do not match its carrier UTXOs')
    }
    if (!/^[0-9a-f]{64}$/i.test(txid)) throw new RgbServiceError('RGB abandonment txid is invalid')

    const rollback = snapshotState(state)
    ;(state.discardedAssets ||= {})[normalized] = {
      txid: txid.toLowerCase(),
      outpoints: outpoints.map(item => ({ ...item })),
      discardedAt: this.now(),
    }
    state.snapshot.utxos = state.snapshot.utxos.filter(utxo => !actual.has(outpointKey(utxo)))
    if (state.contracts) delete state.contracts[normalized]
    if (state.validatedV1SendHistories) delete state.validatedV1SendHistories[normalized]
    state.pendingAssetMetadata = state.pendingAssetMetadata?.filter(item => item.assetId !== normalized)
    state.pendingSendHistory = state.pendingSendHistory?.filter(item => item.assetId !== normalized)
    state.pendingReceiveHistory = state.pendingReceiveHistory?.filter(item => item.assetId !== normalized)
    state.issueHistory = state.issueHistory?.filter(item => item.assetId !== normalized)
    if (state.burnProofs) {
      for (const [proofTxid, proof] of Object.entries(state.burnProofs)) {
        if (proof.assetId === normalized) delete state.burnProofs[proofTxid]
      }
    }
    await this.persistWithRecoveryRollback(rollback)
    return { discarded: true, assetId: normalized, txid: txid.toLowerCase() }
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
    const activeUtxos = state.snapshot.utxos.filter(utxo =>
      utxo.chainStatus !== 'spent' &&
      utxo.chainStatus !== 'replaced' &&
      utxo.chainStatus !== 'pending_spend'
    )
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
    const localSends = [
      ...Object.values(state.pending)
        .filter(pending => !pending.request.burn)
        .map(pending => ({
          invoice: pending.request.invoice,
          assetId: normalizeAssetId(pending.request.assetId),
          txid: pending.broadcast?.completed.txid || pending.delivery?.completed.txid,
          spentOutpoints: pending.prepared.lockedOutpoints,
        })),
      ...(state.pendingSendHistory || [])
        .filter(send => send.status === 'broadcasted' && !send.burn)
        .map(send => ({
          invoice: send.invoice,
          assetId: normalizeAssetId(send.assetId),
          txid: send.txid,
          spentOutpoints: send.spentOutpoints || [],
        })),
    ]
    const selfReceivesStillInSource = new Set<RgbPendingReceive>()
    const selfTransferOutputsStillInSource = new Set<string>()
    const hasCountedSelfSendSource = (assetId: string, txid: string, invoice?: string) =>
      localSends.some(candidate =>
        (invoice === undefined || candidate.invoice === invoice) &&
        candidate.assetId === assetId &&
        candidate.txid === txid &&
        candidate.spentOutpoints.some(outpoint => activeUtxos.some(utxo =>
          outpointKey(utxo) === `${outpoint.txid}:${outpoint.vout}` &&
          utxo.allocations.some(allocation => normalizeAssetId(allocation.assetId) === assetId)
        ))
      )
    for (const receive of state.pendingReceives || []) {
      const receipt = receive.receivedConsignment?.accepted
        ? receive.receivedConsignment
        : receive.pendingAccept
      if (!receipt?.txid || !receipt.assetId) continue
      const assetId = normalizeAssetId(receipt.assetId)
      if (!hasCountedSelfSendSource(assetId, receipt.txid, receive.invoice)) continue
      selfReceivesStillInSource.add(receive)
      selfTransferOutputsStillInSource.add(`${assetId}:${receipt.txid}`)
    }
    for (const receive of state.pendingReceiveHistory || []) {
      if (receive.status !== 'settled') continue
      const assetId = normalizeAssetId(receive.assetId)
      if (hasCountedSelfSendSource(assetId, receive.txid)) {
        selfTransferOutputsStillInSource.add(`${assetId}:${receive.txid}`)
      }
    }
    const amounts = new Map<string, { settled: bigint; spendable: bigint; pending: bigint; incomingPending: bigint; locked: bigint }>()
    for (const utxo of activeUtxos) {
      for (const allocation of utxo.allocations) {
        // The sender's old allocation and the self-transfer outputs may both
        // appear in an asynchronously refreshed snapshot. Count only one side.
        if (selfTransferOutputsStillInSource.has(`${normalizeAssetId(allocation.assetId)}:${utxo.outpoint.txid}`)) continue
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
        if (allocation.settled && allocation.spendable && allocation.historyAvailable !== false) {
          if (locked.has(outpointKey(utxo))) current.locked += amount
          else current.spendable += amount
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
      if (!allocation && !selfReceivesStillInSource.has(receive)) current.pending += amount
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
    const niaSpecIssue = metadata?.schema?.toUpperCase() === 'NIA'
      ? getNiaAssetSpecIssue(metadata)
      : undefined
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
            ...(metadata.schema.toUpperCase() === 'NIA'
              ? {
                  isStandard: niaSpecIssue === undefined,
                  ...(niaSpecIssue ? { nonStandardReason: niaSpecIssue } : {}),
                }
              : {}),
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
      snapshot: {
        ...state.snapshot,
        utxos: state.snapshot.utxos.map(utxo => ({
          ...utxo,
          allocations: utxo.allocations.map(allocation => ({
            ...allocation,
            localHistoryAvailable: Boolean(allocation.opId) &&
              this.localHistoryCoversAllocations(allocation.assetId, [allocation.opId!]),
          })),
        })),
      },
      assetMetadata,
      invoiceReservations: this.getPendingReceives()
        // Rejected receives are retained as recovery tombstones, but their
        // blind seals have already been released and must not be presented as
        // active UTXO reservations.
        .filter(receive => !receive.rejection)
        .map(receive => ({
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
  exportBurnConsignment(txid: string, expectedAssetId?: string): Uint8Array {
    const state = this.requireState()
    const proof = state.burnProofs?.[txid]
    const pending = Object.values(state.pending).find(item =>
      item.request.burn && (item.delivery?.completed.txid === txid || item.broadcast?.completed.txid === txid)
    )
    const payload = proof?.payload || pending?.delivery?.completed.consignments[0]?.payload ||
      pending?.broadcast?.completed.consignments[0]?.payload
    if (!payload) throw new RgbServiceError('BFA burn consignment is unavailable')
    const assetId = proof?.assetId || pending?.request.assetId
    if (expectedAssetId && assetId !== normalizeAssetId(expectedAssetId)) {
      throw new RgbServiceError('BFA burn consignment does not match the requested asset')
    }
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

  /** A self-contained UTEXO burn artifact containing both the proof and its destination. */
  exportBurn(txid: string): import('./protocol/bfa-burn-destination').UtexoBurnExportV1 {
    const consignment = this.exportBurnConsignment(txid)
    const state = this.requireState()
    const proof = state.burnProofs?.[txid]
    const pending = Object.values(state.pending).find(item => item.request.burn &&
      (item.delivery?.completed.txid === txid || item.broadcast?.completed.txid === txid))
    const hasBurnDestination = Boolean(proof?.burnDestination || pending?.request.burnDestination)
    return {
      format: 'utexo-burn',
      version: 1,
      consignment: {
        encoding: 'base64',
        byteLength: consignment.byteLength,
        data: Buffer.from(consignment).toString('base64'),
      },
      ...(hasBurnDestination ? { burnDestination: this.exportBurnDestination(txid) } : {}),
    }
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
    const requestedId = transferId.replace(/^local-send:/, '')
    const pending = Object.entries(state.pending).find(([id, item]) =>
      id === requestedId ||
      item.delivery?.completed.txid === requestedId ||
      item.broadcast?.completed.txid === requestedId
    )?.[1]
    const pendingOrigin = pending?.providerOrigin
    if (pendingOrigin) return pendingOrigin

    if (this.pruneExpiredProviderOrigins()) await this.persist({ skipRecovery: true })
    const history = state.pendingSendHistory?.find(item =>
      item.transferId === requestedId || item.txid === requestedId
    )
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
  async prepareBurn(
    request: Omit<RgbTransferRequest, 'invoice' | 'burn'> & { amount: string },
    options: { providerOrigin?: string } = {}
  ) {
    return this.prepareSend({ ...request, invoice: '', burn: true }, options)
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
    const requestedAsset = this.getLocalAssetDetail(requestedAssetId)
    const requestedAssetSchema = requestedAsset.schema?.toUpperCase()
    if (burn && requestedAssetSchema !== 'BFA')
      throw new RgbServiceError('Only BFA assets can be burned')
    if (invoice?.assetId && invoice.assetId !== requestedAssetId) {
      throw new RgbServiceError('RGB invoice asset does not match the requested asset')
    }
    if (invoice?.schema && requestedAssetSchema !== invoice.schema) {
      throw new RgbServiceError('RGB invoice schema does not match the requested asset')
    }
    if (
      requestedAssetSchema === 'BFA' &&
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
    const requireExactSelection = burn &&
      this.getStoredV1SchemaId(requestedAssetId) === BFA_SCHEMA_ID
    let burnSplitRequired = false
    let selectedUtxos: RgbUtxo[]
    try {
      selectedUtxos = this.selectUtxos(
        requestedAssetId, amount, swapInputOutpoints, requireExactSelection
      )
    } catch (error) {
      if (!(error instanceof RgbExactBurnSelectionError) || !requireExactSelection) throw error
      // Current BFA burns are terminal and cannot contain change. First create
      // an exact wallet-owned allocation with an ordinary Transfer transition.
      selectedUtxos = this.selectUtxos(requestedAssetId, amount, swapInputOutpoints)
      burnSplitRequired = true
    }
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
      for (const local of localHistory) {
        if (!history.consignments.some(item => item.payload === local.payload)) {
          history.consignments.push(local)
        }
      }
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
    // Proxy v1 binds a witness seal to both operation keys. Generate the
    // sender key before encoding so the exact same key is persisted for
    // transport publication and used for the seal blinding derivation.
    const splitInvoice = burnSplitRequired
      ? burnSplitInvoice(state.wallet, selectedUtxos[0]!, requestedAssetId, amount)
      : undefined
    const effectiveInvoice = invoice || splitInvoice
    const proxySenderPrivateKey = effectiveInvoice?.proxyPublicKey
      ? Buffer.from(randomBytes(32)).toString('hex')
      : undefined
    const intent = effectiveInvoice ? {
      assetId: requestedAssetId,
      amount,
      invoice: effectiveInvoice,
      ...(proxySenderPrivateKey ? { proxySenderPrivateKey } : {}),
      transition: planFungibleTransition({
        assetId: requestedAssetId,
        amount,
        recipientId: effectiveInvoice.recipientId,
        selectedUtxos,
      }),
    } : undefined
    const splitRequest = burnSplitRequired
      ? (() => {
          const { burn: _burn, burnReason: _burnReason, burnDestination: _burnDestination, ...rest } = resolvedRequest
          return { ...rest, invoice: '' }
        })()
      : resolvedRequest
    const encoderInput = () => ({
      wallet: state.wallet,
      snapshot: state.snapshot,
      request: splitRequest,
      intent: intent!,
      selectedUtxos,
      ...(availableFeeFunding === undefined ? {} : { feeFunding: availableFeeFunding }),
      validationHistory,
    })
    let prepared: RgbPreparedTransfer
    try {
      prepared = burn && !burnSplitRequired
        ? await this.requireBurnEncoder()(encoderInput())
        : await this.dependencies.encoder.prepareTransfer(encoderInput())
    } catch (error) {
      // `history.opIds` is metadata from the encrypted checkpoint. Older
      // checkpoints can claim an allocation Transition while their compact
      // payload no longer reveals that assignment. Do not trust that index
      // blindly: obtain the authoritative history once and retry before
      // failing the send.
      if (!isIncompleteLocalHistoryError(error)) throw error
      // The address indexer may expose a newly received allocation one poll
      // before its validation-history endpoint catches up. Refetch once even
      // when the first attempt already used remote history; retries stay
      // bounded and all returned DAGs are validated by the encoder.
      validationHistory = enrichValidationHistory(await getRemoteHistory())
      prepared = burn && !burnSplitRequired
        ? await this.requireBurnEncoder()(encoderInput())
        : await this.dependencies.encoder.prepareTransfer(encoderInput())
    }
    if (burnSplitRequired) {
      prepared.metadata = { ...prepared.metadata, burnSplit: 'true' }
    }
    if (burn) {
      const pendingParentTxids = new Set(
        selectedUtxos
          .filter(utxo => utxo.chainStatus === 'mempool')
          .map(utxo => utxo.outpoint.txid.toLowerCase())
      )
      if (pendingParentTxids.size > 1)
        throw new RgbServiceError('BFA burn cannot spend multiple unconfirmed witnesses')
      const pendingParentWitnessTxid = pendingParentTxids.values().next().value
      if (pendingParentWitnessTxid) {
        prepared.metadata = { ...prepared.metadata, pendingParentWitnessTxid }
      }
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
      request: splitRequest,
      createdAt: this.now(),
      ...(state.recoveryCheckpointGeneration === undefined
        ? {}
        : { preparedCheckpointGeneration: state.recoveryCheckpointGeneration }),
      ...(proxySenderPrivateKey ? { proxySenderPrivateKey } : {}),
      ...(options.providerOrigin ? { providerOrigin: options.providerOrigin } : {}),
      ...(burnSplitRequired ? { burnSplit: { request: resolvedRequest as RgbTransferRequest & { amount: string; burn: true } } } : {}),
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
      this.assertPreparedTransferGeneration(pending)
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
      this.assertPreparedTransferGeneration(pending)
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
    this.assertPreparedTransferGeneration(pending)

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
        const pendingParentWitnessTxid = pending.prepared.metadata?.['pendingParentWitnessTxid']
        const checked = await validate({
          wallet: state.wallet,
          payload: Uint8Array.from(Buffer.from(proof.payload, 'base64')),
          pendingWitnessTxid: pendingParentWitnessTxid || completed.txid,
          ...(pendingParentWitnessTxid ? { allowPendingLastWitness: true } : {}),
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
      const endpoints = pending.request.burn || pending.burnSplit
        ? []
        : decodeRgbInvoice(pending.request.invoice).transportEndpoints
      if (!pending.request.burn && !pending.burnSplit && !endpoints.length)
        throw new RgbServiceError('RGB invoice has no proxy transport endpoint')
      const rollback = snapshotState(state)
      pending.delivery = { completed, endpoints }
      await this.persistWithRecoveryRollback(rollback)
    }
    if (pending.burnSplit) return this.advanceBurnSplitDelivery(transferId, pending)
    if (pending.request.burn) return this.advanceBurnDelivery(transferId, pending)
    return this.advancePendingDelivery(transferId, pending)
  }

  /** Broadcast an internal self-transfer and expose both exact split allocations locally. */
  private async advanceBurnSplitDelivery(
    transferId: string,
    pending: RgbPendingTransfer
  ): Promise<RgbCompletedTransfer> {
    const delivery = pending.delivery
    if (!delivery || !pending.burnSplit)
      throw new RgbServiceError('BFA burn allocation split is not signed')
    delete delivery.broadcastError
    let broadcastTxid: string
    try {
      broadcastTxid = await this.dependencies.broadcaster.broadcast(delivery.completed.rawTx)
    } catch (error) {
      if (!isDuplicateBitcoinBroadcastError(error)) {
        delivery.broadcastError = error instanceof Error ? error.message : String(error)
        await this.persist({ waitForRecovery: true })
        throw error
      }
      broadcastTxid = delivery.completed.txid
    }
    if (broadcastTxid !== delivery.completed.txid)
      throw new RgbServiceError('Broadcast transaction ID does not match the BFA burn split')
    return this.finalizeBurnSplit(transferId, pending)
  }

  private async finalizeBurnSplit(
    transferId: string,
    pending: RgbPendingTransfer
  ): Promise<RgbCompletedTransfer> {
    const state = this.requireState()
    const completed = pending.delivery?.completed
    if (!completed || !pending.burnSplit)
      throw new RgbServiceError('BFA burn allocation split is not signed')
    this.applyFundingUpdate(completed, { createdSpendable: true })
    await this.retainCompletedLocalHistory(completed)
    state.pendingUtxoSync = {
      txid: completed.txid,
      outpoints: state.snapshot.utxos,
    }
    delete state.pending[transferId]
    await this.persist({ waitForRecovery: true })
    return completed
  }

  private async observeBurnSplitBroadcast(transferId: string, pending: RgbPendingTransfer) {
    const completed = pending.delivery?.completed
    const getTransactionStatus = this.dependencies.stateSource.getTransactionStatus
    if (!completed || !pending.burnSplit || !getTransactionStatus) return false
    let chain: Awaited<ReturnType<NonNullable<typeof getTransactionStatus>>>
    try {
      chain = await getTransactionStatus(this.requireState().wallet, completed.txid)
    } catch {
      return false
    }
    if (chain.status !== 'mempool' && chain.status !== 'confirmed') return false
    // Do not swallow checkpoint failures after the transaction was observed.
    await this.finalizeBurnSplit(transferId, pending)
    return true
  }

  /** Broadcast a receiver-accepted wallet send only after the sender requests it. */
  async broadcastPendingSend(transferId: string) {
    return this.runPendingTransferOperation(transferId, async () => {
      const pending = this.requireState().pending[transferId]
      if (
        !(pending?.delivery?.acknowledgedAt || pending?.delivery?.donationReadyAt || pending?.request.burn || pending?.burnSplit) ||
        pending.delivery.externalBroadcast ||
        pending.delivery.requiresCounterpartySignature
      ) {
        throw new RgbServiceError('RGB transfer is not ready for sender broadcast')
      }
      if (pending.burnSplit) return this.advanceBurnSplitDelivery(transferId, pending)
      if (pending.request.burn) return this.advanceBurnDelivery(transferId, pending)
      if (await this.observePendingDeliveryBroadcast(pending)) {
        return this.syncBroadcastedTransfer(transferId, pending)
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
      if (!pending.delivery?.broadcastError || pending.broadcast || pending.request.burn || pending.burnSplit) continue
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
    if (!delivery?.broadcastError || !report || pending.request.burn || pending.burnSplit) return
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
    if (!pending) {
      const history = state.pendingSendHistory?.find(item => item.transferId === transferId)
      return history?.status === 'broadcasted'
        ? { aborted: false, reason: 'already_broadcast' as const }
        : { aborted: false, reason: 'transfer_not_found' as const }
    }
    // Allow cancel until the Bitcoin transaction is broadcast. Consignment
    // delivery alone is still off-chain and can be discarded by the sender.
    // An acknowledged consignment is committed to the receiver and is about
    // to be broadcast. It is no longer safe to signal cancellation, including
    // while the broadcast request itself is in flight.
    if (pending.broadcast) return { aborted: false, reason: 'already_broadcast' as const }
    if (pending.burnSplit && await this.observeBurnSplitBroadcast(transferId, pending)) {
      return { aborted: false, reason: 'already_broadcast' as const }
    }
    if (!pending.burnSplit && pending.delivery && await this.observePendingDeliveryBroadcast(pending)) {
      await this.syncBroadcastedTransfer(transferId, pending)
      return { aborted: false, reason: 'already_broadcast' as const }
    }
    if (pending.delivery?.acknowledgedAt && !allowAcknowledged)
      return { aborted: false, reason: 'acknowledged_requires_agreement' as const }
    if (pending.request.donation && pending.delivery?.publishedAt)
      return { aborted: false, reason: 'donation_already_published' as const }
    if (allowAcknowledged && !pending.delivery)
      return { aborted: false, reason: 'delivery_not_found' as const }

    // V1 must clear the unreleased signed transaction before its local inputs
    // can be reused. Legacy transport retains its best-effort cancel signal.
    if (!pending.request.burn && !pending.burnSplit &&
      !pending.delivery?.acknowledgedAt && pending.delivery) {
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
      (!pending.providerOrigin || pending.request.burn || Boolean(pending.burnSplit))
    if (!discardUnsigned && !pending.burnSplit) {
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

  private applyFundingUpdate(
    completed: RgbCompletedTransfer,
    options: { createdSpendable?: boolean } = {}
  ) {
    const update = completed.fundingUpdate
    if (!update) return
    const state = this.requireState()
    const spent = new Set(
      update.spentOutpoints.map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
    )
    state.snapshot.utxos = state.snapshot.utxos.filter(utxo => !spent.has(outpointKey(utxo)))
    const createdUtxos = update.createdUtxos || (update.createdUtxo ? [update.createdUtxo] : [])
    for (const createdUtxo of createdUtxos) {
      if (state.snapshot.utxos.some(utxo => outpointKey(utxo) === outpointKey(createdUtxo))) continue
      // The change output is known locally after broadcast, but Bitcoin has
      // not confirmed it yet. Keep it visible as pending until the backend
      // snapshot verifies the output on-chain.
      state.snapshot.utxos.push({
        ...createdUtxo,
        chainStatus: 'mempool',
        confirmations: 0,
        allocations: createdUtxo.allocations.map(allocation => ({
          ...allocation,
          settled: options.createdSpendable === true,
          spendable: options.createdSpendable === true,
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
    if (pending.request.burn) {
      try {
        await this.dependencies.onBurnBroadcasted?.({
          wallet: state.wallet,
          txid: broadcast.completed.txid,
          assetId: pending.request.assetId,
          amount: pending.request.amount,
          destinationChainId: pending.request.burnDestination?.destinationChainId ?? 42161,
          recipient: pending.request.burnDestination?.recipient
            ?? pending.request.burnReason?.slice(-40).toLowerCase()
            ?? '',
          createdAt: pending.createdAt,
        })
      } catch {
        // Audit reporting must not turn an already-broadcast irreversible burn into a UI failure.
      }
    }
    // The transport already has the consignment. Queue only payload-free
    // indexing metadata; backend availability cannot undo a Bitcoin broadcast.
    if (!pending.request.burn) {
      const completed = broadcast.completed
      const payloadFreeCompleted: RgbCompletedTransfer = {
        ...completed,
        rawTx: '',
        consignments: completed.consignments.map(consignment => ({ ...consignment, payload: '' })),
        ...(completed.fundingUpdate
          ? { fundingUpdate: { spentOutpoints: completed.fundingUpdate.spentOutpoints } }
          : {}),
      }
      const outbox = state.pendingBroadcastSyncs ||= {}
      outbox[transferId] = {
        completed: payloadFreeCompleted,
        assetId: pending.request.assetId,
        amount: pending.request.amount,
        createdAt: pending.createdAt,
        invoice: pending.request.invoice,
      }
    }
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
    void this.flushBroadcastSyncOutbox(transferId)
    return broadcast.completed
  }

  /** Deliver payload-free indexing metadata without holding transfer completion hostage. */
  private async flushBroadcastSyncOutbox(onlyTransferId?: string) {
    const state = this.requireState()
    const syncBroadcast = this.dependencies.stateSource.syncBroadcast
    if (!syncBroadcast || !state.pendingBroadcastSyncs) return
    const entries = Object.entries(state.pendingBroadcastSyncs)
      .filter(([transferId]) => !onlyTransferId || transferId === onlyTransferId)
    for (const [transferId, item] of entries) {
      try {
        await this.syncPendingHistoryFragments()
        await syncBroadcast(
          state.wallet,
          transferId,
          item.completed,
          this.withCanonicalHistoryRefs(state.snapshot),
          {
            assetId: item.assetId,
            amount: item.amount,
            createdAt: item.createdAt,
            invoice: item.invoice,
          }
        )
        delete state.pendingBroadcastSyncs[transferId]
        if (Object.keys(state.pendingBroadcastSyncs).length === 0)
          state.pendingBroadcastSyncs = undefined
        await this.persist({ skipRecovery: true })
      } catch {
        // Retain the durable job for the next background sync.
      }
    }
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
      ...(delivery.completed.consignments.length > 1 ? { batch: true } : {}),
      ...(pending.request.donation ? { donation: true } : {}),
      ...(invoice.proxyInvoiceId ? {
        proxyInvoiceId: invoice.proxyInvoiceId,
        proxyRecipientPublicKey: invoice.proxyPublicKey,
        proxySenderPrivateKey: pending.proxySenderPrivateKey,
        proxyEncryption: invoice.encryption,
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
      if (isDuplicateBitcoinBroadcastError(error)) {
        await this.adoptPendingDeliveryBroadcast(pending)
        return this.syncBroadcastedTransfer(transferId, pending)
      }
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
      ...(delivery.completed.consignments.length > 1 ? { batch: true } : {}),
      ...(pending.request.donation ? { donation: true } : {}),
      ...(invoice.proxyInvoiceId ? {
        proxyInvoiceId: invoice.proxyInvoiceId,
        proxyRecipientPublicKey: invoice.proxyPublicKey,
        proxySenderPrivateKey: pending.proxySenderPrivateKey,
        proxyEncryption: invoice.encryption,
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
          if (isNonRetryableTransportError(error)) {
            delivery.publishError = error instanceof Error ? error.message : String(error)
            await this.persist({ skipRecovery: true })
          }
          throw error
        }
      }
      if (!delivery.publishedAt) {
        delete delivery.publishError
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
      if (isDuplicateBitcoinBroadcastError(error)) {
        await this.adoptPendingDeliveryBroadcast(pending)
        return this.syncBroadcastedTransfer(transferId, pending)
      }
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
    await this.adoptPendingDeliveryBroadcast(pending)
    return this.syncBroadcastedTransfer(transferId, pending)
  }

  /** Move an externally observed transaction into the same durable state as a local broadcast. */
  private async adoptPendingDeliveryBroadcast(pending: RgbPendingTransfer) {
    const delivery = pending.delivery
    if (!delivery) return false
    this.applyFundingUpdate(delivery.completed)
    await this.retainCompletedLocalHistory(delivery.completed)
    this.recordBurnProof(pending, delivery.completed)
    pending.broadcast = { completed: delivery.completed, broadcastAt: this.now() }
    delete pending.delivery
    await this.persist({ waitForRecovery: true })
    return true
  }

  /** Detect a receiver-first Proxy v1 broadcast before offering sender broadcast actions. */
  private async observePendingDeliveryBroadcast(pending: RgbPendingTransfer) {
    const delivery = pending.delivery
    const getTransactionStatus = this.dependencies.stateSource.getTransactionStatus
    if (!delivery || !getTransactionStatus) return false
    let chain: Awaited<ReturnType<NonNullable<typeof getTransactionStatus>>>
    try {
      chain = await getTransactionStatus(
        this.requireState().wallet,
        delivery.completed.txid
      )
    } catch {
      // An unavailable or stale chain source must not discard the signed transfer.
      return false
    }
    if (chain.status !== 'mempool' && chain.status !== 'confirmed') return false
    // Once observed, persistence failures must propagate. Swallowing one here
    // could leave an in-memory broadcast state that was not durably recorded.
    return this.adoptPendingDeliveryBroadcast(pending)
  }

  /**
   * A broadcaster may time out after a node already accepted the transaction.
   * Always reconcile the actual txid before retaining a lock or canceling it.
   */
  private async reconcileFailedBroadcast(
    _transferId: string,
    pending: RgbPendingTransfer
  ): Promise<'broadcasted' | 'unknown'> {
    if (await this.observePendingDeliveryBroadcast(pending)) return 'broadcasted'
    // A missing txid or policy rejection is not proof that these signed bytes
    // can never be mined. Admin review handles terminal conflicts.
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
    // Poll the durable list, including expired entries. A sender may have
    // uploaded before expiration while this wallet was offline, and cleanup
    // must observe that payload before releasing the invoice.
    const pending = (this.requireState().pendingReceives || [])
      .filter(
        receive =>
          (!receive.rejection ||
            receive.rejection.kind === 'local_validation_reject' ||
            (receive.rejection.kind === 'local_donation_reject' &&
              !!receive.pendingValidationFailure)) &&
          ((!receive.receivedConsignment?.accepted &&
            !receive.receivedConsignment?.acknowledgementPending) ||
          !receive.receivedConsignment?.payload)
      )
      .flatMap(receive => {
        try {
          const invoice = decodeRgbInvoice(receive.invoice)
          const endpoints = invoice.transportEndpoints
          return endpoints.length
            ? [{
                recipientId: receive.proxyRecipientId || receive.recipientId,
                endpoints,
                ...(receive.proxyPrivateKey ? { proxyPrivateKey: receive.proxyPrivateKey } : {}),
                encryption: invoice.encryption,
              }]
            : []
        } catch {
          // Malformed migrated state must not block valid receives. Keep the
          // entry locally because its proxy status cannot be established.
          return []
        }
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
    if (!item.endpoint || !this.dependencies.transport.acknowledgeConsignment) return undefined
    const receive = this.getPendingReceives().find(receive =>
      (receive.proxyRecipientId || receive.recipientId) === item.recipientId
    )
    return this.dependencies.transport.acknowledgeConsignment({
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
    const previous = this.pendingReceiveOperation
    // Start immediately when the queue is idle. Besides avoiding a needless
    // microtask delay, this lets invoice creation reserve its outpoint before
    // another caller can enter the same state machine.
    const current = previous ? previous.catch(() => undefined).then(operation) : operation()
    const settled = current.then(
      () => undefined,
      () => undefined
    )
    this.pendingReceiveOperation = settled
    void settled.then(() => {
      if (this.pendingReceiveOperation === settled) this.pendingReceiveOperation = undefined
    })
    return current
  }

  private getStoredV1SchemaId(assetId: string) {
    const contract = this.requireState().contracts?.[normalizeAssetId(assetId)]
    if (!contract) return undefined
    try {
      if (contract.genesis) {
        const genesis = Buffer.from(contract.genesis, 'base64')
        if (genesis.length >= 34 && genesis[0] === 0 && genesis[1] === 0)
          return genesis.subarray(2, 34).toString('hex')
      }
      const stored = Uint8Array.from(Buffer.from(contract.consignment, 'base64'))
      const transferSchema = v1TransferSchemaId(stored)
      if (transferSchema) return transferSchema
      if (isSupportedV1ContractConsignment(stored)) {
        const body = unwrapRgbContractConsignment(stored)
        if (body.length >= 36 && body[0] === 1 && body[1] === 0 &&
          body[2] === 0 && body[3] === 0) return Buffer.from(body.slice(4, 36)).toString('hex')
      }
    } catch {
      // The encoder will report malformed local contract history precisely.
    }
    return undefined
  }

  private selectUtxos(
    assetId: string,
    amount: string,
    allowedOutpoints?: Set<string>,
    requireExact = false
  ) {
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
      .map(utxo => {
        const assetAllocations = utxo.allocations.filter(allocation =>
          allocation.assetId === assetId && allocation.settled && allocation.spendable &&
            allocation.historyAvailable !== false
        )
        return {
          utxo,
          amount: getSpendableAmount(utxo, assetId),
          // Prefer carriers already covered by the encrypted canonical DAG.
          // A replica can retain an old allocation after its receive history
          // was lost; spending a different proved carrier is safe, while
          // fabricating or ignoring the missing branch is not.
          historyBacked: assetAllocations.length > 0 && assetAllocations.every(allocation =>
            Boolean(allocation.opId) &&
            this.localHistoryCoversAllocations(assetId, [allocation.opId!])
          ),
        }
      })
      .filter(candidate => candidate.amount > 0n)
      .sort((a, b) => a.historyBacked !== b.historyBacked
        ? (a.historyBacked ? -1 : 1)
        : a.amount === b.amount
          ? outpointKey(a.utxo).localeCompare(outpointKey(b.utxo))
          : a.amount < b.amount ? -1 : 1)

    if (allowedOutpoints !== undefined) {
      const total = candidates.reduce((sum, candidate) => sum + candidate.amount, 0n)
      if (total < required) throw new RgbInsufficientBalanceError(assetId, amount)
      // Every RGB carrier already present in the Bitcoin transaction must be
      // represented in the transition; selecting only a smaller subset would
      // spend the remaining carrier without moving its RGB allocations.
      return candidates.map(candidate => candidate.utxo)
    }

    const historyBackedTotal = candidates
      .filter(candidate => candidate.historyBacked)
      .reduce((sum, candidate) => sum + candidate.amount, 0n)
    const exact = candidates.find(candidate => candidate.historyBacked && candidate.amount === required) ||
      (historyBackedTotal < required
        ? candidates.find(candidate => candidate.amount === required)
        : undefined)
    if (exact) return [exact.utxo]

    if (requireExact) {
      const total = candidates.reduce((sum, candidate) => sum + candidate.amount, 0n)
      if (total < required) throw new RgbInsufficientBalanceError(assetId, amount)
      const selected = selectExactBurnUtxos(candidates, required)
      if (selected) return selected
      throw new RgbExactBurnSelectionError(
        'Current BFA burn amount cannot be formed exactly from spendable allocations'
      )
    }

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
    const pendingLocalTxid = this.requireState().pendingUtxoSync?.txid
    const unavailable = selectedUtxos.find(utxo => {
      const status = statuses.get(outpointKey(utxo))
      // A successfully broadcast burn-split output is immediately usable by
      // its child burn. The address indexer may not expose that mempool output
      // yet, but an explicit spent/replaced response must still fail closed.
      if (utxo.chainStatus === 'mempool' && utxo.outpoint.txid === pendingLocalTxid &&
        status !== 'spent' && status !== 'replaced') return false
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

  private assertPreparedTransferGeneration(pending: RgbPendingTransfer) {
    const prepared = pending.preparedCheckpointGeneration
    const current = this.requireState().recoveryCheckpointGeneration
    if (prepared !== undefined && prepared !== current) {
      throw new RgbServiceError('RGB wallet state changed; prepare the transfer again')
    }
  }

  /** Only tasks that can be overwritten by a stale snapshot may block its refresh. */
  private hasBlockingSnapshotProtection() {
    const state = this.requireState()
    return Boolean(state.pendingIssues?.length)
  }

  private hasUnsignedPreparedTransfer() {
    return Object.values(this.requireState().pending).some(
      pending => !pending.delivery && !pending.broadcast
    )
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
      const recoveryState = recoverySnapshot(persisted)
      const reason = !options.skipRecovery
        ? 'state_change'
        : state.recoveryCheckpoint?.dirty
          ? 'retry_dirty'
          : 'retry_unverified'
      const recovery = Promise.resolve(
        this.dependencies.onStatePersisted(recoveryState, {
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
        await this.setPublishedRecoveryCheckpointGeneration(
          result && typeof result === 'object' ? result.generation : undefined,
          recoveryState.pending
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
            await this.setPublishedRecoveryCheckpointGeneration(
              result && typeof result === 'object' ? result.generation : undefined,
              recoveryState.pending
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
    return queueAssetMetadataForState(this.requireState(), assetId, metadata)
  }

  /** Recover metadata from received consignments saved before metadata indexing existed. */
  private hydrateStoredContractMetadata() {
    hydrateStoredContractMetadataState(this.requireState())
  }
}

function queueAssetMetadataForState(
  state: RgbServiceState,
  assetId: string,
  metadata: RgbPendingAssetMetadata['metadata']
) {
  const normalized = normalizeAssetId(assetId)
  const pending = state.pendingAssetMetadata || (state.pendingAssetMetadata = [])
  const existing = pending.find(item => item.assetId === normalized)
  if (existing) {
    const changed = Object.keys(metadata).some(
      key => existing.metadata[key as keyof typeof metadata] !== metadata[key as keyof typeof metadata]
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

/** Apply deterministic state upgrades to local storage and decrypted legacy checkpoints alike. */
function hydrateStoredContractMetadataState(state: RgbServiceState) {
  for (const [assetId, contract] of Object.entries(state.contracts || {})) {
    if (contract.metadata) continue
    try {
      const decoded = decodeNiaConsignment(
        Uint8Array.from(Buffer.from(contract.consignment, 'base64'))
      )
      contract.metadata = decoded.metadata
      queueAssetMetadataForState(state, assetId, decoded.metadata)
    } catch {
      // Locally stored contract placeholders may not be complete NIA consignments.
    }
  }
}

/** Remove outbox entries whose payload is already recoverable from durable contract data. */
function canonicalizeRecoveryComparisonState(state: RgbServiceState) {
  hydrateStoredContractMetadataState(state)
  if (!state.pendingAssetMetadata) return
  state.pendingAssetMetadata = state.pendingAssetMetadata.filter(
    item => !state.contracts?.[normalizeAssetId(item.assetId)]?.metadata
  )
  if (state.pendingAssetMetadata.length === 0) state.pendingAssetMetadata = undefined
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
    syncedHistoryFragments: _syncedHistoryFragments,
    pending,
    pendingSendHistory,
    pendingBroadcastSyncs: _pendingBroadcastSyncs,
    ...snapshot
  } = state
  const {
    revision: _snapshotRevision,
    unchanged: _snapshotUnchanged,
    ...recoverableWalletSnapshot
  } = snapshot.snapshot
  return {
    ...snapshot,
    snapshot: recoverableWalletSnapshot,
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

/** Snapshot polling cursors are local freshness metadata, not wallet state. */
function comparableRecoveryState(value: unknown) {
  if (!value || typeof value !== 'object') return value
  const state = value as Record<string, unknown>
  const snapshot = state['snapshot']
  if (!snapshot || typeof snapshot !== 'object') return value
  const {
    revision: _revision,
    unchanged: _unchanged,
    ...comparableSnapshot
  } = snapshot as Record<string, unknown>
  return {
    ...state,
    snapshot: { ...comparableSnapshot, syncedAt: 0 },
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
  for (const [assetId, discarded] of Object.entries(state.discardedAssets || {})) {
    if (
      normalizeAssetId(assetId) !== assetId ||
      !discarded ||
      !/^[0-9a-f]{64}$/i.test(discarded.txid) ||
      !Number.isSafeInteger(discarded.discardedAt) ||
      discarded.discardedAt < 0 ||
      !Array.isArray(discarded.outpoints) ||
      discarded.outpoints.length === 0 ||
      discarded.outpoints.length > 65_535 ||
      discarded.outpoints.some(outpoint =>
        !/^[0-9a-f]{64}$/i.test(outpoint?.txid || '') ||
        !Number.isInteger(outpoint?.vout) ||
        outpoint.vout < 0
      )
    ) throw new RgbServiceError('RGB recovery checkpoint contains an invalid discarded asset')
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
      (issue.issuanceTxid !== undefined && !/^[0-9a-f]{64}$/i.test(issue.issuanceTxid)) ||
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

function normalizeStoredV1Payload(payload: string) {
  const original = Uint8Array.from(Buffer.from(payload, 'base64'))
  const normalized = normalizeLegacyV1Consignment(original)
  return normalized === original ||
    (normalized.length === original.length && normalized.every((byte, index) => byte === original[index]))
    ? payload
    : Buffer.from(normalized).toString('base64')
}

function normalizeStateAssetIds(state: RgbServiceState): RgbServiceState {
  if (state.witnessBlindingPolicyVersion !== 1) {
    // Only invoices already present when strict matching is first deployed may
    // recover transfers emitted by old UniSat senders with random blinding.
    // Fresh invoices are created after the state marker is set and never gain
    // this capability merely by being persisted or restored later.
    state.pendingReceives?.forEach(receive => {
      if (receive.recipientType === 'witness' && receive.proxyPrivateKey) {
        receive.allowLegacyWitnessBlinding = true
      }
    })
    state.witnessBlindingPolicyVersion = 1
  }
  state.snapshot = normalizeSnapshot(state.snapshot)
  for (const pending of Object.values(state.pending)) {
    pending.request.assetId = normalizeAssetId(pending.request.assetId)
  }
  if (state.pendingBroadcastSyncs) {
    for (const item of Object.values(state.pendingBroadcastSyncs)) {
      item.assetId = normalizeAssetId(item.assetId)
    }
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
  state.pendingReceiveHistory?.forEach(item => {
    if (!item.assetId) return
    if ((item.status === 'canceled' || item.status === 'rejected') && item.assetId.trim().toLowerCase() === 'rgb:') {
      item.assetId = ''
      return
    }
    try {
      item.assetId = normalizeAssetId(item.assetId)
    } catch {
      throw new RgbServiceError('RGB receive history contains an invalid asset ID')
    }
  })
  state.pendingSendHistory?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  state.pendingIssues?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  state.issueHistory?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  state.pendingAssetMetadata?.forEach(item => (item.assetId = normalizeAssetId(item.assetId)))
  if (state.discardedAssets) {
    state.discardedAssets = Object.fromEntries(
      Object.entries(state.discardedAssets).map(([assetId, discarded]) => [
        normalizeAssetId(assetId),
        {
          ...discarded,
          txid: discarded.txid.toLowerCase(),
          outpoints: discarded.outpoints.map(outpoint => ({
            txid: outpoint.txid.toLowerCase(),
            vout: outpoint.vout,
          })),
        },
      ])
    )
  }
  if (state.burnProofs) {
    for (const proof of Object.values(state.burnProofs)) {
      proof.assetId = normalizeAssetId(proof.assetId)
      proof.payload = normalizeStoredV1Payload(proof.payload)
    }
  }
  if (state.contracts) {
    state.contracts = Object.fromEntries(
      Object.entries(state.contracts).map(([assetId, contract]) => [
        normalizeAssetId(assetId),
        contract.history
          ? {
              ...contract,
              consignment: normalizeStoredV1Payload(contract.consignment),
              history: {
                ...contract.history,
                payload: normalizeStoredV1Payload(contract.history.payload),
                opIds: contract.history.opIds.map(opId => opId.toLowerCase()),
              },
            }
          : { ...contract, consignment: normalizeStoredV1Payload(contract.consignment) },
      ])
    )
  }
  return state
}
