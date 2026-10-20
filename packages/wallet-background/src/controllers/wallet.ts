import { tapleafHash } from 'bitcoinjs-lib/src/payments/bip341.js'
import bitcore from 'bitcore-lib'

import {
  BabylonConfigV2,
  COSMOS_CHAINS_MAP,
  CosmosChainInfo,
  CosmosKeyring,
  DelegationV2StakingState,
  assertValidCosmosMemo,
  getDelegationsV2,
} from '@unisat/babylon-service'
import { ColdWalletKeyring, KeystoneKeyring } from '@unisat/keyring-service'
import { DisplayedKeyring, Keyring, KeyringType, ToSignInput } from '@unisat/keyring-service/types'
import {
  RgbService as LocalRgbService,
  localNiaProtocolEncoder,
  type RgbNetwork,
} from '@unisat/rgb-service'
import * as txHelpers from '@unisat/tx-helpers'
import { UnspentOutput, signMessageOfBIP322Simple } from '@unisat/tx-helpers'
import {
  UTXO_DUST,
  bitcoin,
  decodeAddress,
  eccManager,
  genPsbtOfBIP322Simple,
  getAddressType,
  getSignatureFromPsbtOfBIP322Simple,
  isValidAddress,
  publicKeyToAddress,
  scriptPkToAddress,
  toPsbtNetwork,
  toXOnly,
} from '@unisat/wallet-bitcoin'
import {
  Account,
  AccountSignMethod,
  AddressTokenSummary,
  AddressUserToSignInput,
  BRC20HistoryItem,
  BUS_EVENTS,
  BUS_METHODS,
  BitcoinBalance,
  CHAINS_MAP,
  ConnectedSite,
  CosmosBalance,
  CosmosSignDataType,
  DummyTxType,
  LocalPsbtSummary,
  PlatformEnv,
  PsbtActionDetailType,
  PsbtActionInfo,
  PsbtActionType,
  PublicKeyUserToSignInput,
  RateUsStatus,
  RiskType,
  SESSION_EVENTS,
  SignMessageType,
  SignPsbtOptions,
  SignedData,
  SignedMessage,
  ToSignData,
  ToSignMessage,
  UTXO,
  WalletKeyring,
  bgI18n,
  getAccountCapabilities,
  getLockTimeInfo,
  hasOwn,
  isChangeAddressHdPath,
  isSupportedChainType,
  isKeystoneAccountHdPath,
  t,
  toRgbDisplayAmount,
} from '@unisat/wallet-shared'
import { AddressType, ChainType, NetworkType } from '@unisat/wallet-types'
import {
  contactBookService,
  keyringService,
  notificationService,
  permissionService,
  preferenceService,
  sessionService,
  walletApiService,
} from '../services'
import { getChainInfo } from '../shared/utils'
import { chainTypeToCanonicalNetwork } from '../shared/utils/deriveContextHash'
import { bgEventBus } from '../utils/eventBus'
import { getEstimateFee, psbtFromString } from '../utils/psbt-utils'

import { assertValidFeeRate, baseUtils, bnUtils, paramsUtils } from '@unisat/base-utils'
import {
  ADDRESS_TYPES,
  AddressFlagType,
  Brc20TickFilter,
  BRAND_ALIAN_TYPE_TEXT,
  KEYRING_TYPES,
  NETWORK_TYPES,
} from '@unisat/wallet-shared'
import log from 'loglevel'
import approvalService from 'src/services/approval'
import { ContactBookItem } from '../services/contactBook'
import BaseController from './base'
import { createRgbProxyTransport } from '../adapters/rgb-proxy'
import {
  isSameRgbWallet,
  RgbWalletContextChangedError,
  RgbWalletCoordinator,
  type LocalRgbServiceContext,
  type LocalRgbWallet,
} from '../rgb/RgbWalletCoordinator'
import { createRgbBackendAdapter, type RgbBackendApi } from '../rgb/RgbBackendAdapter'
import { RgbServiceRegistry } from '../rgb/RgbServiceRegistry'
import { createRgbService } from '../rgb/RgbServiceFactory'
import { RgbIndexerOutbox, toRgbIndexedUtxos } from '../rgb/RgbIndexerOutbox'
import { RgbIssueOperations } from '../rgb/RgbIssueOperations'
import {
  decryptRgbRecoveryCheckpoint,
  encryptRgbRecoveryCheckpoint,
} from '../rgb/RgbRecoveryCheckpoint'
import { createRgbBackupPackage, readRgbBackupPackage } from '../rgb/RgbBackupPackage'
import {
  createRgbHdBackupPackage,
  isRgbHdBackupPackage,
  readRgbHdBackupPackage,
} from '../rgb/RgbHdBackupPackage'
import { RgbReceiveOperations } from '../rgb/RgbReceiveOperations'
import { RgbSendOperations } from '../rgb/RgbSendOperations'
import { RgbTransferQuery, type RgbRemoteActivity } from '../rgb/RgbTransferQuery'
import {
  getRgbReceiveInvoiceStatus,
  toPublicRgbPendingReceiveInvoice,
  type RgbPendingReceiveInvoice,
} from '../rgb/rgbPresentation'

type CorruptedWalletKeyring = WalletKeyring & {
  isCorrupted: true
  corruptedReason: string
}

export type WalletKeyringWithStatus = WalletKeyring | CorruptedWalletKeyring

export type AccountAsset = {
  name: string
  symbol: string
  amount: string
  value: string
}

type RgbActivityType = 'issue' | 'send' | 'receive'

type RgbControllerPageResponse<T = unknown> = {
  total: number
  list: T[]
}

type RgbControllerBalance = {
  assetId?: string
  spendable?: string | number
  lockedAmount?: string
  [key: string]: unknown
}

type RgbControllerWriteLease = {
  deviceId: string
  leaseId: string
  fencingToken: number
  expiresAt: number
}

type RgbControllerWriteLeaseCredential = Pick<
  RgbControllerWriteLease,
  'deviceId' | 'leaseId' | 'fencingToken'
>

type RgbControllerApiService = {
  getRgbAssetList: (
    address: string,
    page: number,
    pageSize: number
  ) => Promise<RgbControllerPageResponse<RgbControllerBalance>>
  getRgbAssetBalance: (address: string, assetId: string) => Promise<RgbControllerBalance>
  syncRgbAssetMetadata: (params: {
    wallet?: RgbWalletRef & { network: string }
    lease?: RgbControllerWriteLeaseCredential
    asset: {
      assetId: string
      ticker: string
      name: string
      precision: number
      schema: string
      issuedSupply: string
      timestamp?: number
    }
  }) => Promise<void>
  saveRgbRecoveryCheckpoint: (params: {
    wallet: RgbWalletRef
    lease?: RgbControllerWriteLeaseCredential
    payload?: string
    payloadParts?: string[]
    expectedUpdatedAt?: number
    expectedRevision?: string
    kind?: 'normal' | 'replacement'
    updatedAt: number
  }) => Promise<{
    saved: boolean
    updatedAt: number
    revision?: string
    generation?: number
    kind?: 'normal' | 'replacement'
  }>
  startRgbRecoveryCheckpointUpload: (params: {
    wallet: RgbWalletRef
    lease?: RgbControllerWriteLeaseCredential
    expectedUpdatedAt?: number
    expectedRevision?: string
    kind?: 'normal' | 'replacement'
    updatedAt: number
    partCount: number
    totalLength: number
    checksum: string
  }) => Promise<{ uploadId: string }>
  uploadRgbRecoveryCheckpointPart: (params: {
    wallet: RgbWalletRef
    lease?: RgbControllerWriteLeaseCredential
    uploadId: string
    index: number
    payload: string
  }) => Promise<void>
  completeRgbRecoveryCheckpointUpload: (params: {
    wallet: RgbWalletRef
    lease?: RgbControllerWriteLeaseCredential
    uploadId: string
  }) => Promise<{
    saved: boolean
    updatedAt: number
    revision?: string
    generation?: number
    kind?: 'normal' | 'replacement'
  }>
  getRgbRecoveryCheckpointUploadStatus: (params: {
    wallet: RgbWalletRef
    uploadId: string
  }) => Promise<{
    status: 'pending' | 'publishing' | 'completed'
    saved?: boolean
    updatedAt: number
    revision?: string
    generation?: number
    kind?: 'normal' | 'replacement'
    receivedIndexes?: number[]
  }>
  getRgbRecoveryCheckpoint: (params: { wallet: RgbWalletRef }) => Promise<{
    payload?: string
    updatedAt?: number
    revision?: string
    generation?: number
    kind?: 'normal' | 'replacement'
  }>
  getRgbRecoveryCheckpointMetadata: (params: { wallet: RgbWalletRef }) => Promise<{
    exists: boolean
    updatedAt?: number
    revision?: string
    generation?: number
    kind?: 'normal' | 'replacement'
  }>
  getRgbAssetDetail: (assetId: string) => Promise<unknown>
  getRgbAssetActivity: (
    assetId: string,
    params: {
      page: number
      pageSize: number
      address?: string
      type?: RgbActivityType
    }
  ) => Promise<RgbControllerPageResponse>
  getAddressRgbActivity: (
    address: string,
    params: {
      page: number
      pageSize: number
      assetId?: string
      type?: RgbActivityType
    }
  ) => Promise<RgbControllerPageResponse>
  createBlindReceiveInvoice: (params: RgbReceiveInvoiceRequest) => Promise<unknown>
  createWitnessReceiveInvoice: (params: RgbReceiveInvoiceRequest) => Promise<unknown>
  getPendingReceiveInvoices: (
    params: RgbPendingReceiveInvoicesRequest
  ) => Promise<RgbPendingReceiveInvoicesResult>
  cancelReceiveInvoice: (
    params: RgbCancelReceiveInvoiceRequest
  ) => Promise<RgbCancelReceiveInvoiceResult>
  issueNiaAsset: (params: RgbIssueNiaRequest) => Promise<unknown>
  getPendingVanillaTxs: (params: RgbPendingVanillaTxsRequest) => Promise<RgbPendingVanillaTxsResult>
  abortVanillaTx: (params: RgbAbortVanillaTxRequest) => Promise<RgbAbortVanillaTxResult>
  getRgbAllocationSummary: (
    params: RgbAllocationSummaryRequest
  ) => Promise<RgbAllocationSummaryResult>
  syncRgbUtxos: (params: {
    address: string
    wallet?: RgbWalletRef & { network: string }
    lease?: RgbControllerWriteLeaseCredential
    txid: string
    outpoints: Array<{
      txid: string
      vout: number
      satoshis: number
      scriptPk: string
      publicKey: string
      chainStatus?: 'mempool' | 'confirmed' | 'pending_spend' | 'spent' | 'replaced' | 'unknown'
      confirmations?: number
      confirmationHeight?: number
      allocations: Array<{
        assetId: string
        amount: string
        settled: boolean
        spendable: boolean
        opId?: string
        assignmentIndex?: number
        assignmentType?: number
      }>
    }>
  }) => Promise<void>
  replaceRgbUtxos: (params: {
    address: string
    wallet?: RgbWalletRef & { network: string }
    lease?: RgbControllerWriteLeaseCredential
    txid: string
    outpoints: Array<{
      txid: string
      vout: number
      satoshis: number
      scriptPk: string
      publicKey: string
      chainStatus?: 'mempool' | 'confirmed' | 'pending_spend' | 'spent' | 'replaced' | 'unknown'
      confirmations?: number
      confirmationHeight?: number
      allocations: Array<{
        assetId: string
        amount: string
        settled: boolean
        spendable: boolean
        opId?: string
        assignmentIndex?: number
        assignmentType?: number
      }>
    }>
  }) => Promise<void>
  getRgbWalletUtxoSnapshot: (params: { wallet: RgbWalletRef; forceSync?: boolean }) => Promise<{
    utxos: Array<{
      txid: string
      vout: number
      satoshis: number
      scriptPk: string
      publicKey: string
      chainStatus?: 'mempool' | 'confirmed' | 'pending_spend' | 'spent' | 'replaced' | 'unknown'
      confirmations?: number
      confirmationHeight?: number
      allocations: Array<{
        assetId: string
        amount: string
        settled: boolean
        spendable: boolean
        opId?: string
        assignmentIndex?: number
        assignmentType?: number
      }>
    }>
    syncedAt: number
  }>
  getRgbTransactionStatus: (
    txid: string,
    params: { wallet: RgbWalletRef }
  ) => Promise<{
    status: 'mempool' | 'confirmed' | 'pending_spend' | 'spent' | 'replaced' | 'unknown'
    confirmations: number
  }>
  acquireRgbWriteLease: (params: {
    wallet: RgbWalletRef & { network: string }
    deviceId: string
    checkpointRevision?: string
    takeover?: boolean
  }) => Promise<{ leaseId: string; fencingToken: number; expiresAt: number }>
  renewRgbWriteLease: (params: {
    wallet: RgbWalletRef & { network: string }
    deviceId: string
    leaseId: string
    fencingToken: number
  }) => Promise<{ leaseId: string; fencingToken: number; expiresAt: number }>
  releaseRgbWriteLease: (params: {
    wallet: RgbWalletRef & { network: string }
    deviceId: string
    leaseId: string
    fencingToken: number
  }) => Promise<{ released: boolean }>
  getRgbWriteLeaseStatus: (params: {
    wallet: RgbWalletRef & { network: string }
    lease?: RgbControllerWriteLeaseCredential
  }) => Promise<{ available: boolean; heldByCaller: boolean; expiresAt?: number }>
  verifyRgbUtxos: (params: {
    wallet: RgbWalletRef & { network: string }
    deviceId: string
    leaseId: string
    fencingToken: number
    outpoints: Array<{ txid: string; vout: number; satoshis: number; scriptPk: string }>
  }) => Promise<{
    outpoints: Array<{
      txid: string
      vout: number
      status: 'mempool' | 'confirmed' | 'spent' | 'replaced' | 'unknown'
      confirmations: number
      confirmationHeight?: number
    }>
  }>
  getRgbConsignmentHistory: (params: {
    wallet: RgbWalletRef
    assetId: string
    allocations: Array<{
      txid: string
      vout: number
      opId: string
      assignmentIndex: number
      assignmentType: number
    }>
  }) => Promise<{
    assetId: string
    consignments: Array<{ opId: string; payload: string }>
  }>
  publishRgbConsignment: (params: {
    wallet: RgbWalletRef
    lease?: RgbControllerWriteLeaseCredential
    recipientId: string
    payload: string
    assetId: string
    opIds: string[]
    transportId?: string
  }) => Promise<void>
  claimRgbConsignments: (params: {
    wallet: RgbWalletRef
    lease?: RgbControllerWriteLeaseCredential
    recipientId: string
  }) => Promise<{ claimed: number }>
  getClaimedRgbConsignments: (params: {
    wallet: RgbWalletRef
  }) => Promise<{ consignments: Array<{ recipientId: string; payload: string }> }>
  syncRgbTransfer: (params: {
    wallet: RgbWalletRef
    lease?: RgbControllerWriteLeaseCredential
    transferId: string
    txid: string
    amount: string
    createdAt: number
    spentOutpoints: Array<{ txid: string; vout: number }>
    consignments: Array<{
      recipientId: string
      payload: string
      assetId: string
      opIds: string[]
      transportId?: string
    }>
  }) => Promise<void>
  syncRgbReceiveTransfer: (params: {
    wallet: RgbWalletRef
    lease?: RgbControllerWriteLeaseCredential
    transferId: string
    assetId: string
    amount: string
    txid: string
    createdAt: number
  }) => Promise<void>
} & Pick<RgbBackendApi, 'reportRgbBroadcastFailure' | 'getRgbBroadcastFailureStatus'>

const getRgbApiService = () => (walletApiService as unknown as { rgb: RgbControllerApiService }).rgb

const RGB_DEVICE_ID_STORAGE_KEY = 'rgb-device-id:v1'
const RGB_FEATURE_STORAGE_KEY_PREFIX = 'rgb-feature-enabled:v1'
const RGB_FEATURE_TERMS_VERSION = 'rgb-terms-v1'
const RGB_LOCAL_HISTORY_STORAGE_NAMESPACE = 'rgb-local-history-v1'
const RGB_FEE_POOL_WITHDRAWAL_HISTORY_LIMIT = 20

type RgbFeePoolWithdrawalHistoryItem = {
  txid: string
  amount: number
  destination: string
  createdAt: number
}

type RgbWalletRef = {
  walletId?: string
  fundingAddress: string
  network?: string
  transportEndpoint?: string
}

type RgbFeatureConsent = {
  enabled: true
  /** Recorded for reference; changing terms does not disable an enabled network. */
  agreementVersion?: string
  acceptedAt: number
}

type RgbReceiveInvoiceRequest = {
  wallet: RgbWalletRef
  assetId?: string
  amount?: number | string
  durationSeconds?: number
  skipSync?: boolean
  providerOrigin?: string
}

type RgbPendingReceiveInvoicesRequest = {
  wallet: RgbWalletRef
}

type RgbPendingReceiveInvoicesResult = {
  list: RgbPendingReceiveInvoice[]
  [key: string]: any
}

/**
 * The blind seal contains a bigint blinding factor and must remain local.
 * Port messages use JSON serialization, so only return invoice metadata to UI
 * and provider callers.
 */
export { toPublicRgbPendingReceiveInvoice }

type RgbCancelReceiveInvoiceRequest = {
  wallet: RgbWalletRef
  batchTransferIdx: number
  skipSync?: boolean
}

type RgbCancelReceiveInvoiceResult = {
  changed: boolean
  [key: string]: any
}

type RgbIssueNiaRequest = {
  wallet: RgbWalletRef
  orderId?: string
  ticker: string
  name: string
  precision: number
  amounts: Array<number | string>
}

type RgbCreateUtxosBeginRequest = {
  wallet: RgbWalletRef
  payment?: { address: string; satoshis: number }
  issue?: { ticker: string; name: string; amount: string; precision: number }
  upTo?: boolean
  num?: number
  size?: number
  feeRate?: number
  skipSync?: boolean
  dryRun?: boolean
}

type RgbCreateUtxosEndRequest = {
  wallet: RgbWalletRef
  signedPsbt: string
}

type RgbPendingVanillaTxsRequest = {
  wallet: RgbWalletRef
}

type RgbPendingVanillaTx = {
  txid: string
  type?: string
  [key: string]: any
}

type RgbPendingVanillaTxsResult = {
  list: RgbPendingVanillaTx[]
  [key: string]: any
}

type RgbAbortVanillaTxRequest = {
  wallet: RgbWalletRef
  txid: string
  discardUnsigned?: boolean
}

type RgbAbortVanillaTxResult = {
  aborted: boolean
  [key: string]: any
}

type RgbAllocationSummaryRequest = {
  wallet: RgbWalletRef
  skipSync?: boolean
}

type RgbAllocationSummaryResult = {
  available?: boolean
  availableAllocationCount?: number
  freeAllocationCount?: number
  colorableUtxoCount?: number
  [key: string]: any
}

type RgbSendBeginRequest = {
  wallet: RgbWalletRef
  invoice: string
  assetId: string
  amount?: number | string
  ticker?: string
  name?: string
  precision?: number
  feeRate?: number
  minConfirmations?: number
  donation?: boolean
  /** Maker-built, unsigned swap template. */
  swapPsbt?: string
  /** Trusted provider origin for a dApp-created RGB payment. */
  providerOrigin?: string
  witnessData?: {
    amountSat: number | string
    blinding?: number | string | null
  }
}

type RgbSendEndRequest = {
  wallet: RgbWalletRef
  signedPsbt: string
  transferId?: string
  skipSync?: boolean
}

type RgbSignPsbtRequest = {
  psbt: string
  toSignInputs?: ToSignInput[]
}

const RGB_ENCRYPTED_STORAGE_NAMESPACE = 'rgb-service-v1'
// Keep each JSON request safely below the common 1 MB reverse-proxy default.
const RGB_RECOVERY_PAYLOAD_PART_SIZE = 900_000

async function rgbRecoveryPayloadChecksum(payload: string) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return Buffer.from(digest).toString('hex')
}

function sameUnsignedTransaction(left: bitcoin.Psbt, right: bitcoin.Psbt) {
  return (
    left.txInputs.length === right.txInputs.length &&
    left.txOutputs.length === right.txOutputs.length &&
    left.txInputs.every((input, index) => {
      const other = right.txInputs[index]
      return Boolean(
        other &&
          input.hash.equals(other.hash) &&
          input.index === other.index &&
          input.sequence === other.sequence
      )
    }) &&
    left.txOutputs.every((output, index) => {
      const other = right.txOutputs[index]
      return Boolean(other && output.value === other.value && output.script.equals(other.script))
    })
  )
}

const RGB_FUNDING_UTXO_DUST = 330
const RGB_FEE_POOL_UTXO_SATS = 3_000
const RGB_FEE_POOL_TARGET_UTXOS = 3
/** Covers a top-up transaction with several pool outputs and a change output. */
const RGB_FEE_POOL_TOP_UP_ESTIMATED_VBYTES = 500
export const RGB_FEE_POOL_INSUFFICIENT_BTC = 'RGB_FEE_POOL_INSUFFICIENT_BTC'

type RgbFeePoolInsufficientBtcError = Error & {
  code: typeof RGB_FEE_POOL_INSUFFICIENT_BTC
  data: {
    requiredSatoshis: number
    availableSatoshis: number
    missingSatoshis: number
    topUpSatoshis: number
    estimatedFeeSatoshis: number
    feePoolUtxoCount: number
  }
}

function rgbFeePoolInsufficientBtcError(input: {
  requiredSatoshis: number
  availableSatoshis: number
  topUpSatoshis: number
  estimatedFeeSatoshis: number
  feePoolUtxoCount: number
}): RgbFeePoolInsufficientBtcError {
  const error = new Error(
    'Insufficient BTC to fund the RGB fee pool'
  ) as RgbFeePoolInsufficientBtcError
  error.code = RGB_FEE_POOL_INSUFFICIENT_BTC
  error.data = {
    ...input,
    missingSatoshis: Math.max(0, input.requiredSatoshis - input.availableSatoshis),
  }
  return error
}

function isSafeRgbFeePoolFundingUtxo(utxo: {
  inscriptions?: unknown[]
  runes?: unknown[]
  alkanes?: unknown[]
  atomicals?: unknown[]
}): boolean {
  const record = utxo
  return (
    !record.inscriptions?.length &&
    !record.runes?.length &&
    !record.alkanes?.length &&
    !record.atomicals?.length
  )
}

export function planRgbFeePoolTopUp(input: {
  targetCount: number
  minimumSatoshis: number
  availableSatoshis: number
  feeRate: number
}) {
  const estimatedFeeSatoshis = Math.ceil(input.feeRate * RGB_FEE_POOL_TOP_UP_ESTIMATED_VBYTES)
  const affordableCount = Math.max(
    0,
    Math.floor((input.availableSatoshis - estimatedFeeSatoshis) / input.minimumSatoshis)
  )
  const count = Math.min(input.targetCount, affordableCount)
  // When no output can be funded, describe the minimum viable one-UTXO pool
  // in the user-facing funding requirement.
  const requiredCount = Math.max(1, count)
  const topUpSatoshis = requiredCount * input.minimumSatoshis
  return {
    count,
    requiredSatoshis: topUpSatoshis + estimatedFeeSatoshis,
    topUpSatoshis,
    estimatedFeeSatoshis,
    feePoolUtxoCount: requiredCount,
  }
}

export const chainTypeToRgbNetwork = (chainType: ChainType): RgbNetwork => {
  const enabled = CHAINS_MAP[chainType]?.rgbProxyEndpoints?.some(endpoint => endpoint.trim())
  if (!enabled) throw new Error(`RGB is not enabled for wallet chain "${chainType}"`)

  switch (chainType) {
    case ChainType.BITCOIN_MAINNET:
      return 'mainnet'
    case ChainType.BITCOIN_TESTNET:
      return 'testnet'
    case ChainType.BITCOIN_TESTNET4:
      return 'testnet4'
    case ChainType.BITCOIN_SIGNET:
      return 'signet'
    case ChainType.FRACTAL_BITCOIN_MAINNET:
      return 'fractal-mainnet'
    case ChainType.FRACTAL_BITCOIN_TESTNET:
      return 'fractal-test'
    default:
      throw new Error(`wallet chain "${chainType}" is not supported by RGB`)
  }
}

const normalizeRgbDerivationHex = (value: unknown): string | null => {
  if (!value) return null
  if (typeof value === 'string') return value.toLowerCase()
  return Buffer.from(value as any)
    .toString('hex')
    .toLowerCase()
}

const normalizeRgbDerivationPath = (path: string) => (path.startsWith('m/') ? path : `m/${path}`)

const caculateTapLeafHash = (input: any, pubkey: Buffer) => {
  if (input.tapInternalKey && !input.tapLeafScript) {
    return []
  }
  const tapLeafHashes = (input.tapLeafScript || []).map(tapLeaf => {
    const hash = tapleafHash({
      output: tapLeaf.script,
      version: tapLeaf.leafVersion,
    })
    return Object.assign({ hash }, tapLeaf)
  })

  return tapLeafHashes.map(each => each.hash)
}

export function canDeriveAddressFromPublicKey(
  pubkey: string,
  addressType: AddressType,
  networkType: NetworkType
) {
  try {
    return Boolean(publicKeyToAddress(pubkey, addressType, networkType))
  } catch (e) {
    return false
  }
}

function assertCanCreateSigningRequest(account: Account | null | undefined) {
  if (!getAccountCapabilities(account).canCreateSigningRequest) {
    throw new Error(t('not_supported'))
  }
}

function stableRgbJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableRgbJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableRgbJson(record[key])}`)
    .join(',')}}`
}

/** Recovery diagnostics deliberately exclude invoices, consignments, keys, and signatures. */
function rgbRecoveryStateSummary(state: unknown) {
  const record = state && typeof state === 'object' ? (state as Record<string, unknown>) : {}
  const pending =
    record['pending'] && typeof record['pending'] === 'object'
      ? Object.values(record['pending'] as Record<string, unknown>)
      : []
  const pendingReceives = Array.isArray(record['pendingReceives']) ? record['pendingReceives'] : []
  const pendingAssetMetadata = Array.isArray(record['pendingAssetMetadata'])
    ? record['pendingAssetMetadata']
    : []
  const pendingReceiveHistory = Array.isArray(record['pendingReceiveHistory'])
    ? record['pendingReceiveHistory']
    : []
  const snapshot =
    record['snapshot'] && typeof record['snapshot'] === 'object'
      ? (record['snapshot'] as Record<string, unknown>)
      : {}
  return {
    pendingTransfers: pending.length,
    preparedTransfers: pending.filter(
      item => item && typeof item === 'object' && !('delivery' in item) && !('broadcast' in item)
    ).length,
    deliveredTransfers: pending.filter(
      item => item && typeof item === 'object' && 'delivery' in item
    ).length,
    broadcastTransfers: pending.filter(
      item => item && typeof item === 'object' && 'broadcast' in item
    ).length,
    pendingReceives: pendingReceives.length,
    pendingAssetMetadata: pendingAssetMetadata.length,
    pendingReceiveHistory: pendingReceiveHistory.length,
    snapshotUtxos: Array.isArray(snapshot['utxos']) ? snapshot['utxos'].length : 0,
  }
}

/** Safe field names only; recovery logs must never expose invoice or consignment contents. */
function rgbRecoveryDifferenceFields(local: unknown, remote: unknown): string[] {
  const localRecord = local && typeof local === 'object' ? (local as Record<string, unknown>) : {}
  const remoteRecord =
    remote && typeof remote === 'object' ? (remote as Record<string, unknown>) : {}
  const ignored = new Set([
    'snapshot',
    'pendingReceives',
    'pendingIssues',
    'pendingAssetMetadata',
    'pendingReceiveHistory',
    'pendingUtxoSync',
    'recoveryCheckpoint',
    'recoveryCheckpointUpdatedAt',
    'recoveryCheckpointRevision',
    'recoveryRemoteStateKnown',
    'recoveryConflict',
  ])
  return [...new Set([...Object.keys(localRecord), ...Object.keys(remoteRecord)])]
    .filter(
      key =>
        !ignored.has(key) && stableRgbJson(localRecord[key]) !== stableRgbJson(remoteRecord[key])
    )
    .sort()
}

/** Recovery section names only; never log the encrypted state contents themselves. */
function rgbRecoveryChangedSections(local: unknown, remote: unknown): string[] {
  const localRecord = local && typeof local === 'object' ? (local as Record<string, unknown>) : {}
  const remoteRecord =
    remote && typeof remote === 'object' ? (remote as Record<string, unknown>) : {}
  return [
    'snapshot',
    'pendingReceives',
    'pendingIssues',
    'pendingAssetMetadata',
    'pendingReceiveHistory',
    'pendingUtxoSync',
  ].filter(field => stableRgbJson(localRecord[field]) !== stableRgbJson(remoteRecord[field]))
}

/** Field names/counts only; never log recipient IDs, invoices or consignments. */
function rgbRecoveryInvoiceComparison(local: unknown, remote: unknown) {
  const localReceives = Array.isArray(
    (local as Record<string, unknown> | undefined)?.['pendingReceives']
  )
    ? ((local as Record<string, unknown>)['pendingReceives'] as Array<Record<string, unknown>>)
    : []
  const remoteReceives = Array.isArray(
    (remote as Record<string, unknown> | undefined)?.['pendingReceives']
  )
    ? ((remote as Record<string, unknown>)['pendingReceives'] as Array<Record<string, unknown>>)
    : []
  const recipientKey = (receive: Record<string, unknown>) =>
    typeof receive['proxyRecipientId'] === 'string'
      ? receive['proxyRecipientId']
      : typeof receive['recipientId'] === 'string'
        ? receive['recipientId']
        : undefined
  const remoteByRecipient = new Map(
    remoteReceives.flatMap(receive => {
      const key = recipientKey(receive)
      return key ? [[key, receive] as const] : []
    })
  )
  const localRecipientKeys = new Set(
    localReceives.flatMap(receive => {
      const key = recipientKey(receive)
      return key ? [key] : []
    })
  )
  const ignored = new Set(['claimedAt', 'assetMetadataIndexed'])
  let missingRecipients = 0
  let changedRecipients = 0
  const changedFields = new Set<string>()
  for (const localReceive of localReceives) {
    const key = recipientKey(localReceive)
    const remoteReceive = key ? remoteByRecipient.get(key) : undefined
    if (!remoteReceive) {
      missingRecipients++
      continue
    }
    const fields = new Set([...Object.keys(localReceive), ...Object.keys(remoteReceive)])
    const differences = [...fields].filter(
      field =>
        !ignored.has(field) &&
        stableRgbJson(localReceive[field]) !== stableRgbJson(remoteReceive[field])
    )
    if (differences.length) {
      changedRecipients++
      differences.forEach(field => changedFields.add(field))
    }
  }
  return {
    localCount: localReceives.length,
    remoteCount: remoteReceives.length,
    missingRecipients,
    remoteOnlyRecipients: [...remoteByRecipient.keys()].filter(key => !localRecipientKeys.has(key))
      .length,
    changedRecipients,
    changedFields: [...changedFields].sort(),
  }
}

function rgbRecoveryWalletTag(wallet: Pick<LocalRgbWallet, 'network' | 'fundingAddress'>) {
  return `${wallet.network}:${wallet.fundingAddress.slice(-8)}`
}

function rgbRecoveryServiceSummary(service: LocalRgbService) {
  const pendingTransfers = service.getPendingTransfers?.() || []
  const pendingReceives = service.getPendingReceives?.() || []
  return rgbRecoveryStateSummary({
    pending: Object.fromEntries(pendingTransfers.map(transfer => [transfer.id, transfer])),
    pendingReceives,
    snapshot: service.getSnapshot?.(),
  })
}

function rgbIssueActivityStatus(chainStatus?: string) {
  if (chainStatus === 'confirmed' || chainStatus === 'spent') return 'confirmed'
  if (chainStatus === 'replaced') return 'failed'
  return 'unconfirmed'
}

class RgbWalletLockedError extends Error {
  constructor() {
    super('RGB operation canceled because the wallet is locked')
    this.name = 'RgbWalletLockedError'
  }
}

function isWalletUnlocked() {
  return keyringService.memStore?.getState?.().isUnlocked !== false
}

function isRgbWalletLockCancellation(error: unknown) {
  if (error instanceof RgbWalletLockedError) return true
  if (isWalletUnlocked()) return false
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('No keyring found for the requested account') ||
    message.includes('no current account')
  )
}

function isRgbWalletContextCancellation(error: unknown) {
  return error instanceof RgbWalletContextChangedError || isRgbWalletLockCancellation(error)
}

export class WalletController extends BaseController {
  timer: any = null
  /** Server-calibrated clock used by RGB protocol timestamps and lease expiry checks. */
  private rgbClock: { serverTimeMs: number; monotonicMs: number } | undefined
  private getRgbMonotonicNow = () => globalThis.performance?.now?.() ?? Date.now()

  private getRgbNow = () =>
    this.rgbClock
      ? this.rgbClock.serverTimeMs + (this.getRgbMonotonicNow() - this.rgbClock.monotonicMs)
      : Date.now()

  private calibrateRgbClock(serverTime: number) {
    if (!Number.isSafeInteger(serverTime) || serverTime <= 0) return
    this.rgbClock = { serverTimeMs: serverTime * 1000, monotonicMs: this.getRgbMonotonicNow() }
  }

  // Pending transfer locks are intentionally in-memory. After a background
  // restart the user must explicitly reprepare; no prior transfer is broadcast.
  private readonly rgbServiceRegistry = new RgbServiceRegistry({
    getWallet: () => this.getCurrentLocalRgbWallet(),
    createService: wallet => this.createLocalRgbService(wallet),
  })
  private readonly rgbIndexerOutbox = new RgbIndexerOutbox({
    syncIssue: (issue, wallet) => this.syncRgbIssueToIndexer(issue, wallet),
    syncAssetMetadata: (item, wallet) => this.syncRgbAssetMetadataToIndexer(item, wallet),
    replaceUtxos: (sync, wallet) => this.replaceRgbUtxosInIndexer(sync, wallet),
    syncReceiveHistory: (receive, wallet) => this.syncRgbReceiveHistoryToIndexer(receive, wallet),
    warn: (message, error) => log.warn(message, error),
  })
  private readonly rgbRecoveryRestores = new Map<string, Promise<void>>()
  private readonly rgbRecoveryBackups = new Map<string, Promise<unknown>>()
  private readonly rgbHdBackupWallets = new Map<string, number>()
  private readonly rgbRecoveryVersions = new Map<
    string,
    { updatedAt?: number; revision?: string; generation?: number; kind?: 'normal' | 'replacement' }
  >()
  private readonly rgbWriteLeases = new Map<string, RgbControllerWriteLease>()
  /** Coalesce concurrent startup pollers that need the same writer lease. */
  private readonly rgbWriteLeaseEnsures = new Map<string, Promise<void>>()
  /** Last content successfully round-tripped to recovery for each funding wallet. */
  private readonly rgbRecoveryVerifiedFingerprints = new Map<string, string>()
  /** Wallet identity captured while building RGB-related Bitcoin signing requests. */
  private readonly rgbPendingBitcoinOperations = new Map<string, LocalRgbWallet>()
  private readonly rgbCoordinator = new RgbWalletCoordinator({
    getContext: () => this.getLocalRgbService(),
    getReadContext: () => this.getLocalRgbReadService(),
    syncIndexerOutbox: (service, wallet) => this.syncRgbIndexerOutbox(service, wallet),
    syncReceiveHistory: (service, wallet) => this.syncRgbReceiveHistory(service, wallet),
    tryEnsureWriteLease: (context, options) => this.tryEnsureRgbWriteLease(context, options),
    assertContext: context => this.assertActiveRgbWallet(context.wallet),
  })
  private readonly rgbTransferQuery = new RgbTransferQuery({
    // Activity rendering is read-only. It must remain available while a
    // checkpoint restore is retried or another device owns the RGB lease.
    getContext: () => this.getLocalRgbReadService(),
    syncReceiveHistory: (service, context) => this.syncRgbReceiveHistory(service, context.wallet),
    syncPendingTransfers: (service, context) => this.syncRgbPendingTransfers(service, context),
    syncReceivedAllocations: () => this.syncRgbReceivedAllocations(),
    getRemoteActivity: async (address, currentPage, pageSize) => {
      const result = await this.getAddressRgbActivity(address, currentPage, pageSize)
      return { total: result.total, list: result.list as RgbRemoteActivity[] }
    },
    warn: (message, error) => console.warn(message, error),
  })
  private readonly rgbReceiveOperations = new RgbReceiveOperations({
    getContext: () => this.getLocalRgbService(),
    getReadContext: () => this.getLocalRgbReadService(),
    ensureWriteLease: context => this.ensureRgbWriteLease(context),
    syncReceivedAllocations: () => this.syncRgbReceivedAllocations(),
    assertContext: context => this.assertActiveRgbWallet(context.wallet),
  })
  private readonly rgbIssueOperations = new RgbIssueOperations({
    // Issuance refreshes recovery explicitly before it can mutate state, so
    // opening the preflight in read mode lets a stale conflict self-heal.
    getContext: () => this.getLocalRgbReadService(),
    refreshRecovery: context => this.refreshRgbRecoveryForWrite(context),
    ensureWriteLease: context => this.ensureRgbWriteLease(context),
    syncIndexerOutbox: context => this.syncRgbIndexerOutbox(context.service, context.wallet),
    now: () => this.getRgbNow(),
    assertContext: context => this.assertActiveRgbWallet(context.wallet),
  })
  private readonly rgbSendOperations = new RgbSendOperations({
    getContext: () => this.getLocalRgbService(),
    ensureWriteLease: (context, options) => this.ensureRgbWriteLease(context, options),
    getFeeRate: async () => (await this.getFeeSummary()).list[1]?.feeRate,
    getToSignData: async ({ wallet, psbt, toSignInputs, amountDisplay, actionName }) => {
      const feeAccount = await this.getCurrentRgbFeeAccount()
      return this.getRgbToSignData({
        expectedWallet: wallet,
        psbt,
        toSignInputs,
        action: {
          name: actionName,
          description: '',
          details: [
            {
              label: 'Amount',
              type: PsbtActionDetailType.TEXT,
              value: amountDisplay,
              highlight: true,
            },
            {
              label: 'My RGB Fee Address',
              labelKey: 'my_rgb_fee_address',
              type: PsbtActionDetailType.ADDRESS,
              value: feeAccount.address,
            },
          ],
          type: PsbtActionType.CUSTOM,
        },
      })
    },
    getActiveTransferId: address => this.rgbCoordinator.getActiveTransferId(address),
    setActiveTransferId: (address, transferId) =>
      this.rgbCoordinator.setActiveTransferId(address, transferId),
    clearActiveTransferId: address => this.rgbCoordinator.clearActiveTransferId(address),
    assertContext: context => this.assertActiveRgbWallet(context.wallet),
  })

  constructor() {
    super()
    walletApiService.setRgbRequestAuthenticator?.(async request =>
      this.createRgbRequestAuthorization(request)
    )
    keyringService.on?.('lock', () => {
      void this.releaseAllRgbWriteLeases()
      this.rgbServiceRegistry.clear()
      this.rgbCoordinator.clear()
      this.rgbPendingBitcoinOperations.clear()
      this.rgbRecoveryRestores.clear()
      this.rgbRecoveryBackups.clear()
      this.rgbHdBackupWallets.clear()
      this.clearRgbRecoveryCaches()
      this.rgbWriteLeases.clear()
    })
  }

  /** Recovery-version caches are valid only while their encrypted wallet state remains open. */
  private clearRgbRecoveryCaches = () => {
    this.rgbRecoveryVersions.clear()
    this.rgbRecoveryVerifiedFingerprints.clear()
  }

  private _cacheCosmosKeyringKey: string | null = null
  private _cosmosKeyring: CosmosKeyring | null = null

  private clearCosmosKeyringCache = () => {
    this._cosmosKeyring?.destroy()
    this._cosmosKeyring = null
    this._cacheCosmosKeyringKey = null
  }

  cosmosChainInfoMap: Record<string, CosmosChainInfo> = Object.assign(
    Object.create(null),
    COSMOS_CHAINS_MAP
  )

  private backgroundInited = false

  setBackgroundInited = async (value: boolean) => {
    this.backgroundInited = value
  }
  getBackgroundInited = async () => {
    return this.backgroundInited
  }

  async init(adapters?: any): Promise<void> {
    console.log('[WalletController] Initialized')
  }

  protected override onInitialize(): Promise<void> {
    return Promise.resolve()
  }

  protected override onCleanup(): Promise<void> {
    return Promise.resolve()
  }

  getDesc = () => {
    return 'desc_test'
  }

  /* wallet */
  boot = (password: string) => keyringService.boot(password)
  isBooted = async () => keyringService.isBooted()

  getApproval = async () => {
    return approvalService.getApproval()
  }
  resolveApproval = approvalService.resolveApproval
  resolveUnlockApproval = approvalService.resolveUnlockApproval
  resolveConnectApproval = approvalService.resolveConnectApproval
  rejectApproval = approvalService.rejectApproval

  hasVault = () => keyringService.hasVault()
  verifyPassword = (password: string) => keyringService.verifyPassword(password)
  changePassword = (password: string, newPassword: string) =>
    keyringService.changePassword(password, newPassword)

  initAlianNames = async () => {
    preferenceService.changeInitAlianNameStatus()
  }

  isReady = () => {
    return true
  }

  unlock = async (password: string) => {
    const alianNameInited = preferenceService.getInitAlianNameStatus()
    const alianNames = contactBookService.listAlias()
    await keyringService.submitPassword(password)
    sessionService.broadcastEvent(SESSION_EVENTS.unlock)
    if (!alianNameInited && alianNames.length === 0) {
      this.initAlianNames()
    }

    this._resetTimeout()
  }
  isUnlocked = () => {
    return keyringService.memStore.getState().isUnlocked
  }

  lockWallet = async () => {
    this.clearCosmosKeyringCache()
    await keyringService.setLocked()
    // sessionService.broadcastEvent(SESSION_EVENTS.accountsChanged, [])
    sessionService.broadcastEvent(SESSION_EVENTS.lock)
    bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
      method: BUS_METHODS.LOCKED,
      params: {},
    })
  }

  setPopupOpen = (isOpen: boolean) => {
    preferenceService.setPopupOpen(isOpen)
  }

  getAddressBalance = async (address: string) => {
    const data = await walletApiService.bitcoin.getAddressBalance(address)
    preferenceService.updateAddressBalance(address, data)
    return data
  }

  getAddressBalanceV2 = async (address: string) => {
    const chainType = this.getChainType()
    const data = await walletApiService.bitcoin.getAddressBalanceV2(address)
    return { ...data, chainType }
  }

  getMultiAddressAssets = async (addresses: string) => {
    return walletApiService.bitcoin.getMultiAddressAssets(addresses)
  }

  findGroupAssets = (groups: { type: number; address_arr: string[]; pubkey_arr: string[] }[]) => {
    return walletApiService.bitcoin.findGroupAssets(groups)
  }

  getAddressCacheBalance = (address: string | undefined): BitcoinBalance => {
    const defaultBalance: BitcoinBalance = {
      confirm_amount: '0',
      pending_amount: '0',
      amount: '0',
      usd_value: '0',
      confirm_btc_amount: '0',
      pending_btc_amount: '0',
      btc_amount: '0',
      confirm_inscription_amount: '0',
      pending_inscription_amount: '0',
      inscription_amount: '0',
    }
    if (!address) return defaultBalance
    return preferenceService.getAddressBalance(address) || defaultBalance
  }

  getAddressHistory = async (params: { address: string; start: number; limit: number }) => {
    const data = await walletApiService.bitcoin.getAddressRecentHistory(params)
    // preferenceService.updateAddressHistory(address, data);
    // return data;
    //   todo
    return data
  }

  getAddressHistoryDetail = async (params: { address: string; txid: string }) => {
    return walletApiService.bitcoin.getAddressHistoryDetail(params)
  }

  getAddressInscriptions = async (address: string, cursor: number, size: number) => {
    const data = await walletApiService.inscriptions.getAddressInscriptions(address, cursor, size)
    return data
  }

  getAddressCacheHistory = (address: string | undefined) => {
    if (!address) return []
    return preferenceService.getAddressHistory(address)
  }

  getExternalLinkAck = () => {
    preferenceService.getExternalLinkAck()
  }

  setExternalLinkAck = ack => {
    preferenceService.setExternalLinkAck(ack)
  }

  getLocale = () => {
    return preferenceService.getLocale()
  }

  setLocale = async (locale: string) => {
    preferenceService.setLocale(locale)
    await bgI18n.changeLanguage(locale)
    bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
      method: BUS_METHODS.LOCALE_CHANGED,
      params: locale,
    })
  }

  getCurrency = () => {
    return preferenceService.getCurrency()
  }

  setCurrency = (currency: string) => {
    preferenceService.setCurrency(currency)
  }

  /* keyrings */

  clearKeyrings = () => {
    this.clearCosmosKeyringCache()
    this.clearRgbRecoveryCaches()
    return keyringService.clearKeyrings()
  }

  resetAllData = async () => {
    this.clearCosmosKeyringCache()
    this.clearRgbRecoveryCaches()
    await keyringService.resetAllData()
    await preferenceService.resetAllData()
    await permissionService.resetAllData()
    await contactBookService.resetAllData()
    await walletApiService.resetAllData()

    this._resetTimeout()
  }

  getPrivateKey = async (password: string, { pubkey, type }: { pubkey: string; type: string }) => {
    const isValidPassword = await this.verifyPassword(password)
    if (!isValidPassword) {
      throw new Error(t('password_error'))
    }
    if (type !== KeyringType.HdKeyring && type !== KeyringType.SimpleKeyring) {
      throw new Error(t('not_supported'))
    }
    const keyring = await keyringService.getKeyringForAccount(pubkey, type)
    if (!keyring) return null
    const privateKey = await keyring.exportAccount(pubkey)
    const networkType = this.getNetworkType()
    const network = toPsbtNetwork(networkType)
    const hex = privateKey
    const wif = eccManager.eccPair
      .fromPrivateKey(Buffer.from(privateKey, 'hex'), { network })
      .toWIF()
    return {
      hex,
      wif,
    }
  }

  getMnemonics = async (password: string, keyring: WalletKeyring) => {
    const isValidPassword = await this.verifyPassword(password)
    if (!isValidPassword) {
      throw new Error(t('password_error'))
    }
    return keyringService.getKeyringRecoveryData(keyring.index)
  }

  createKeyringWithPrivateKey = async (
    data: string,
    addressType: AddressType,
    alianName?: string,
    compressed?: boolean
  ) => {
    let originKeyring: Keyring
    try {
      originKeyring = await keyringService.importPrivateKey(data, addressType, compressed)
    } catch (e) {
      log.error(e)
      throw e
    }

    const displayedKeyring = await keyringService.displayForKeyring(
      originKeyring,
      addressType,
      keyringService.keyrings.length - 1
    )
    const keyring = this.displayedKeyringToWalletKeyring(
      displayedKeyring,
      keyringService.keyrings.length - 1
    )
    await this.changeKeyring(keyring)

    preferenceService.setShowSafeNotice(true)
  }

  generatePreMnemonic = async (strength: 128 | 256 = 128) => {
    return await keyringService.generatePreMnemonic(strength)
  }
  removePreMnemonics = () => keyringService.removePreMnemonics()
  createKeyringWithMnemonics = async (
    mnemonic: string,
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount: number,
    accountIndexDerivation = false
  ) => {
    const originKeyring = await keyringService.createKeyringWithMnemonics(
      mnemonic,
      hdPath,
      passphrase,
      addressType,
      accountCount,
      accountIndexDerivation
    )
    keyringService.removePreMnemonics()

    const displayedKeyring = await keyringService.displayForKeyring(
      originKeyring,
      addressType,
      keyringService.keyrings.length - 1
    )
    const keyring = this.displayedKeyringToWalletKeyring(
      displayedKeyring,
      keyringService.keyrings.length - 1
    )

    await this.changeKeyring(keyring)

    preferenceService.setShowSafeNotice(true)
  }

  createKeyringWithPreMnemonic = async (
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount: number,
    accountIndexDerivation = false
  ) => {
    const originKeyring = await keyringService.createKeyringWithPreMnemonic(
      hdPath,
      passphrase,
      addressType,
      accountCount,
      accountIndexDerivation
    )
    keyringService.removePreMnemonics()

    const displayedKeyring = await keyringService.displayForKeyring(
      originKeyring,
      addressType,
      keyringService.keyrings.length - 1
    )
    const keyring = this.displayedKeyringToWalletKeyring(
      displayedKeyring,
      keyringService.keyrings.length - 1
    )

    await this.changeKeyring(keyring)

    preferenceService.setShowSafeNotice(true)
  }

  createTmpKeyringWithMnemonics = async (
    mnemonic: string,
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount = 1,
    accountIndexDerivation = false
  ) => {
    const activeIndexes: number[] = []
    for (let i = 0; i < accountCount; i++) {
      activeIndexes.push(i)
    }
    const originKeyring = keyringService.createTmpKeyring('HD Key Tree', {
      mnemonic,
      activeIndexes,
      hdPath,
      passphrase,
      accountIndexDerivation,
    })
    const displayedKeyring = await keyringService.displayForKeyring(originKeyring, addressType, -1)
    return this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
  }

  createTmpKeyringWithPreMnemonic = async (
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount = 1,
    accountIndexDerivation = false
  ) => {
    const originKeyring = await keyringService.createTmpKeyringWithPreMnemonic(
      hdPath,
      passphrase,
      addressType,
      accountCount,
      accountIndexDerivation
    )
    const displayedKeyring = await keyringService.displayForKeyring(originKeyring, addressType, -1)
    originKeyring.clearRecoveryData?.()
    return this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
  }

  createTmpKeyringWithMnemonics2 = async (
    mnemonic: string,
    passphrase: string,
    hdPaths: string[],
    addressTypes: AddressType[]
  ) => {
    const keyrings: WalletKeyring[] = []
    const activeIndexes: number[] = [0]
    let originKeyring
    for (let i = 0; i < hdPaths.length; i++) {
      if (!originKeyring) {
        originKeyring = await keyringService.createTmpKeyring('HD Key Tree', {
          mnemonic,
          activeIndexes,
          hdPath: hdPaths[0],
          passphrase,
        })
      }
      originKeyring.changeHdPath(hdPaths[i])
      const displayedKeyring = await keyringService.displayForKeyring(
        originKeyring,
        addressTypes[i]!,
        -1
      )
      const keyring = this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
      keyrings.push(keyring)
    }
    return keyrings
  }

  createTmpKeyringWithMnemonicsScan = async (
    mnemonic: string,
    hdPath: string,
    passphrase: string,
    addressType: AddressType,
    accountCount = 1,
    accountIndexDerivation = false
  ) => {
    const activeIndexes: number[] = []
    for (let i = 0; i < accountCount; i++) {
      activeIndexes.push(i)
    }
    const originKeyring = await keyringService.createTmpKeyring('HD Key Tree', {
      mnemonic,
      activeIndexes,
      hdPath,
      passphrase,
      accountIndexDerivation,
    })
    const displayedKeyring = await keyringService.displayForKeyring(originKeyring, addressType, -1)
    return this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
  }

  createTmpKeyringWithPrivateKey = async (
    privateKey: string,
    addressType: AddressType,
    compressed?: boolean
  ) => {
    const originKeyring = keyringService.createTmpKeyring(KeyringType.SimpleKeyring, [
      compressed === undefined ? privateKey : { privateKey, compressed },
    ])
    const displayedKeyring = await keyringService.displayForKeyring(originKeyring, addressType, -1)
    return this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
  }

  createTmpKeyringWithKeystone = async (
    urType: string,
    urCbor: string,
    addressType: AddressType,
    hdPath: string,
    accountCount: number
  ) => {
    if (hdPath !== '' && !isKeystoneAccountHdPath(hdPath) && !isChangeAddressHdPath(hdPath)) {
      throw new Error('Invalid derivation path')
    }
    const tmpKeyring = new KeystoneKeyring()
    await tmpKeyring.initFromUR(urType, urCbor)
    if (isChangeAddressHdPath(hdPath)) {
      tmpKeyring.changeChangeAddressHdPath(hdPath)
      tmpKeyring.addAccounts(accountCount)
    } else if (isKeystoneAccountHdPath(hdPath)) {
      tmpKeyring.changeHdPath(`${hdPath}/0`)
      accountCount && tmpKeyring.addAccounts(accountCount)
    } else {
      tmpKeyring.changeHdPath(ADDRESS_TYPES[addressType]!.hdPath)
      accountCount && tmpKeyring.addAccounts(accountCount)
    }

    const opts = await tmpKeyring.serialize()
    const originKeyring = keyringService.createTmpKeyring(KeyringType.KeystoneKeyring, opts)
    const displayedKeyring = await keyringService.displayForKeyring(originKeyring, addressType, -1)
    return this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
  }

  createKeyringWithKeystone = async (
    urType: string,
    urCbor: string,
    addressType: AddressType,
    hdPath: string,
    accountCount = 1,
    filterPubkey: string[] = [],
    connectionType: 'USB' | 'QR' = 'USB'
  ) => {
    const originKeyring = await keyringService.createKeyringWithKeystone(
      urType,
      urCbor,
      addressType,
      hdPath,
      accountCount,
      connectionType
    )

    if (filterPubkey !== null && filterPubkey !== undefined && filterPubkey.length > 0) {
      const accounts = await originKeyring.getAccounts()
      accounts.forEach(account => {
        if (!filterPubkey.includes(account)) {
          originKeyring.removeAccount(account)
        }
      })
    }
    const account = await originKeyring.getAccounts()
    const displayedKeyring = await keyringService.displayForKeyring(
      originKeyring,
      addressType,
      keyringService.keyrings.length - 1
    )
    const keyring = this.displayedKeyringToWalletKeyring(
      displayedKeyring,
      keyringService.keyrings.length - 1
    )
    await this.changeKeyring(keyring)
    preferenceService.setShowSafeNotice(true)
  }

  createKeyringWithColdWallet = async (
    xpub: string,
    addressType: AddressType,
    alianName?: string,
    hdPath?: string,
    accountCount = 1
  ) => {
    const accounts = await this.deriveAccountsFromXpub(xpub, addressType, hdPath, accountCount)
    const addresses = accounts.map(acc => acc.address)
    const publicKeys = accounts.map(acc => acc.pubkey)

    const coldWalletKeyring = new ColdWalletKeyring({
      xpub,
      addresses,
      connectionType: 'QR',
      hdPath: hdPath!,
      publicKeys,
    })

    const originKeyring = await keyringService.addKeyring(coldWalletKeyring, addressType)
    const displayedKeyring = await keyringService.displayForKeyring(
      originKeyring,
      addressType,
      keyringService.keyrings.length - 1
    )

    const keyring = this.displayedKeyringToWalletKeyring(
      displayedKeyring,
      keyringService.keyrings.length - 1
    )

    if (alianName) {
      this.setKeyringAlianName(keyring, alianName)
    }

    await this.changeKeyring(keyring)

    preferenceService.setShowSafeNotice(true)
    return keyring
  }

  /**
   * Derive accounts from extended public key (receive chain level only)
   * For paths like m/84'/0'/0'/0, derives m/84'/0'/0'/0/i addresses
   */
  deriveAccountsFromXpub = async (
    xpub: string,
    addressType: AddressType,
    hdPath?: string,
    accountCount = 1
  ): Promise<{ pubkey: string; address: string }[]> => {
    // Validate xpub format
    const validPrefixes = ['xpub', 'tpub', 'ypub', 'zpub']
    if (!validPrefixes.some(prefix => xpub?.startsWith(prefix))) {
      throw new Error('Invalid xpub format')
    }

    const hdPublicKey = new bitcore.HDPublicKey(xpub)
    const networkType = this.getNetworkType()
    const accounts: { pubkey: string; address: string }[] = []

    // Derive addresses: m/84'/0'/0'/0/i
    for (let i = 0; i < accountCount; i++) {
      const addressKey = hdPublicKey.deriveChild(i)
      const publicKeyHex = addressKey.publicKey.toString('hex')
      const address = publicKeyToAddress(publicKeyHex, addressType, networkType)
      accounts.push({ pubkey: publicKeyHex, address })
    }

    return accounts
  }

  removeKeyring = async (keyring: WalletKeyring) => {
    this.clearCosmosKeyringCache()
    this.clearRgbRecoveryCaches()
    await keyringService.removeKeyring(keyring.index)
    const keyrings = await this.getKeyrings()
    const nextKeyring = keyrings[keyrings.length - 1]
    if (nextKeyring && nextKeyring.accounts[0]) {
      await this.changeKeyring(nextKeyring)
      return nextKeyring
    }
    return
  }

  getKeyringByType = (type: string) => {
    return keyringService.getKeyringByType(type)
  }

  deriveNewAccountFromMnemonic = async (keyring: WalletKeyring, alianName?: string) => {
    if (keyring.type !== KeyringType.HdKeyring && keyring.type !== KeyringType.KeystoneKeyring) {
      throw new Error(t('not_supported'))
    }
    const _keyring = keyringService.keyrings[keyring.index]!
    await keyringService.addNewAccount(_keyring)

    const displayedKeyring = await keyringService.displayForKeyring(
      _keyring,
      keyring.addressType,
      keyring.index
    )
    const newKeyring = this.displayedKeyringToWalletKeyring(displayedKeyring, keyring.index)

    await this.changeKeyring(newKeyring, newKeyring.accounts.length - 1)

    if (alianName) {
      const account = preferenceService.getCurrentAccount() as Account
      preferenceService.setAccountAlianName(account.key, alianName)
      account.alianName = alianName
    }
  }

  getAccountsCount = async () => {
    const accounts = await keyringService.getAccounts()
    return accounts.filter(x => x).length
  }

  changeKeyring = async (keyring: WalletKeyringWithStatus, accountIndex = 0) => {
    if (!this.isUsableKeyring(keyring)) {
      throw new Error('Keyring is corrupted')
    }

    this.clearCosmosKeyringCache()
    preferenceService.setCurrentKeyringIndex(keyring.index)
    const account = keyring.accounts[accountIndex]!
    preferenceService.setCurrentAccount(account)
    if (account) {
      sessionService.broadcastEvent(SESSION_EVENTS.accountsChanged, [account.address])

      bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
        method: BUS_METHODS.ACCOUNTS_CHANGED,
        params: account,
      })
    }

    await walletApiService.setClientAddress(keyring.accounts[accountIndex]!.address)
  }

  getAllAddresses = async (keyring: WalletKeyring, index: number) => {
    const networkType = this.getNetworkType()
    const pubkeys = await keyringService.getAllPubkeysByDerivedIndex(keyring, index)
    const addresses = pubkeys.map(v => {
      return publicKeyToAddress(v.pubkey, v.type, networkType)
    })
    return addresses
  }

  changeAddressType = async (addressType: AddressType) => {
    const currentAccount = await this.getCurrentAccount()
    const currentKeyring = await this.getCurrentKeyring()
    if (!getAccountCapabilities(currentKeyring).canChangeAddressType) {
      throw new Error(t('not_supported'))
    }
    const currentKeyringIndex = preferenceService.getCurrentKeyringIndex()
    await keyringService.changeAddressType(currentKeyringIndex, addressType)
    const keyring = await this.getCurrentKeyring()
    if (!keyring) throw new Error('no current keyring')
    await this.changeKeyring(keyring, currentAccount?.index)
  }

  formatOptionsToSignInputs = async (_psbt: string | bitcoin.Psbt, options?: SignPsbtOptions) => {
    const account = await this.getCurrentAccount()
    if (!account) throw null
    assertCanCreateSigningRequest(account)

    let toSignInputs: ToSignInput[] = []
    if (options && options.toSignInputs) {
      // We expect userToSignInputs objects to be similar to ToSignInput interface,
      // but we allow address to be specified in addition to publicKey for convenience.
      toSignInputs = options.toSignInputs.map(input => {
        const index = Number(input.index)
        if (isNaN(index)) throw new Error('invalid index in toSignInput')

        if (
          !(input as AddressUserToSignInput).address &&
          !(input as PublicKeyUserToSignInput).publicKey
        ) {
          throw new Error('no address or public key in toSignInput')
        }

        if (
          (input as AddressUserToSignInput).address &&
          (input as AddressUserToSignInput).address != account.address
        ) {
          throw new Error('invalid address in toSignInput')
        }

        if (
          (input as PublicKeyUserToSignInput).publicKey &&
          (input as PublicKeyUserToSignInput).publicKey != account.pubkey
        ) {
          throw new Error('invalid public key in toSignInput')
        }

        const sighashTypes = input.sighashTypes?.map(Number)
        if (sighashTypes?.some(isNaN)) throw new Error('invalid sighash type in toSignInput')

        let tapLeafHashToSign: string | Buffer | undefined
        if (input.tapLeafHashToSign) {
          if (typeof input.tapLeafHashToSign !== 'string') {
            tapLeafHashToSign = Buffer.from(input.tapLeafHashToSign, 'hex')
          } else if ((input.tapLeafHashToSign as any) instanceof Uint8Array) {
            tapLeafHashToSign = Buffer.from(input.tapLeafHashToSign)
          } else {
            tapLeafHashToSign = input.tapLeafHashToSign
          }

          tapLeafHashToSign = tapLeafHashToSign.toString('hex')
        }
        return {
          index,
          publicKey: account.pubkey,
          sighashTypes,
          useTweakedSigner: input.useTweakedSigner,
          disableTweakSigner: input.disableTweakSigner,
          tapLeafHashToSign,
        } as any
      })
    } else {
      const networkType = this.getNetworkType()
      const psbtNetwork = toPsbtNetwork(networkType)

      const psbt =
        typeof _psbt === 'string'
          ? bitcoin.Psbt.fromHex(_psbt as string, { network: psbtNetwork })
          : (_psbt as bitcoin.Psbt)
      psbt.data.inputs.forEach((v, index) => {
        let script: any = null
        let value = 0
        if (v.witnessUtxo) {
          script = v.witnessUtxo.script
          value = v.witnessUtxo.value
        } else if (v.nonWitnessUtxo) {
          const tx = bitcoin.Transaction.fromBuffer(v.nonWitnessUtxo)
          const output = tx.outs[psbt.txInputs[index]!.index]!
          script = output.script
          value = output.value
        }
        const isSigned =
          v.finalScriptSig || v.finalScriptWitness || v.tapKeySig || v.partialSig || v.tapScriptSig
        if (script && !isSigned) {
          const address = scriptPkToAddress(script, networkType)
          if (account.address === address) {
            toSignInputs.push({
              index,
              publicKey: account.pubkey,
              sighashTypes: v.sighashType ? [v.sighashType] : undefined,
            })
          }
        }
      })

      if (toSignInputs.length === 0) {
        psbt.data.inputs.forEach((input, index) => {
          // if no toSignInputs, sign all inputs
          toSignInputs.push({
            index: index,
            publicKey: account.pubkey,
          })
        })
      }
    }

    return toSignInputs
  }

  formatPsbt = async (psbt: bitcoin.Psbt, toSignInputs: ToSignInput[], autoFinalized?: boolean) => {
    const account = await this.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    const keyring = await this.getCurrentKeyring()
    if (!keyring) throw new Error('no current keyring')
    const _keyring = keyringService.keyrings[keyring.index]!

    const networkType = this.getNetworkType()
    const psbtNetwork = toPsbtNetwork(networkType)

    if (!toSignInputs) {
      // Compatibility with legacy code.
      toSignInputs = await this.formatOptionsToSignInputs(psbt)
    }

    const isKeystone = keyring.type === KeyringType.KeystoneKeyring
    const isColdWallet = keyring.type === KeyringType.ColdWalletKeyring
    let bip32Derivation: any = undefined

    if (isKeystone) {
      if (!_keyring.mfp) {
        throw new Error('no mfp in keyring')
      }
      bip32Derivation = {
        masterFingerprint: Buffer.from(_keyring.mfp as string, 'hex'),
        path: `${keyring.hdPath}/${account.index}`,
        pubkey: Buffer.from(account.pubkey, 'hex'),
      }

      const chainType = this.getChainType()
      const chain = CHAINS_MAP[chainType]!

      // use the unknown keyValue to indicate FB tx in psbt for keystone
      if (chain.isFractal && account.type === KeyringType.KeystoneKeyring) {
        const keysString = 'chain'
        // use ff as the keyType in the psbt global unknown
        const key = Buffer.from('ff' + Buffer.from(keysString).toString('hex'), 'hex')

        // check if already added
        const existing =
          psbt.data.globalMap.unknownKeyVals &&
          psbt.data.globalMap.unknownKeyVals.find(ukv => {
            return ukv.key.toString('hex') === key.toString('hex')
          })
        if (existing) {
          // already added
          // ignore
        } else {
          psbt.addUnknownKeyValToGlobal({ key, value: Buffer.from(chain.unit.toLowerCase()) })
        }
      }
    }

    let willBeSignedInputCount = 0
    psbt.data.inputs.forEach((input, index) => {
      const isSigned =
        input.finalScriptSig ||
        input.finalScriptWitness ||
        input.tapKeySig ||
        input.partialSig ||
        input.tapScriptSig
      if (isSigned) {
        willBeSignedInputCount++
        return
      }

      const isToBeSigned = toSignInputs.some(v => v.index === index)
      if (!isToBeSigned) {
        return
      }
      willBeSignedInputCount++

      let isP2TR = false
      try {
        bitcoin.payments.p2tr({ output: input.witnessUtxo?.script!, network: psbtNetwork })
        isP2TR = true
      } catch (e) {
        // skip
      }

      if (isP2TR) {
        // fix p2tr input data
        let isKeyPathP2TR = false

        try {
          const originXPubkey = toXOnly(Buffer.from(account.pubkey, 'hex')).toString('hex')
          const tapInternalKey = toXOnly(Buffer.from(account.pubkey, 'hex'))
          const { output } = bitcoin.payments.p2tr({
            internalPubkey: tapInternalKey,
            network: psbtNetwork,
          })
          if (input.witnessUtxo?.script.toString('hex') == output?.toString('hex')) {
            isKeyPathP2TR = true
          }
          if (isKeyPathP2TR) {
            input.tapInternalKey = tapInternalKey
          } else {
            // only keypath p2tr can have tapInternalKey
            delete input.tapInternalKey
          }

          if (isKeyPathP2TR) {
            // keypath p2tr should be signed with origin signer
          } else {
            const isToBeSigned: any = toSignInputs.find(v => v.index === index)
            if (
              isToBeSigned.useTweakedSigner == undefined &&
              isToBeSigned.disableTweakSigner == undefined
            ) {
              if (input.tapLeafScript && input.tapLeafScript.length > 0) {
                const script = input.tapLeafScript[0]!.script.toString('hex')
                if (script.includes(originXPubkey)) {
                  // if tapLeafScript contains origin pubkey, use origin signer
                  isToBeSigned.useTweakedSigner = false
                } else {
                  // if tapLeafScript not contains origin pubkey, use tweaked signer
                  isToBeSigned.useTweakedSigner = true
                }
              } else {
                // if no tapLeafScript, use origin signer
                isToBeSigned.useTweakedSigner = false
              }
            }
          }
        } catch (e) {
          // skip
        }
      }

      if (isKeystone) {
        if (isP2TR) {
          input.tapBip32Derivation = [
            {
              ...bip32Derivation,
              pubkey: bip32Derivation.pubkey.slice(1),
              leafHashes: caculateTapLeafHash(input, bip32Derivation.pubkey),
            },
          ]
        } else {
          input.bip32Derivation = [bip32Derivation]
        }
      }
    })

    if (autoFinalized !== false && willBeSignedInputCount === psbt.inputCount) {
      autoFinalized = true
    } else {
      autoFinalized = false
    }

    return {
      psbt,
      toSignInputs,
      autoFinalized,
    }
  }

  _signPsbt = async (psbt: bitcoin.Psbt, toSignInputs: ToSignInput[], autoFinalized: boolean) => {
    const account = await this.getCurrentAccount()
    if (!account) throw new Error('no current account')
    if (getAccountCapabilities(account).signMethod !== AccountSignMethod.Local) {
      throw new Error(t('not_supported'))
    }

    const keyring = await this.getCurrentKeyring()
    if (!keyring) throw new Error('no current keyring')
    const _keyring = keyringService.keyrings[keyring.index]!

    toSignInputs.forEach(v => {
      if (v.tapLeafHashToSign) {
        v.tapLeafHashToSign = Buffer.from(v.tapLeafHashToSign as string, 'hex')
      }
    })
    psbt = await keyringService.signTransaction(_keyring, psbt, toSignInputs as any)

    if (autoFinalized) {
      try {
        toSignInputs.forEach(v => {
          // psbt.validateSignaturesOfInput(v.index, validator);
          psbt.finalizeInput(v.index)
        })
      } catch (e) {
        // ignore
      }
    }
    return psbt
  }

  // abstract wallet function
  signPsbt = async (psbt: bitcoin.Psbt, opts?: SignPsbtOptions): Promise<bitcoin.Psbt> => {
    const res = await this.formatPsbt(psbt, opts?.toSignInputs as any, opts?.autoFinalized as any)
    const signedPsbt = await this._signPsbt(res.psbt, res.toSignInputs, res.autoFinalized)
    return signedPsbt
  }

  // local sign function
  signPsbtV2 = async (toSignData: ToSignData): Promise<SignedData> => {
    const psbt = psbtFromString(toSignData.psbtHex)
    await this._signPsbt(psbt, toSignData.toSignInputs, toSignData.autoFinalized!)
    return {
      psbtHex: psbt.toHex(),
    }
  }

  signMessage = async (params: ToSignMessage): Promise<SignedMessage> => {
    if (
      typeof params.text !== 'string' ||
      params.text.length === 0 ||
      params.text.length > 10000
    ) {
      throw new Error('Invalid message length')
    }

    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    if (getAccountCapabilities(account).signMethod !== AccountSignMethod.Local) {
      throw new Error('Readonly wallet cannot sign messages')
    }

    const networkType = this.getNetworkType()
    if (params.type === SignMessageType.BIP322_SIMPLE) {
      const signature = await signMessageOfBIP322Simple({
        message: params.text,
        address: account.address,
        networkType,
        wallet: this as any,
      })
      return {
        signature,
      }
    } else {
      const signature = await keyringService.signMessage(account.pubkey, account.type, params.text)
      return {
        signature,
      }
    }
  }

  deriveContextHash = async (appName: string, context: string): Promise<string> => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    // chainTypeToCanonicalNetwork throws WalletError(UNSUPPORTED_NETWORK) for
    // unmapped chains; surface it unchanged to the dApp.
    const canonicalNetwork = chainTypeToCanonicalNetwork(preferenceService.getChainType())
    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring.deriveContextHash) {
      throw new Error('Current keyring does not support deriveContextHash')
    }
    return keyring.deriveContextHash(account.pubkey, appName, canonicalNetwork, context)
  }

  addContact = (data: ContactBookItem) => {
    contactBookService.addContact(data)
  }

  updateContact = (data: ContactBookItem) => {
    contactBookService.updateContact(data)
  }

  getContactByAddress = (address: string): ContactBookItem | undefined => {
    return contactBookService.getContactByAddress(address)
  }

  getContactByAddressAndChain = (
    address: string,
    chain: ChainType
  ): ContactBookItem | undefined => {
    return contactBookService.getContactByAddressAndChain(address, chain)
  }

  private _generateAlianName = (type: string, index: number) => {
    return `${BRAND_ALIAN_TYPE_TEXT[type]} ${index}`
  }

  removeContact = (address: string, chain?: ChainType) => {
    if (chain) {
      contactBookService.removeContact(address, chain)
    } else {
      console.warn('removeContact called without chain parameter, using old method')
      const contact = contactBookService.getContactByAddress(address)
      if (contact) {
        contactBookService.removeContact(address, contact.chain)
      }
    }
  }

  listContact = (includeAlias = true): ContactBookItem[] => {
    const list = contactBookService.listContacts()
    if (includeAlias) {
      return list
    } else {
      return list.filter(item => !item.isAlias)
    }
  }

  listContacts = (): ContactBookItem[] => {
    return contactBookService.listContacts()
  }

  saveContactsOrder = (contacts: ContactBookItem[]) => {
    return contactBookService.saveContactsOrder(contacts)
  }

  getContactsByMap = (): Record<string, ContactBookItem> => {
    return contactBookService.getContactsByMap()
  }

  getNextAlianName = (keyring: WalletKeyring) => {
    return this._generateAlianName(keyring.type, keyring.accounts.length + 1)
  }

  getHighlightWalletList = () => {
    return preferenceService.getWalletSavedList()
  }

  updateHighlightWalletList = list => {
    return preferenceService.updateWalletSavedList(list)
  }

  getAllAlianName = (): (ContactBookItem | undefined)[] => {
    return contactBookService.listAlias()
  }

  getInitAlianNameStatus = () => {
    return preferenceService.getInitAlianNameStatus()
  }

  updateInitAlianNameStatus = () => {
    preferenceService.changeInitAlianNameStatus()
  }

  getIsFirstOpen = () => {
    return preferenceService.getIsFirstOpen()
  }

  updateIsFirstOpen = () => {
    return preferenceService.updateIsFirstOpen()
  }

  reportErrors = (error: string) => {
    console.error('report not implemented')
  }

  getNetworkType = () => {
    const chainType = this.getChainType()
    if (!isSupportedChainType(chainType)) {
      preferenceService.setChainType(ChainType.BITCOIN_MAINNET)
      return CHAINS_MAP[ChainType.BITCOIN_MAINNET]!.networkType
    }
    return CHAINS_MAP[chainType]!.networkType
  }

  setNetworkType = async (networkType: NetworkType) => {
    if (networkType === NetworkType.MAINNET) {
      this.setChainType(ChainType.BITCOIN_MAINNET)
    } else {
      this.setChainType(ChainType.BITCOIN_TESTNET)
    }
  }

  getNetworkName = () => {
    const networkType = this.getNetworkType()
    return NETWORK_TYPES[networkType]!.name
  }

  getLegacyNetworkName = () => {
    const chainType = this.getChainType()
    if (
      chainType === ChainType.BITCOIN_MAINNET ||
      chainType === ChainType.BITCOIN_TESTNET ||
      chainType === ChainType.BITCOIN_TESTNET4
    ) {
      return NETWORK_TYPES[CHAINS_MAP[chainType]!.networkType]!.name
    } else {
      return 'unknown'
    }
  }

  setChainType = async (chainType: ChainType) => {
    if (!isSupportedChainType(chainType)) {
      throw new Error(`Unsupported chain type: ${String(chainType)}`)
    }
    const currentChainType = preferenceService.getChainType()
    if (currentChainType === chainType) {
      return
    }

    preferenceService.setChainType(chainType)
    await walletApiService.setEndpoint(CHAINS_MAP[chainType]!.endpoints[0]!)

    const currentAccount = await this.getCurrentAccount()
    const keyring = await this.getCurrentKeyring()
    if (!keyring) throw new Error('no current keyring')
    await this.changeKeyring(keyring, currentAccount?.index)

    const chainInfo = getChainInfo(chainType)
    sessionService.broadcastEvent(SESSION_EVENTS.chainChanged, chainInfo)

    const network = this.getLegacyNetworkName()
    sessionService.broadcastEvent(SESSION_EVENTS.networkChanged, {
      network,
    })

    bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
      method: BUS_METHODS.CHAIN_CHANGED,
      params: {
        type: chainType,
      },
    })
  }

  getChainType = () => {
    return preferenceService.getChainType()
  }

  getBTCUtxos = async () => {
    // getBTCAccount
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const utxos = await walletApiService.bitcoin.getBTCUtxos(account.address)

    const btcUtxos = utxos.map(v => {
      return {
        txid: v.txid,
        vout: v.vout,
        satoshis: v.satoshis,
        scriptPk: v.scriptPk,
        addressType: v.addressType,
        pubkey: account.pubkey,
        inscriptions: v.inscriptions,
        atomicals: [],
      }
    })
    return btcUtxos
  }

  createSendBTCPsbt = async ({
    to,
    amount,
    feeRate,
    btcUtxos,
    enableRBF = true,
    memo,
    memos,
  }: {
    to: string
    amount: number
    feeRate?: number
    btcUtxos?: UnspentOutput[]
    enableRBF?: boolean
    memo?: string
    memos?: string[]
  }): Promise<{
    psbtHex: string
    toSignInputs: ToSignInput[]
  }> => {
    if (feeRate !== undefined) assertValidFeeRate(feeRate, { supportLowFeeMode: true })
    txHelpers.assertValidBitcoinMemo(memo, memos)
    amount = paramsUtils.formatAmount(amount)

    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    const networkType = this.getNetworkType()

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos()
    }

    if (btcUtxos!.length == 0) {
      throw new Error('Insufficient balance.')
    }

    if (!isValidAddress(to, networkType)) {
      throw new Error('Invalid address.')
    }

    if (feeRate === undefined) {
      const feeSummary = await this.getFeeSummary()
      feeRate = feeSummary.list[1]?.feeRate! // use normal fee rate
    }
    feeRate = assertValidFeeRate(feeRate, { supportLowFeeMode: true })

    const { psbt, toSignInputs } = await txHelpers.sendBTC({
      btcUtxos: btcUtxos!,
      tos: [{ address: to, satoshis: amount }],
      networkType,
      changeAddress: account.address,
      feeRate: feeRate!,
      enableRBF,
      memo: memo!,
      memos: memos!,
    })

    const title = `${t('send')} ${this.getBTCUnit()}`

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
      action: {
        name: title,
        description: '',
        details: [
          {
            label: t('to'),
            value: to,
            type: PsbtActionDetailType.ADDRESS,
          },
          {
            label: t('amount'),
            value: amount,
            type: PsbtActionDetailType.SATOSHIS,
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  createSendAllBTCPsbt = async ({
    to,
    feeRate,
    btcUtxos,
    enableRBF = true,
  }: {
    to: string
    feeRate: number
    btcUtxos?: UnspentOutput[]
    enableRBF?: boolean
  }): Promise<{
    psbtHex: string
    toSignInputs: ToSignInput[]
  }> => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    const networkType = this.getNetworkType()

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos()
    }

    if (btcUtxos!.length == 0) {
      throw new Error('Insufficient balance.')
    }

    const { psbt, toSignInputs } = await txHelpers.sendAllBTC({
      btcUtxos: btcUtxos!,
      toAddress: to,
      networkType,
      feeRate,
      enableRBF,
    })

    let totalInput = 0
    btcUtxos.forEach(v => {
      totalInput += v.satoshis
    })

    const title = `${t('send')} ${this.getBTCUnit()}`
    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
      action: {
        name: title,
        description: '',
        details: [
          {
            label: t('to'),
            value: to,
            type: PsbtActionDetailType.ADDRESS,
          },
          {
            label: t('amount'),
            value: totalInput,
            type: PsbtActionDetailType.SATOSHIS,
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  createSendInscriptionPsbt = async ({
    to,
    inscriptionId,
    feeRate,
    outputValue,
    btcUtxos,
    enableRBF = true,
  }: {
    to: string
    inscriptionId: string
    feeRate?: number
    outputValue?: number
    btcUtxos?: txHelpers.UnspentOutput[]
    enableRBF?: boolean
  }): Promise<ToSignData> => {
    if (feeRate !== undefined) assertValidFeeRate(feeRate, { supportLowFeeMode: true })
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    const networkType = this.getNetworkType()

    const utxo = await walletApiService.inscriptions.getInscriptionUtxo(inscriptionId)
    if (!utxo) {
      throw new Error('UTXO not found.')
    }

    const assetUtxo = Object.assign(utxo, { pubkey: account.pubkey })

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos()
    }

    if (btcUtxos!.length == 0) {
      throw new Error('Insufficient balance.')
    }

    if (!outputValue) {
      outputValue = assetUtxo.satoshis
    }

    if (feeRate === undefined) {
      const feeSummary = await this.getFeeSummary()
      feeRate = feeSummary.list[1]?.feeRate! // use normal fee rate
    }
    feeRate = assertValidFeeRate(feeRate, { supportLowFeeMode: true })

    const { psbt, toSignInputs } = await txHelpers.sendInscription({
      assetUtxo,
      btcUtxos: btcUtxos!,
      toAddress: to,
      networkType,
      changeAddress: account.address,
      feeRate,
      enableRBF,
      outputValue: outputValue || assetUtxo.satoshis,
      enableMixed: true,
    })

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
      action: {
        name: t('send_inscription2'),
        description: '',
        details: [
          {
            label: t('to'),
            type: PsbtActionDetailType.ADDRESS,
            value: baseUtils.shortAddress(to),
          },
          {
            label: t('Approval_SpendInscription'),
            type: PsbtActionDetailType.INSCRIPTION,
            value: inscriptionId,
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  createSendMultipleInscriptionsPsbt = async ({
    to,
    inscriptionIds,
    feeRate,
    btcUtxos,
    enableRBF = true,
  }: {
    to: string
    inscriptionIds: string[]
    utxos: UTXO[]
    feeRate: number
    btcUtxos?: txHelpers.UnspentOutput[]
    enableRBF?: boolean
  }): Promise<ToSignData> => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    const networkType = this.getNetworkType()

    const inscription_utxos =
      await walletApiService.inscriptions.getInscriptionUtxos(inscriptionIds)
    if (!inscription_utxos) {
      throw new Error('UTXO not found.')
    }

    if (inscription_utxos.find(v => v.inscriptions.length > 1)) {
      throw new Error('Multiple inscriptions are mixed together. Please split them first.')
    }

    const assetUtxos = inscription_utxos.map(v => {
      return Object.assign(v, { pubkey: account.pubkey })
    })

    const toDust = txHelpers.getAddressUtxoDust(to)

    assetUtxos.forEach(v => {
      if (v.satoshis < toDust) {
        throw new Error(
          'Unable to send inscriptions to this address in batches, please send them one by one.'
        )
      }
    })

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos()
    }

    if (btcUtxos!.length == 0) {
      throw new Error('Insufficient balance.')
    }

    const { psbt, toSignInputs } = await txHelpers.sendInscriptions({
      assetUtxos,
      btcUtxos: btcUtxos!,
      toAddress: to,
      networkType,
      changeAddress: account.address,
      feeRate,
      enableRBF,
    })

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
      action: {
        name: t('send_inscription2'),
        description: '',
        details: [
          {
            label: t('to'),
            value: to,
            type: PsbtActionDetailType.ADDRESS,
          },
          {
            label: t('spending_assets'),
            value: `${inscriptionIds.length} ${t('inscription')}`,
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  createSplitInscriptionPsbt = async ({
    inscriptionId,
    feeRate,
    outputValue,
    btcUtxos,
    enableRBF = true,
  }: {
    to: string
    inscriptionId: string
    feeRate: number
    outputValue: number
    btcUtxos?: txHelpers.UnspentOutput[]
    enableRBF?: boolean
  }): Promise<ToSignData> => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    const networkType = this.getNetworkType()

    const utxo = await walletApiService.inscriptions.getInscriptionUtxo(inscriptionId)
    if (!utxo) {
      throw new Error('UTXO not found.')
    }

    const assetUtxo = Object.assign(utxo, { pubkey: account.pubkey })

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos()
    }

    const { psbt, toSignInputs, splitedCount } = await txHelpers.splitInscriptionUtxo({
      assetUtxo,
      btcUtxos: btcUtxos!,
      networkType,
      changeAddress: account.address,
      feeRate,
      enableRBF,
      outputValue,
    })

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: false,
      },
      action: {
        name: t('Split inscriptions'),
        description: '',
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  pushTx = async (txData: string) => {
    let rawtx = txData
    if (txData.startsWith('70')) {
      // psbthex
      const psbt = psbtFromString(txData)
      try {
        psbt.finalizeAllInputs()
      } catch (e) {
        // skip
      }
      rawtx = psbt.extractTransaction(true).toHex()
    }
    const txid = await walletApiService.bitcoin.pushTx(rawtx)
    return txid
  }

  getAccounts = async () => {
    const keyrings = await this.getKeyrings()
    const accounts: Account[] = keyrings.reduce<Account[]>(
      (pre, cur) => pre.concat(cur.accounts),
      []
    )
    return accounts
  }

  displayedKeyringToWalletKeyring = (
    displayedKeyring: DisplayedKeyring,
    index: number,
    initName = true
  ) => {
    const networkType = this.getNetworkType()
    const addressType = displayedKeyring.addressType
    const key = 'keyring_' + index
    const type = displayedKeyring.type
    const accounts: Account[] = []

    for (let j = 0; j < displayedKeyring.accounts.length; j++) {
      let pubkey: string
      let address: string

      if (type === KeyringType.ColdWalletKeyring) {
        // For cold wallets, we might not have pubkey, so we use the address directly
        // The account might be just an address string for cold wallets
        if (typeof displayedKeyring.accounts[j] === 'string') {
          address = displayedKeyring.accounts[j] as unknown as string
          pubkey = ''
        } else {
          const account = displayedKeyring.accounts[j] as any
          pubkey = account.pubkey || ''
          address = account.address || publicKeyToAddress(pubkey, addressType, networkType)
        }
      } else if (type === KeyringType.WatchAddressKeyring) {
        // getAccounts() returns addresses directly for WatchAddressKeyring
        const addressFromKeyring = displayedKeyring.accounts[j]!.pubkey
        pubkey = ''
        address = addressFromKeyring
      } else {
        const { pubkey: accountPubkey } = displayedKeyring.accounts[j]!
        pubkey = accountPubkey
        address = publicKeyToAddress(pubkey, addressType, networkType)
      }

      const accountKey = key + '#' + j
      const defaultName = this._generateAlianName(type, j + 1)
      const alianName = preferenceService.getAccountAlianName(accountKey, defaultName)!
      const flag = preferenceService.getAddressFlag(address)
      accounts.push({
        type,
        pubkey,
        address,
        alianName,
        index: j,
        key: accountKey,
        flag,
      })
    }
    const hdPath =
      type === KeyringType.HdKeyring || type === KeyringType.KeystoneKeyring
        ? displayedKeyring.keyring.hdPath
        : ''
    const accountIndexDerivation: boolean =
      type === KeyringType.HdKeyring
        ? (displayedKeyring.keyring.accountIndexDerivation ?? false)
        : false
    const alianName = preferenceService.getKeyringAlianName(
      key,
      initName ? `${KEYRING_TYPES[type]!.alianName} #${index + 1}` : ''
    )!
    const keyring: WalletKeyring = {
      index,
      key,
      type,
      addressType,
      accounts,
      alianName,
      hdPath,
      accountIndexDerivation,
    }
    return keyring
  }

  corruptedDisplayedKeyringToWalletKeyring = (
    displayedKeyring: DisplayedKeyring,
    index: number,
    corruptedReason: string,
    initName = true
  ): CorruptedWalletKeyring => {
    const key = 'keyring_' + index
    const type = displayedKeyring.type
    const alianName = preferenceService.getKeyringAlianName(
      key,
      initName ? `${KEYRING_TYPES[type]!.alianName} #${index + 1}` : ''
    )!

    return {
      index,
      key,
      type,
      addressType: displayedKeyring.addressType,
      accounts: [],
      alianName,
      hdPath: '',
      accountIndexDerivation: false,
      isCorrupted: true,
      corruptedReason,
    }
  }

  safeDisplayedKeyringToWalletKeyring = (
    displayedKeyring: DisplayedKeyring | undefined,
    index: number,
    initName = true
  ): WalletKeyringWithStatus | null => {
    if (!displayedKeyring || displayedKeyring.type === KeyringType.Empty) {
      return null
    }

    try {
      const keyring = this.displayedKeyringToWalletKeyring(displayedKeyring, index, initName)
      if (keyring.accounts.length === 0) {
        return this.corruptedDisplayedKeyringToWalletKeyring(
          displayedKeyring,
          index,
          'No account',
          initName
        )
      }
      return keyring
    } catch (e) {
      log.warn('[WalletController] Marking invalid keyring as corrupted', {
        index,
        type: displayedKeyring.type,
        error: e,
      })
      return this.corruptedDisplayedKeyringToWalletKeyring(
        displayedKeyring,
        index,
        'Invalid Public Key',
        initName
      )
    }
  }

  isUsableKeyring = (keyring: WalletKeyringWithStatus | null): keyring is WalletKeyring => {
    return Boolean(keyring && !('isCorrupted' in keyring && keyring.isCorrupted))
  }

  getKeyrings = async (): Promise<WalletKeyringWithStatus[]> => {
    const displayedKeyrings = await keyringService.getAllDisplayedKeyrings()
    const keyrings: WalletKeyring[] = []
    for (let index = 0; index < displayedKeyrings.length; index++) {
      const displayedKeyring = displayedKeyrings[index]!
      if (displayedKeyring.type !== KeyringType.Empty) {
        const keyring = this.safeDisplayedKeyringToWalletKeyring(
          displayedKeyring,
          displayedKeyring.index
        )
        if (keyring) {
          keyrings.push(keyring)
        }
      }
    }

    return keyrings
  }

  getTotalKeyringCount = async () => {
    const displayedKeyrings = await keyringService.getAllDisplayedKeyrings()
    return displayedKeyrings.length
  }

  getCurrentKeyring = async () => {
    let currentKeyringIndex = preferenceService.getCurrentKeyringIndex()
    const displayedKeyrings = await keyringService.getAllDisplayedKeyrings()
    if (currentKeyringIndex === undefined) {
      const currentAccount = preferenceService.getCurrentAccount()
      for (let i = 0; i < displayedKeyrings.length; i++) {
        if (displayedKeyrings[i]!.type !== currentAccount?.type) {
          continue
        }
        const found = displayedKeyrings[i]!.accounts.find(v => v.pubkey === currentAccount?.pubkey)
        if (found) {
          currentKeyringIndex = i
          break
        }
      }
      if (currentKeyringIndex === undefined) {
        currentKeyringIndex = 0
      }
    }

    let currentKeyring = this.safeDisplayedKeyringToWalletKeyring(
      displayedKeyrings[currentKeyringIndex]!,
      currentKeyringIndex
    )

    if (!this.isUsableKeyring(currentKeyring)) {
      for (let i = 0; i < displayedKeyrings.length; i++) {
        if (displayedKeyrings[i]!.type === KeyringType.Empty) {
          continue
        }

        const fallbackKeyring = this.safeDisplayedKeyringToWalletKeyring(displayedKeyrings[i]!, i)
        if (this.isUsableKeyring(fallbackKeyring)) {
          currentKeyringIndex = i
          preferenceService.setCurrentKeyringIndex(currentKeyringIndex)
          preferenceService.setCurrentAccount(fallbackKeyring.accounts[0])
          currentKeyring = fallbackKeyring
          break
        }
      }
    }

    return this.isUsableKeyring(currentKeyring) ? currentKeyring : null
  }

  getCurrentAccount = async () => {
    const currentKeyring = await this.getCurrentKeyring()
    if (!currentKeyring) return null
    const account = preferenceService.getCurrentAccount()
    let currentAccount: Account | undefined = undefined
    currentKeyring.accounts.forEach(v => {
      if (v.pubkey === account?.pubkey) {
        currentAccount = v
      }
    })
    if (!currentAccount) {
      currentAccount = currentKeyring.accounts[0]
    }
    if (currentAccount) {
      currentAccount.flag = preferenceService.getAddressFlag(currentAccount.address)
      walletApiService.setClientAddress(currentAccount.address)
    }

    return currentAccount
  }

  getEditingKeyring = async () => {
    const editingKeyringIndex = preferenceService.getEditingKeyringIndex()
    const displayedKeyrings = await keyringService.getAllDisplayedKeyrings()
    const displayedKeyring = displayedKeyrings[editingKeyringIndex]!
    return this.displayedKeyringToWalletKeyring(displayedKeyring, editingKeyringIndex)
  }

  setEditingKeyring = async (index: number) => {
    preferenceService.setEditingKeyringIndex(index)
  }

  getEditingAccount = async () => {
    const account = preferenceService.getEditingAccount()
    return account
  }

  setEditingAccount = async (account: Account) => {
    preferenceService.setEditingAccount(account as any)
  }

  queryDomainInfo = async (domain: string) => {
    const data = await walletApiService.domain.getDomainInfo(domain)
    return data
  }

  getInscriptionSummary = async () => {
    const data = await walletApiService.inscriptions.getInscriptionSummary()
    return data
  }

  getAppSummary = async () => {
    const appTab = preferenceService.getAppTab()
    try {
      const data = await walletApiService.utility.getAppSummary()
      const readTabTime = appTab.readTabTime
      data.apps.forEach(w => {
        const readAppTime = appTab.readAppTime[w.id]
        if (w.time) {
          if (Date.now() > w.time + 1000 * 60 * 60 * 24 * 7) {
            w.new = false
          } else if (readAppTime && readAppTime > w.time) {
            w.new = false
          } else {
            w.new = true
          }
        } else {
          w.new = false
        }
      })
      data.readTabTime = readTabTime
      preferenceService.setAppSummary(data)
      return data
    } catch (e) {
      console.log('getAppSummary error:', e)
      return appTab.summary
    }
  }

  readTab = async () => {
    return preferenceService.setReadTabTime(Date.now())
  }

  readApp = async (appid: number) => {
    return preferenceService.setReadAppTime(appid, Date.now())
  }

  getAddressUtxo = async (address: string) => {
    const data = await walletApiService.bitcoin.getBTCUtxos(address)
    return data
  }

  getConnectedSites = (): ConnectedSite[] => {
    const data = permissionService.getConnectedSites()
    return data
  }
  setRecentConnectedSites = async (sites: ConnectedSite[]) => {
    await permissionService.setRecentConnectedSites(sites)
  }
  getRecentConnectedSites = (): ConnectedSite[] => {
    return permissionService.getRecentConnectedSites()
  }
  getCurrentSite = (tabId: number): ConnectedSite | null => {
    const { origin, name, icon } = sessionService.getSession(tabId) || {}
    if (!origin) {
      return null
    }
    const site = permissionService.getSite(origin)
    if (site) {
      return site
    }
    return {
      origin,
      name: name!,
      icon: icon!,
      chain: ChainType.BITCOIN_MAINNET,
      isConnected: false,
      isSigned: false,
      isTop: false,
    }
  }
  getCurrentConnectedSite = (tabId: number): ConnectedSite | undefined => {
    const { origin } = sessionService.getSession(tabId) || {}
    return permissionService.getWithoutUpdate(origin!)
  }
  setSite = async (data: ConnectedSite) => {
    await permissionService.setSite(data)
    if (data.isConnected) {
      const network = this.getLegacyNetworkName()
      sessionService.broadcastEvent(
        SESSION_EVENTS.networkChanged,
        {
          network,
        },
        data.origin
      )
    }
  }
  updateConnectSite = async (origin: string, data: Partial<ConnectedSite>) => {
    await permissionService.updateConnectSite(origin, data, true)
    const network = this.getLegacyNetworkName()
    sessionService.broadcastEvent(
      SESSION_EVENTS.networkChanged,
      {
        network,
      },
      origin
    )
  }

  removeConnectedSite = async (origin: string) => {
    sessionService.broadcastEvent(SESSION_EVENTS.accountsChanged, [], origin)
    await permissionService.removeConnectedSite(origin)
  }

  setKeyringAlianName = (keyring: WalletKeyring, name: string) => {
    preferenceService.setKeyringAlianName(keyring.key, name)
    const newKeyring = Object.assign({}, keyring, { alianName: name })
    return newKeyring
  }

  setAccountAlianName = (account: Account, name: string) => {
    preferenceService.setAccountAlianName(account.key, name)
    account.alianName = name
    return account
  }

  addAddressFlag = (account: Account, flag: AddressFlagType) => {
    account.flag = preferenceService.addAddressFlag(account.address, flag)
    walletApiService.setClientAddress(account.address)
    return account
  }
  removeAddressFlag = (account: Account, flag: AddressFlagType) => {
    account.flag = preferenceService.removeAddressFlag(account.address, flag)
    walletApiService.setClientAddress(account.address)
    return account
  }

  getFeeSummary = async () => {
    return walletApiService.bitcoin.getFeeSummary()
  }

  getLowFeeSummary = async () => {
    return walletApiService.bitcoin.getLowFeeSummary()
  }

  getCoinPrice = async () => {
    return walletApiService.market.getCoinPrice()
  }

  getBrc20sPrice = async (ticks: string[]) => {
    return walletApiService.market.getBrc20sPrice(ticks)
  }

  getRunesPrice = async (ticks: string[]) => {
    return walletApiService.market.getRunesPrice(ticks)
  }

  getAlkanesPrice = async (alkaneids: string[]) => {
    return walletApiService.market.getAlkanesPrice(alkaneids)
  }

  inscribeBRC20Transfer = (
    address: string,
    tick: string,
    amount: string,
    feeRate: number,
    outputValue: number
  ) => {
    amount = paramsUtils.formatAmount(amount)

    return walletApiService.brc20.inscribeBRC20Transfer(address, tick, amount, feeRate, outputValue)
  }

  getInscribeResult = (orderId: string) => {
    return walletApiService.brc20.getInscribeResult(orderId)
  }

  decodePsbt = (psbtHex: string, website: string) => {
    return walletApiService.bitcoin.decodePsbt(psbtHex, website)
  }

  analyzeLocalPsbts = async (toSignDatas: ToSignData[]): Promise<LocalPsbtSummary> => {
    const networkType = this.getNetworkType()
    let totalFee = 0
    let totalInput = 0
    let completedCount = 0
    let hasSighashNone = false
    let hasSighashSingle = false
    let parseErrorCount = 0
    const items: LocalPsbtSummary['items'] = []

    // Fetch network fee rates once for all PSBTs
    let feeRateThresholds: txHelpers.FeeRateThresholds | undefined
    try {
      const feeSummary = await walletApiService.bitcoin.getFeeSummary()
      const rates = feeSummary.list.map(f => f.feeRate)
      if (rates.length >= 3) {
        const mid = rates[1]!
        const [low, , high] = rates as [number, number, number]
        feeRateThresholds = {
          tooLow: Math.max(1, low - 2),
          tooHigh: high + 50,
          recommended: mid,
        }
      }
    } catch (e) {
      log.warn('Failed to fetch fee summary for local PSBT analysis:', e)
    }

    // Phase 1: local decode — no network, collect outpoints + per-PSBT info
    const outpointSet = new Set<string>()
    for (const toSignData of toSignDatas) {
      try {
        const decoder = new txHelpers.PsbtDecoder({
          toSignData,
          networkType,
          ...(feeRateThresholds !== undefined ? { feeRateThresholds } : {}),
        })
        const result = await decoder.decode()

        const itemHasSighashNone = result.risks.some(r => r.type === RiskType.SIGHASH_NONE)
        if (itemHasSighashNone) hasSighashNone = true
        const itemHasSighashSingle =
          txHelpers.getSighashSingleInputIndexes(toSignData, result.inputInfos).length > 0
        if (itemHasSighashSingle) hasSighashSingle = true

        const itemTotalInput = result.inputInfos.reduce((sum, v) => sum + v.value, 0)
        if (result.isCompleted) {
          totalFee += result.fee
          totalInput += itemTotalInput
          completedCount++
        }
        for (const input of result.inputInfos) {
          outpointSet.add(`${input.txid}:${input.vout}`)
        }

        items.push({
          inputCount: result.inputInfos.length,
          outputCount: result.outputInfos.length,
          feeRate: result.feeRate,
          fee: result.fee,
          totalInput: itemTotalInput,
          isCompleted: result.isCompleted,
          hasSighashNone: itemHasSighashNone,
          hasSighashSingle: itemHasSighashSingle,
          parseError: false,
        })
      } catch (e) {
        log.error('Local PSBT analysis failed:', e)
        parseErrorCount++
        items.push({
          inputCount: 0,
          outputCount: 0,
          feeRate: '-',
          fee: 0,
          totalInput: 0,
          isCompleted: false,
          hasSighashNone: false,
          hasSighashSingle: false,
          parseError: true,
        })
      }
    }

    // Phase 2: one batch API call to check asset coverage on inputs
    let hasAssets = false
    if (outpointSet.size > 0) {
      try {
        const utxoAssets = await walletApiService.bitcoin.getUtxoAssetsByOutpoints(
          Array.from(outpointSet)
        )
        hasAssets = utxoAssets.some(
          u => u.inscriptions.length > 0 || u.runes.length > 0 || u.alkanes.length > 0
        )
      } catch (e) {
        log.warn('Failed to fetch UTXO assets for PSBT analysis:', e)
      }
    }

    return {
      totalFee,
      totalInput,
      completedCount,
      hasSighashNone,
      hasSighashSingle,
      parseErrorCount,
      hasAssets,
      items,
    }
  }

  decodeContracts = (contracts: any[], account) => {
    return walletApiService.bitcoin.decodeContracts(contracts, account)
  }

  getBRC20List = async ({
    address,
    currentPage,
    pageSize,
    tickFilter,
  }: {
    address: string
    currentPage: number
    pageSize: number
    tickFilter?: Brc20TickFilter.TICK_BYTES_4_5_6
  }) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize

    const { total, list } = await walletApiService.brc20.getBRC20List({
      address,
      cursor,
      size,
      ...(tickFilter === undefined ? {} : { tickFilter }),
    })

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAllInscriptionList = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize

    const { total, list } = await walletApiService.inscriptions.getAddressInscriptions(
      address,
      cursor,
      size
    )
    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getBRC20Summary = async ({
    address,
    ticker,
  }: {
    address: string
    ticker: string
  }): Promise<AddressTokenSummary> => {
    const tokenSummary = await walletApiService.brc20.getAddressTokenSummary({ address, ticker })
    return tokenSummary
  }

  getBRC20TransferableList = async ({
    address,
    ticker,
    tickerHex,
    currentPage,
    pageSize,
  }: {
    address: string
    ticker: string
    tickerHex: string
    currentPage: number
    pageSize: number
  }) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize

    const { total, list } = await walletApiService.brc20.getTokenTransferableList({
      address,
      ticker,
      tickerHex,
      cursor,
      size,
    })

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  expireUICachedData = async (address: string) => {
    return preferenceService.expireUICachedData(address)
  }

  getWalletConfig = async () => {
    return walletApiService.config.getWalletConfig()
  }

  getSkippedVersion = async () => {
    return preferenceService.getSkippedVersion()
  }

  setSkippedVersion = async (version: string) => {
    return preferenceService.setSkippedVersion(version)
  }

  getInscriptionUtxoDetail = async (inscriptionId: string) => {
    const utxo = await walletApiService.inscriptions.getInscriptionUtxoDetail(inscriptionId)
    if (!utxo) {
      throw new Error('UTXO not found.')
    }
    return utxo
  }

  getUtxoByInscriptionId = async (inscriptionId: string) => {
    const utxo = await walletApiService.inscriptions.getInscriptionUtxo(inscriptionId)
    if (!utxo) {
      throw new Error('UTXO not found.')
    }
    return utxo
  }

  getInscriptionInfo = async (inscriptionId: string) => {
    const utxo = await walletApiService.inscriptions.getInscriptionInfo(inscriptionId)
    if (!utxo) {
      throw new Error('Inscription not found.')
    }
    return utxo
  }

  /**
   * Check if a website is a known phishing site
   * @param website Website URL or origin to check
   * @returns Object containing check results with isScammer flag and optional warning message
   */
  checkWebsite = async (
    website: string
  ): Promise<{ isScammer: boolean; warning: string; allowQuickMultiSign?: boolean }> => {
    let isLocalPhishing = false

    // try {
    //   let hostname = ''
    //   try {
    //     hostname = new URL(website).hostname
    //   } catch (e) {
    //     hostname = website
    //   }

    //   const phishingService = await import('@/background/service/phishing')
    //   isLocalPhishing = phishingService.default.checkPhishing(hostname)
    // } catch (error) {
    //   console.error('[Phishing] Local check error:', error)
    // }

    const apiResult = await walletApiService.utility.checkWebsite(website)

    if (isLocalPhishing) {
      return {
        ...apiResult,
        isScammer: true,
      }
    }

    return apiResult
  }

  getOrdinalsInscriptions = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize

    const { total, list } = await walletApiService.inscriptions.getOrdinalsInscriptions(
      address,
      cursor,
      size
    )
    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAddressSummary = async (address: string) => {
    const data = await walletApiService.bitcoin.getAddressSummary(address)
    // preferenceService.updateAddressBalance(address, data);
    return data
  }

  getAddressAssetSummary = async (address: string) => {
    return walletApiService.bitcoin.getAddressAssetSummary(address)
  }

  getAddressAssetOverview = async (address: string) => {
    const overview = await walletApiService.bitcoin.getAddressAssetOverview(address)
    if (address !== preferenceService.getCurrentAccount()?.address) return overview

    try {
      // RGB balances belong to the local wallet, not the address indexer.
      const { list } = await this.getRGBList('', 1, Number.MAX_SAFE_INTEGER, { skipSync: true })
      const rgbItems = list.map(asset => ({
        kind: 'rgb' as const,
        tokenId: asset.assetId,
        name: asset.name || asset.ticker || 'RGB',
        symbol: asset.ticker || asset.name || 'RGB',
        logo: '',
        divisibility: asset.precision || 0,
        balance: toRgbDisplayAmount(asset.spendable || '0', asset.precision || 0),
      }))
      const knownIds = new Set(overview.list.flatMap(item => item.kind === 'rgb' ? [item.tokenId.replace(/^rgb:/i, '')] : []))
      return { ...overview, list: [...overview.list, ...rgbItems.filter(item => !knownIds.has(item.tokenId.replace(/^rgb:/i, '')))] }
    } catch (error) {
      // An unavailable or inactive RGB wallet must not hide the other assets.
      log.debug('RGB assets unavailable for address overview', error)
      return overview
    }
  }

  setPsbtSignNonSegwitEnable(psbt: bitcoin.Psbt, enabled: boolean) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore
    psbt.__CACHE.__UNSAFE_SIGN_NONSEGWIT = enabled
  }

  getShowSafeNotice = () => {
    return preferenceService.getShowSafeNotice()
  }

  setShowSafeNotice = (show: boolean) => {
    return preferenceService.setShowSafeNotice(show)
  }

  getVersionDetail = (version: string) => {
    return walletApiService.config.getVersionDetail(version)
  }

  checkKeyringMethod = async (method: string) => {
    const account = await this.getCurrentAccount()
    if (!account) throw new Error('no current account')
    const keyring = await keyringService.getKeyringForAccount(account.pubkey)
    if (!keyring) {
      throw new Error('keyring does not exist')
    }
    if (!keyring[method]) {
      throw new Error(`keyring does not have ${method} method`)
    }
    return { account, keyring }
  }

  // Keystone related functions
  // genSignPsbtUr, parseSignPsbtUr, genSignMsgUr, parseSignMsgUr, getKeystoneConnectionType
  genSignPsbtUr = async (psbtHex: string) => {
    const { keyring } = await this.checkKeyringMethod('genSignPsbtUr')
    return await keyring.genSignPsbtUr!(psbtHex)
  }

  parseSignPsbtUr = async (type: string, cbor: string, isFinalize = true) => {
    const { keyring } = await this.checkKeyringMethod('parseSignPsbtUr')
    const psbtHex = await keyring.parseSignPsbtUr!(type, cbor)
    const psbt = bitcoin.Psbt.fromHex(psbtHex)
    try {
      isFinalize && psbt.finalizeAllInputs()
    } catch (e) {
      //skip
    }
    return {
      psbtHex: psbt.toHex(),
      rawtx: isFinalize ? psbt.extractTransaction().toHex() : undefined,
    }
  }

  genSignMsgUr = async (text: string, msgType?: string) => {
    if (msgType === 'bip322-simple') {
      const account = await this.getCurrentAccount()
      if (!account) throw new Error('no current account')
      const psbt = genPsbtOfBIP322Simple({
        message: text,
        address: account.address,
        networkType: this.getNetworkType(),
      })
      const toSignData = await this.getToSignData({ psbtHex: psbt.toHex() })
      return await this.genSignPsbtUr(toSignData.psbtHex)
    }
    const { account, keyring } = await this.checkKeyringMethod('genSignMsgUr')
    return await keyring.genSignMsgUr!(account.pubkey, text)
  }

  parseSignMsgUr = async (type: string, cbor: string, msgType: string) => {
    if (msgType === 'bip322-simple') {
      const res = await this.parseSignPsbtUr(type, cbor, false)
      const psbt = bitcoin.Psbt.fromHex(res.psbtHex)
      psbt.finalizeAllInputs()
      return {
        signature: getSignatureFromPsbtOfBIP322Simple(psbt),
      }
    }
    const { keyring } = await this.checkKeyringMethod('parseSignMsgUr')
    const sig = await keyring.parseSignMsgUr!(type, cbor)
    sig.signature = Buffer.from(sig.signature, 'hex').toString('base64')

    return sig
  }

  getKeystoneConnectionType = async () => {
    if (PlatformEnv.PLATFORM === 'extension') {
      // QR | USB
      const { keyring } = await this.checkKeyringMethod('getConnectionType')
      return keyring.getConnectionType!()
    } else {
      return 'QR'
    }
  }

  getRunesList = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize
    const { total, list } = await walletApiService.runes.getRunesList(address, cursor, size)

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAssetUtxosRunes = async (runeid: string) => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    const runes_utxos = await walletApiService.runes.getRunesUtxos(account.address, runeid)

    const assetUtxos = runes_utxos.map(v => {
      return Object.assign(v, { pubkey: account.pubkey })
    }) as any

    assetUtxos.forEach(v => {
      v.inscriptions = []
    })

    assetUtxos.sort((a, b) => {
      const bAmount = b.runes.find(v => v.runeid == runeid)?.amount || '0'
      const aAmount = a.runes.find(v => v.runeid == runeid)?.amount || '0'
      return bnUtils.compareAmount(bAmount, aAmount)
    })

    return assetUtxos
  }

  getAddressRunesTokenSummary = async (address: string, runeid: string) => {
    const tokenSummary = await walletApiService.runes.getAddressRunesTokenSummary(address, runeid)
    return tokenSummary
  }

  getRgbAssetList = async (_address: string, currentPage: number, pageSize: number) => {
    await this.assertRgbEnabled()
    const { service } = await this.getLocalRgbReadService()
    const { total, list } = service.getLocalAssetList(currentPage, pageSize)
    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getRgbList = async (address: string, currentPage: number, pageSize: number) => {
    return this.getRgbAssetList(address, currentPage, pageSize)
  }

  getRGBList = async (
    _address: string,
    currentPage: number,
    pageSize: number,
    options?: { skipSync?: boolean }
  ) => {
    const { address } = await this.getRgbFundingAddress()
    const result = await this.getRgbAssetList(address, currentPage, pageSize)
    if (!options?.skipSync) {
      // Rendering must not depend on the indexer replica. Refresh its chain
      // observations in the background, so recovery or indexer timeouts do
      // not delay the encrypted local view.
      void this.syncRgbListState(result).catch(error => {
        if (isRgbWalletLockCancellation(error)) return
        log.warn('Failed to refresh RGB indexer snapshot while loading local assets', error)
      })
    }
    const lockedAmounts = await this.getRgbPendingLockedAmounts()
    return {
      ...result,
      list: result.list.map(item => this.applyRgbPendingLock(item, lockedAmounts)),
    }
  }

  getRgbAssetBalance = async (_address: string, assetId: string) => {
    await this.assertRgbEnabled()
    const { service } = await this.getLocalRgbReadService()
    return service.getLocalAssetBalance(assetId)
  }

  getRGBAssetBalance = async (_address: string, assetId: string) => {
    const { address } = await this.getRgbFundingAddress()
    const balance = await this.getRgbAssetBalance(address, assetId)
    // A token detail screen may be open without the RGB asset list. Keep its
    // pending allocation moving while a receive or change output confirms.
    if (Number(balance?.pending || 0) > 0) {
      void this.syncRgbListState().catch(error => {
        if (isRgbWalletLockCancellation(error)) return
        log.warn('Failed to refresh RGB indexer snapshot while loading asset balance', error)
      })
    }
    return balance
      ? this.applyRgbPendingLock(balance, await this.getRgbPendingLockedAmounts())
      : undefined
  }

  getRgbAssetDetail = async (assetId: string) => {
    await this.assertRgbEnabled()
    const { service } = await this.getLocalRgbReadService()
    return service.getLocalAssetDetail(assetId)
  }

  /** Export a standard RGB Contract file, encoded as base64 for the wallet RPC boundary. */
  exportRgbAssetContract = async (assetId: string): Promise<string> => {
    await this.assertRgbEnabled()
    const { service } = await this.getLocalRgbReadService()
    const contract = service.exportContractConsignment(assetId)
    return Buffer.concat([Buffer.from('RGB\0CON'), Buffer.from(contract)]).toString('base64')
  }

  getRGBAssetDetail = async (_address: string, assetId: string) => {
    const detail = await this.getRgbAssetDetail(assetId)
    // Local RGB details keep balance fields flat, while the wallet UI's
    // RgbAssetDetail contract expects a nested balance object.
    return {
      ...detail,
      balance: { ...detail },
    }
  }

  getRgbAssetActivity = async (
    assetId: string,
    currentPage: number,
    pageSize: number,
    address?: string,
    type?: RgbActivityType
  ) => {
    await this.assertRgbEnabled()
    await this.assertRgbFeatureEnabled()
    const page = currentPage
    const params: {
      page: number
      pageSize: number
      address?: string
      type?: RgbActivityType
    } = {
      page,
      pageSize,
    }
    if (address) params.address = address
    if (type) params.type = type

    const pageResult = await getRgbApiService().getRgbAssetActivity(assetId, params)
    const { total, list } = await this.mergeLocalRgbIssueHistory(pageResult, {
      currentPage,
      address,
      assetId,
      type,
    })

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getRgbAssetHistory = async (
    assetId: string,
    currentPage: number,
    pageSize: number,
    address?: string,
    type?: RgbActivityType
  ) => {
    return this.getRgbAssetActivity(assetId, currentPage, pageSize, address, type)
  }

  getRGBAssetActivity = async (
    _address: string,
    assetId: string,
    currentPage: number,
    pageSize: number,
    type?: RgbActivityType
  ) => {
    const { address } = await this.getRgbFundingAddress()
    return this.getRgbAssetActivity(assetId, currentPage, pageSize, address, type)
  }

  getAddressRgbActivity = async (
    address: string,
    currentPage: number,
    pageSize: number,
    assetId?: string,
    type?: RgbActivityType
  ) => {
    await this.assertRgbEnabled()
    await this.assertRgbFeatureEnabled()
    const page = currentPage
    const params: {
      page: number
      pageSize: number
      assetId?: string
      type?: RgbActivityType
    } = {
      page,
      pageSize,
    }
    if (assetId) params.assetId = assetId
    if (type) params.type = type

    const pageResult = await getRgbApiService().getAddressRgbActivity(address, params)
    const { total, list } = await this.mergeLocalRgbIssueHistory(pageResult, {
      currentPage,
      address,
      assetId,
      type,
    })

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAddressRgbHistory = async (
    address: string,
    currentPage: number,
    pageSize: number,
    assetId?: string,
    type?: RgbActivityType
  ) => {
    return this.getAddressRgbActivity(address, currentPage, pageSize, assetId, type)
  }

  /** Add self-issued assets the indexer has not yet (or no longer) reports as activity. */
  private mergeLocalRgbIssueHistory = async (
    page: RgbControllerPageResponse,
    params: {
      currentPage: number
      address?: string | undefined
      assetId?: string | undefined
      type?: RgbActivityType | undefined
    }
  ) => {
    if (params.currentPage !== 1 || (params.type && params.type !== 'issue')) return page
    const { service, wallet } = await this.getLocalRgbReadService()
    if (params.address !== wallet.fundingAddress) return page

    const issueHistory = service.getIssueHistory?.() || []
    // Activity is not currently persisted for local issuance. Read the UTXO
    // replica directly so this display follows the latest genesis chain state
    // without synchronizing or mutating the encrypted local RGB snapshot.
    const latestSnapshot = await getRgbApiService()
      .getRgbWalletUtxoSnapshot({ wallet, forceSync: true })
      .catch(() => undefined)
    const localIssues = issueHistory
      .filter(issue => !params.assetId || issue.assetId === params.assetId)
      .map(issue => {
        const latestChainStatus = latestSnapshot?.utxos.find(
          utxo =>
            utxo.txid === issue.txid &&
            utxo.allocations.some(allocation => allocation.assetId === issue.assetId)
        )?.chainStatus
        return {
          id: `local-issue:${issue.assetId}`,
          assetId: issue.assetId,
          type: 'issue',
          amount: issue.amount,
          txid: issue.txid,
          timestamp: issue.createdAt,
          status: rgbIssueActivityStatus(latestChainStatus ?? issue.chainStatus),
          ticker: issue.asset.ticker,
          name: issue.asset.name,
          precision: issue.asset.precision,
          local: true,
        }
      })
    const remoteTxids = new Set(
      page.list
        .map(item => (item as { txid?: string }).txid)
        .filter((txid): txid is string => Boolean(txid))
    )
    const additions = localIssues.filter(issue => !remoteTxids.has(issue.txid))
    if (!additions.length) return page
    const list = [...additions, ...page.list].sort(
      (left, right) =>
        Number(
          (right as { timestamp?: number; createdAt?: number }).timestamp ??
            (right as { createdAt?: number }).createdAt ??
            0
        ) -
        Number(
          (left as { timestamp?: number; createdAt?: number }).timestamp ??
            (left as { createdAt?: number }).createdAt ??
            0
        )
    )
    return {
      total: Math.max(page.total + additions.length, list.length),
      list,
    }
  }

  getRgbTransfers = async (
    currentPage: number,
    pageSize: number,
    options?: { skipSync?: boolean }
  ) => {
    await this.assertRgbEnabled()
    return this.rgbTransferQuery.getTransfers(currentPage, pageSize, options)
  }

  /** RGB activation is local to this installation and scoped to the HD wallet and network. */
  getRgbFeatureStatus = async (): Promise<{
    enabled: boolean
    supported: boolean
    remoteRecoveryAvailable: boolean
  }> => {
    try {
      const wallet = await this.getCurrentRgbWalletRef()
      const enabled = await this.isRgbFeatureEnabled(wallet)
      if (enabled) return { enabled: true, supported: true, remoteRecoveryAvailable: false }

      // Do not open, download, or decrypt RGB state before consent. The
      // metadata endpoint only tells the activation UI whether this wallet
      // already has an encrypted recovery checkpoint on the backend.
      try {
        const recovery = await getRgbApiService().getRgbRecoveryCheckpointMetadata({ wallet })
        return {
          enabled: false,
          supported: true,
          remoteRecoveryAvailable: recovery.exists === true,
        }
      } catch (error) {
        // Activation remains available when offline or while an older backend
        // is rolling out. enableRgbFeature will perform the authoritative
        // recovery read after the user accepts the terms.
        log.debug('RGB recovery: unable to check activation metadata', {
          wallet: `${wallet.network || 'unknown'}:${wallet.fundingAddress.slice(-8)}`,
          error: String(error),
        })
        return { enabled: false, supported: true, remoteRecoveryAvailable: false }
      }
    } catch (error) {
      if (String(error).includes('RGB is not enabled for wallet chain')) {
        return { enabled: false, supported: false, remoteRecoveryAvailable: false }
      }
      throw error
    }
  }

  /** User consent is required before opening local RGB state or contacting RGB services. */
  enableRgbFeature = async (): Promise<{ enabled: true }> => {
    const wallet = await this.getCurrentRgbWalletRef()
    const wasEnabled = await this.isRgbFeatureEnabled(wallet)
    const consentKey = this.rgbFeatureStorageKey(wallet)
    if (!wasEnabled) {
      await keyringService.setEncryptedStorageItem(
        RGB_ENCRYPTED_STORAGE_NAMESPACE,
        consentKey,
        {
          enabled: true,
          agreementVersion: RGB_FEATURE_TERMS_VERSION,
          acceptedAt: Date.now(),
        } satisfies RgbFeatureConsent
      )
    }
    try {
      // First enable is intentionally the first point at which recovery is
      // opened. This prevents an inactive RGB card from reading cloud state.
      await this.getLocalRgbService()
    } catch (error) {
      if (!wasEnabled) {
        try {
          await keyringService.removeEncryptedStorageItem(RGB_ENCRYPTED_STORAGE_NAMESPACE, consentKey)
        } catch (rollbackError) {
          log.warn('Failed to roll back RGB consent after recovery failed', rollbackError)
        }
      }
      throw error
    }
    return { enabled: true }
  }

  private rgbFeatureStorageKey(
    wallet: Pick<RgbWalletRef, 'walletId' | 'network' | 'fundingAddress'>
  ) {
    // walletId is `unisat-<master fingerprint>-<account index>`. Consent is
    // shared by accounts from the same HD wallet, but never across networks.
    const walletScope = wallet.walletId?.replace(/-\d+$/, '')
    if (!walletScope) throw new Error('RGB wallet identity is unavailable')
    if (!wallet.network) throw new Error('RGB network identity is unavailable')
    return `${RGB_FEATURE_STORAGE_KEY_PREFIX}:${walletScope}:${wallet.network}`
  }

  private isRgbFeatureConsent(value: unknown): value is RgbFeatureConsent {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as RgbFeatureConsent).enabled === true &&
      typeof (value as RgbFeatureConsent).acceptedAt === 'number'
    )
  }

  private async isRgbFeatureEnabled(
    wallet: Pick<RgbWalletRef, 'walletId' | 'network' | 'fundingAddress'>
  ) {
    const consent = await keyringService.getEncryptedStorageItem<RgbFeatureConsent>(
      RGB_ENCRYPTED_STORAGE_NAMESPACE,
      this.rgbFeatureStorageKey(wallet)
    )
    return this.isRgbFeatureConsent(consent)
  }

  private async assertRgbFeatureEnabled() {
    const wallet = await this.getCurrentRgbWalletRef()
    if (!(await this.isRgbFeatureEnabled(wallet))) {
      throw new Error('RGB is not enabled for this wallet. Enable RGB before continuing.')
    }
  }

  private assertRgbEnabled = () => {
    chainTypeToRgbNetwork(this.getChainType())
  }

  getCurrentRgbWalletRef = async (): Promise<RgbWalletRef> => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    return this.getRgbWalletRefForAccount(account)
  }

  private getRgbWalletRefForAccount = async (account: Account): Promise<LocalRgbWallet> => {
    assertCanCreateSigningRequest(account)

    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring?.getRgbFundingAccount) {
      throw new Error('Current wallet does not support RGB transaction construction')
    }

    const networkType = this.getNetworkType()
    const chainType = this.getChainType()
    const funding = keyring.getRgbFundingAccount(networkType, account.index)
    const network = chainTypeToRgbNetwork(chainType)
    const walletId = `unisat-${funding.masterFingerprint}-${account.index}`

    return {
      walletId,
      fundingAddress: funding.address,
      network,
    }
  }

  private getRgbAccountForWallet = async (wallet: LocalRgbWallet): Promise<Account> => {
    const matches = (candidate: LocalRgbWallet) =>
      candidate.fundingAddress === wallet.fundingAddress &&
      candidate.network === wallet.network &&
      (!wallet.walletId || candidate.walletId === wallet.walletId)
    const current = preferenceService.getCurrentAccount()
    if (current) {
      try {
        const currentWallet = await this.getRgbWalletRefForAccount(current)
        if (matches(currentWallet)) return current
      } catch {
        // The selected account may be a non-RGB wallet while a backup runs.
      }
    }
    for (const keyring of await this.getKeyrings()) {
      if (!this.isUsableKeyring(keyring) || keyring.type !== KeyringType.HdKeyring) continue
      for (const account of keyring.accounts) {
        if (matches(await this.getRgbWalletRefForAccount(account))) return account
      }
    }
    throw new Error('RGB backup account has not been created in this HD wallet')
  }

  private withRgbHdBackupWallet = async <T>(wallet: LocalRgbWallet, operation: () => Promise<T>): Promise<T> => {
    const key = `${wallet.network}:${wallet.fundingAddress}`
    this.rgbHdBackupWallets.set(key, (this.rgbHdBackupWallets.get(key) ?? 0) + 1)
    try {
      return await operation()
    } finally {
      const remaining = (this.rgbHdBackupWallets.get(key) ?? 0) - 1
      if (remaining > 0) this.rgbHdBackupWallets.set(key, remaining)
      else this.rgbHdBackupWallets.delete(key)
    }
  }

  private assertRgbRecoveryWallet = async (wallet: LocalRgbWallet) => {
    if (!this.rgbHdBackupWallets.has(`${wallet.network}:${wallet.fundingAddress}`)) {
      return this.assertActiveRgbWallet(wallet)
    }
    if (!isWalletUnlocked() || wallet.network !== chainTypeToRgbNetwork(this.getChainType())) {
      throw new RgbWalletContextChangedError()
    }
    await this.getRgbAccountForWallet(wallet)
  }

  /**
   * Signs every private RGB API call with the dedicated funding key. The
   * server binds this exact message to method, route and body hash, so an
   * intercepted request cannot be replayed or repurposed.
   */
  private createRgbRequestAuthorization = async (request: {
    method: 'POST'
    path: string
    body: unknown
    serverTime?: number
  }) => {
    if (request.serverTime !== undefined) this.calibrateRgbClock(request.serverTime)
    await this.assertRgbEnabled()
    const requestedWallet = (request.body as { wallet?: Partial<LocalRgbWallet> } | null)?.wallet
    const bodyWallet =
      requestedWallet &&
      typeof requestedWallet.walletId === 'string' &&
      typeof requestedWallet.fundingAddress === 'string' &&
      typeof requestedWallet.network === 'string'
        ? (requestedWallet as LocalRgbWallet)
        : undefined
    if (bodyWallet) {
      const current = preferenceService.getCurrentAccount()
      let isCurrent = false
      if (current) {
        try {
          isCurrent = isSameRgbWallet(await this.getRgbWalletRefForAccount(current), bodyWallet)
        } catch {
          // A backup may continue after the user selects a non-RGB account.
        }
      }
      if (
        !isCurrent &&
        (!this.rgbHdBackupWallets.has(`${bodyWallet.network}:${bodyWallet.fundingAddress}`) ||
          !(
            request.path.startsWith('/v5/rgb/recovery/checkpoint') ||
            request.path.startsWith('/v5/rgb/lease/')
          ))
      ) {
        throw new RgbWalletContextChangedError()
      }
    }
    const account = bodyWallet
      ? await this.getRgbAccountForWallet(bodyWallet)
      : preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    const wallet = await this.getRgbWalletRefForAccount(account)
    // This endpoint deliberately exposes only whether an encrypted checkpoint
    // exists. It must be signed by the funding key, but is allowed before
    // local RGB consent so a restored wallet is not presented as first-time
    // activation. All payload/state endpoints remain consent-gated.
    if (request.path !== '/v5/rgb/recovery/checkpoint/metadata') {
      if (!(await this.isRgbFeatureEnabled(wallet))) {
        throw new Error('RGB is not enabled for this wallet. Enable RGB before continuing.')
      }
    }
    assertCanCreateSigningRequest(account)
    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring?.getRgbFundingAccount) throw new Error('RGB funding account is unavailable')
    const funding = keyring.getRgbFundingAccount(this.getNetworkType(), account.index)
    const bodyHash = bitcoin.crypto.sha256(Buffer.from(stableRgbJson(request.body))).toString('hex')
    const nonceBytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(nonceBytes)
    const nonce = Buffer.from(nonceBytes).toString('hex')
    const expiresAt = Math.floor(this.getRgbNow() / 1000) + 60
    const message = [
      'RGB Authorization v1',
      request.method,
      request.path,
      bodyHash,
      funding.address,
      String(expiresAt),
      nonce,
    ].join('\n')
    const psbt = genPsbtOfBIP322Simple({
      message,
      address: funding.address,
      networkType: this.getNetworkType(),
    })
    await this.attachRgbPsbtDerivations(psbt, undefined, account)
    const toSignInputs = await this.getRgbToSignInputs(psbt, account)
    if (toSignInputs.length !== 1) throw new Error('Unable to prepare RGB authorization signature')
    await keyringService.signTransaction(keyring, psbt, toSignInputs)
    psbt.finalizeAllInputs()
    return {
      fundingAddress: funding.address,
      nonce,
      expiresAt,
      signature: getSignatureFromPsbtOfBIP322Simple(psbt),
    }
  }

  private getCurrentRgbFundingAccount = async (): Promise<{
    address: string
    publicKey: string
    derivationPath: string
    masterFingerprint: string
  }> => {
    await this.assertRgbEnabled()
    await this.assertRgbFeatureEnabled()
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring?.getRgbFundingAccount) {
      throw new Error('Current wallet does not support local RGB funding addresses')
    }

    return keyring.getRgbFundingAccount(this.getNetworkType(), account.index)
  }

  private getCurrentRgbFeeAccount = async (): Promise<{
    address: string
    publicKey: string
    derivationPath: string
    masterFingerprint: string
  }> => {
    await this.assertRgbEnabled()
    await this.assertRgbFeatureEnabled()
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring?.getRgbFeeAccount) {
      throw new Error('Current wallet does not support RGB fee accounts')
    }

    return keyring.getRgbFeeAccount(this.getNetworkType(), account.index)
  }

  createRgbBlindReceive = async (params: Omit<RgbReceiveInvoiceRequest, 'wallet'>) => {
    const context = await this.getLocalRgbService()
    // This may run only after a dApp approval has been held open. Do not let
    // a cached pre-approval lease create durable receive state after handoff.
    await this.ensureRgbWriteLease(context, { forceRenew: true })
    return this.rgbReceiveOperations.createBlindReceive(params, context)
  }

  createRgbWitnessReceive = async (params: Omit<RgbReceiveInvoiceRequest, 'wallet'>) => {
    const context = await this.getLocalRgbService()
    await this.ensureRgbWriteLease(context, { forceRenew: true })
    await this.assertActiveRgbWallet(context.wallet)
    const funding = await this.getCurrentRgbFundingAccount()
    await this.assertActiveRgbWallet(context.wallet)
    const networkType = this.getNetworkType()
    const scriptPubKey = bitcoin.address
      .toOutputScript(funding.address, toPsbtNetwork(networkType))
      .toString('hex')
    const receive = await context.service.createWitnessReceive({
      scriptPubKey,
      publicKey: funding.publicKey,
      ...(params.assetId === undefined ? {} : { assetId: params.assetId }),
      ...(params.amount === undefined ? {} : { amount: String(params.amount) }),
      ...(params.durationSeconds === undefined ? {} : { durationSeconds: params.durationSeconds }),
      ...(params.providerOrigin === undefined ? {} : { providerOrigin: params.providerOrigin }),
      deferRecoveryCheckpoint: true,
    })
    await context.service.claimPendingReceives()
    const batchTransferIdx = context.service
      .getPendingReceives()
      .findIndex(item => item.proxyRecipientId === receive.proxyRecipientId)
    return toPublicRgbPendingReceiveInvoice(
      receive,
      batchTransferIdx < 0 ? undefined : batchTransferIdx,
      getRgbReceiveInvoiceStatus(context.service.getSnapshot(), {})
    )
  }

  /** Wallet-only, read-only transport preflight used before presenting an RGB send signature. */
  checkRgbInvoiceAvailability = async (params: { invoice: string }) => {
    const { service } = await this.getLocalRgbService()
    return service.checkInvoiceAvailability(params.invoice)
  }

  getRgbPendingReceiveInvoices = (params: { skipSync?: boolean; providerOrigin?: string } = {}) =>
    this.rgbReceiveOperations.getPendingReceiveInvoices(params)

  /** Internal provider preflight for a buyer-side RGB/BTC swap. */
  getRgbBuySwapReceive = async (params: { recipientId: string }) => {
    const { service } = await this.getLocalRgbService()
    const receive = service
      .getPendingReceives()
      .find(
        item =>
          item.recipientId === params.recipientId || item.proxyRecipientId === params.recipientId
      )
    const pending = receive?.pendingAccept || receive?.receivedConsignment
    if (!receive || !pending) throw new Error('RGB receive is not awaiting acceptance')
    return {
      recipientId: receive.proxyRecipientId || receive.recipientId,
      assetId: pending.assetId,
      amount: pending.amount,
      txid: pending.txid,
      accepted: receive.receivedConsignment?.accepted === true,
      providerOrigin: receive.providerOrigin,
    }
  }

  getRgbRecoveryCheckpointStatus = async () => {
    // This is a local diagnostic read. In particular, conflict UI polling
    // must not repeatedly start another recovery attempt after a conflict has
    // already been recorded.
    const { service } = await this.rgbServiceRegistry.get()
    return { ...service.getRecoveryCheckpointStatus(), conflicted: service.hasRecoveryConflict() }
  }

  /**
   * User-confirmed escape hatch for a persisted cross-device conflict. It
   * discards this installation's state in favour of the latest authenticated
   * cloud checkpoint; it never uploads, merges or overwrites remote state.
   */
  restoreLatestRgbRecoveryCheckpoint = async () => {
    const context = await this.getLocalRgbReadService()
    return this.restoreLatestRgbRecoveryCheckpointForContext(context)
  }

  /**
   * Explicitly keep this installation's conflicted RGB state. This is never
   * an automatic retry: the user has chosen to replace the latest cloud
   * checkpoint, so acquire a fenced takeover lease and publish against the
   * revision read immediately before the takeover.
   */
  publishLocalRgbRecoveryConflictResolution = async () => {
    // Do not use getLocalRgbReadService here: it starts a background recovery
    // attempt which is intentionally expected to fail while this method is
    // resolving the same conflict.
    const context = await this.rgbServiceRegistry.get()
    const { service, wallet } = context
    if (!service.hasRecoveryConflict()) {
      throw new Error('There is no RGB recovery conflict to resolve')
    }

    const key = `${wallet.network}:${wallet.fundingAddress}`
    const checkpoint = await getRgbApiService().getRgbRecoveryCheckpoint({ wallet })
    if (!checkpoint.payload || !checkpoint.revision) {
      throw new Error('Latest RGB cloud checkpoint is unavailable')
    }
    const remoteState = await decryptRgbRecoveryCheckpoint(
      checkpoint.payload,
      await this.rgbRecoveryKey(wallet)
    )
    if (!service.canRestoreRecoveryState(remoteState)) {
      throw new Error('Latest RGB cloud checkpoint does not belong to this wallet')
    }

    // The remote revision is the only valid CAS baseline for the deliberate
    // replacement. Clear stale deduplication too: an identical local payload
    // may have been verified for an older cloud revision.
    this.rgbRecoveryVersions.set(key, {
      ...(checkpoint.updatedAt === undefined ? {} : { updatedAt: checkpoint.updatedAt }),
      revision: checkpoint.revision,
      ...(checkpoint.generation === undefined ? {} : { generation: checkpoint.generation }),
      ...(checkpoint.kind === undefined ? {} : { kind: checkpoint.kind }),
    })
    this.rgbRecoveryVerifiedFingerprints.delete(key)
    await service.setRecoveryCheckpointVersion(checkpoint.updatedAt)
    await service.setRecoveryCheckpointRevision(checkpoint.revision)
    await this.ensureRgbWriteLease(context, { takeover: true, forceRenew: true })
    await service.prepareLocalRecoveryConflictResolution()
    if (!(await service.retryRecoveryCheckpoint('replacement'))) {
      throw new Error('RGB local conflict resolution checkpoint publication failed')
    }
    const status = service.getRecoveryCheckpointStatus()
    if (status.dirty || !status.verified || service.hasRecoveryConflict()) {
      throw new Error('RGB local conflict resolution checkpoint was not verified')
    }
    return { published: true }
  }

  /** Explicitly adopt the current cloud checkpoint without publishing local state. */
  private restoreLatestRgbRecoveryCheckpointForContext = async (
    context: LocalRgbServiceContext
  ) => {
    const key = `${context.wallet.network}:${context.wallet.fundingAddress}`
    const checkpoint = await getRgbApiService().getRgbRecoveryCheckpoint({ wallet: context.wallet })
    if (!checkpoint.payload || !checkpoint.revision) {
      throw new Error('No RGB recovery checkpoint is available')
    }
    const state = await decryptRgbRecoveryCheckpoint(
      checkpoint.payload,
      await this.rgbRecoveryKey(context.wallet)
    )
    if (!(await context.service.restoreRecoveryState(state))) {
      throw new Error('RGB recovery checkpoint does not belong to this wallet')
    }
    this.rgbRecoveryVersions.set(key, {
      ...(checkpoint.updatedAt === undefined ? {} : { updatedAt: checkpoint.updatedAt }),
      revision: checkpoint.revision,
      ...(checkpoint.generation === undefined ? {} : { generation: checkpoint.generation }),
      ...(checkpoint.kind === undefined ? {} : { kind: checkpoint.kind }),
    })
    await context.service.setRecoveryCheckpointVersion(checkpoint.updatedAt)
    await context.service.setRecoveryCheckpointRevision(checkpoint.revision)
    await context.service.setRecoveryCheckpointGeneration(checkpoint.generation)
    await context.service.setRecoveryCheckpointKind(checkpoint.kind)
    await context.service.enableRecoveryBackup()
    return { restored: true, updatedAt: checkpoint.updatedAt }
  }

  /** Export an offline, encrypted RGB recovery package for the current wallet. */
  exportRgbBackup = async () => {
    const context = await this.getLocalRgbService()
    return this.exportRgbBackupForContext(context)
  }

  private exportRgbBackupForContext = async (context: LocalRgbServiceContext) => {
    await this.ensureRgbWriteLease(context, { forceRenew: true })
    if (!(await context.service.retryRecoveryCheckpoint())) {
      throw new Error(
        'RGB recovery checkpoint is not verified; retry after synchronization completes'
      )
    }
    const status = context.service.getRecoveryCheckpointStatus()
    if (status.dirty || !status.verified) {
      throw new Error(
        'RGB recovery checkpoint is not verified; retry after synchronization completes'
      )
    }
    return createRgbBackupPackage(
      context.service.exportRecoveryState(),
      await this.rgbBackupKey(context.wallet)
    )
  }

  /** Inspect a package after authenticating it with the current wallet seed. */
  inspectRgbBackup = async (payload: string) => {
    if (typeof payload !== 'string' || !payload) throw new Error('RGB backup package is required')
    const context = await this.getLocalRgbService()
    return this.inspectRgbBackupForContext(payload, context)
  }

  private inspectRgbBackupForContext = async (payload: string, context: LocalRgbServiceContext) => {
    const backup = await readRgbBackupPackage(payload, await this.rgbBackupKey(context.wallet))
    if (!context.service.canRestoreRecoveryState(backup.state)) {
      throw new Error('RGB backup package does not belong to this wallet')
    }
    return { createdAt: backup.createdAt, wallet: context.wallet }
  }

  /**
   * Explicitly replace local RGB state with a backup, then publish it as the
   * next fenced checkpoint. Checkpoints are never merged.
   */
  restoreRgbBackup = async (params: { payload: string; replaceRemote: boolean }) => {
    if (!params?.replaceRemote)
      throw new Error('Restoring an RGB backup requires explicit replacement confirmation')
    if (typeof params.payload !== 'string' || !params.payload)
      throw new Error('RGB backup package is required')
    const context = await this.getLocalRgbService()
    return this.restoreRgbBackupForContext(params.payload, context)
  }

  private restoreRgbBackupForContext = async (payload: string, context: LocalRgbServiceContext) => {
    const backup = await readRgbBackupPackage(
      payload,
      await this.rgbBackupKey(context.wallet)
    )
    if (!context.service.canRestoreRecoveryState(backup.state)) {
      throw new Error('RGB backup package does not belong to this wallet')
    }
    // replaceRemote is the explicit user confirmation to discard any current
    // local state. A backup is a replacement, never a merge mechanism.
    await this.ensureRgbWriteLease(context, { forceRenew: true })
    if (!(await context.service.restoreRecoveryState(backup.state))) {
      throw new Error('RGB backup package could not be restored')
    }
    // The controller retains the remote revision it read before acquiring the
    // lease. retryRecoveryCheckpoint publishes this replacement through that
    // CAS baseline; it must not be reset to an unconditional overwrite.
    if (!(await context.service.retryRecoveryCheckpoint('replacement', true))) {
      throw new Error('RGB backup checkpoint publication failed')
    }
    return { restored: true, createdAt: backup.createdAt }
  }

  /** Only the accounts already created in the selected HD keyring are included. */
  private getRgbHdBackupAccounts = async () => {
    const keyring = await this.getCurrentKeyring()
    const current = preferenceService.getCurrentAccount()
    if (!keyring || keyring.type !== KeyringType.HdKeyring || !current) {
      throw new Error('RGB HD backup requires an HD wallet')
    }
    if (!keyring.accounts.some(account => account.key === current.key)) {
      throw new Error('Current account does not belong to this HD wallet')
    }
    return keyring.accounts
  }

  /** Stable across all accounts in one HD keyring, separate from account backup keys. */
  private rgbHdBackupKey = async () => {
    const accounts = await this.getRgbHdBackupAccounts()
    const account = accounts[0]!
    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring?.getRgbFundingAccount || !keyring.deriveRgbRecoveryKey) {
      throw new Error('Current wallet does not support RGB HD backup encryption')
    }
    const funding = keyring.getRgbFundingAccount(this.getNetworkType(), 0)
    const network = chainTypeToCanonicalNetwork(this.getChainType())
    const context = bitcoin.crypto
      .sha256(Buffer.from(`unisat-rgb-hd-export-v1:${network}:${funding.masterFingerprint}`))
      .toString('hex')
    return keyring.deriveRgbRecoveryKey(
      '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      network,
      context
    )
  }

  getRgbHdBackupPlan = async () => {
    const accounts = await this.getRgbHdBackupAccounts()
    const wallet = await this.getCurrentLocalRgbWallet()
    return {
      network: wallet.network,
      walletScope: wallet.walletId.replace(/-\d+$/, ''),
      accountIndexes: accounts.map(account => account.index!),
    }
  }

  /** Export every created RGB account in the selected HD keyring for this network. */
  exportRgbHdBackup = async (expected?: {
    network: string
    walletScope: string
    accountIndexes: number[]
  }) => {
    const accounts = await this.getRgbHdBackupAccounts()
    const selectedWallet = await this.getCurrentLocalRgbWallet()
    const network = selectedWallet.network
    const walletScope = selectedWallet.walletId.replace(/-\d+$/, '')
    const accountIndexes = accounts.map(account => account.index!)
    if (
      expected &&
      (expected.network !== network ||
        expected.walletScope !== walletScope ||
        expected.accountIndexes.length !== accountIndexes.length ||
        expected.accountIndexes.some((index, position) => index !== accountIndexes[position]))
    ) {
      throw new Error('RGB backup scope changed. Review the accounts and try again.')
    }
    const key = await this.rgbHdBackupKey()
    const entries: Array<{ index: number; payload: string }> = []
    for (const account of accounts) {
      const wallet = await this.getRgbWalletRefForAccount(account)
      if (wallet.network !== network || !wallet.walletId.startsWith(`${walletScope}-`)) {
        throw new Error('RGB backup scope changed. Review the accounts and try again.')
      }
      const payload = await this.withRgbHdBackupWallet(wallet, async () => {
        const context = await this.getLocalRgbServiceForWallet(wallet)
        return this.exportRgbBackupForContext(context)
      })
      entries.push({ index: account.index!, payload })
    }
    return createRgbHdBackupPackage(network, entries, key)
  }

  /** Authenticate the HD manifest and every account that already exists locally. */
  inspectRgbHdBackup = async (payload: string) => {
    const backup = await readRgbHdBackupPackage(payload, await this.rgbHdBackupKey())
    const accounts = await this.getRgbHdBackupAccounts()
    const network = (await this.getCurrentLocalRgbWallet()).network
    if (backup.network !== network) throw new Error('RGB backup network does not match')
    const missingAccountIndexes: number[] = []
    for (const entry of backup.accounts) {
      const account = accounts.find(item => item.index === entry.index)
      if (!account) {
        missingAccountIndexes.push(entry.index)
        continue
      }
      const wallet = await this.getRgbWalletRefForAccount(account)
      await this.withRgbHdBackupWallet(wallet, async () => {
        const context = await this.getLocalRgbServiceForWallet(wallet)
        await this.inspectRgbBackupForContext(entry.payload, context)
      })
    }
    const highestCreatedIndex = Math.max(...accounts.map(account => account.index!))
    const highestBackupIndex = Math.max(...backup.accounts.map(entry => entry.index))
    if (missingAccountIndexes.some(index => index <= highestCreatedIndex)) {
      throw new Error('RGB backup requires an account in a gap of this HD wallet')
    }
    if (highestBackupIndex - highestCreatedIndex > 1000) {
      throw new Error('RGB backup requires too many new accounts')
    }
    const accountsToCreateIndexes = Array.from(
      { length: Math.max(0, highestBackupIndex - highestCreatedIndex) },
      (_, offset) => highestCreatedIndex + offset + 1
    )
    return {
      createdAt: backup.createdAt,
      network,
      accountIndexes: backup.accounts.map(item => item.index),
      missingAccountIndexes,
      accountsToCreateIndexes,
    }
  }

  /** Restore each account through the existing fenced replacement path. */
  restoreRgbHdBackup = async (params: { payload: string; replaceRemote: boolean; createMissingAccounts?: boolean }) => {
    if (!params?.replaceRemote) {
      throw new Error('Restoring an RGB backup requires explicit replacement confirmation')
    }
    const preview = await this.inspectRgbHdBackup(params.payload)
    if (preview.missingAccountIndexes.length > 0) {
      if (!params.createMissingAccounts) {
        throw new Error(`RGB account ${preview.missingAccountIndexes[0]! + 1} has not been created`)
      }
      const originalAccount = preferenceService.getCurrentAccount()
      const keyring = await this.getCurrentKeyring()
      if (!keyring || keyring.type !== KeyringType.HdKeyring || !originalAccount) {
        throw new Error('RGB HD backup requires an HD wallet')
      }
      const hdKeyring = keyringService.keyrings[keyring.index]
      if (!hdKeyring) throw new Error('RGB HD wallet keyring is unavailable')
      try {
        for (const index of preview.accountsToCreateIndexes) {
          await keyringService.addNewAccount(hdKeyring)
          const updatedKeyring = await this.getCurrentKeyring()
          if (updatedKeyring?.accounts[updatedKeyring.accounts.length - 1]?.index !== index) {
            throw new Error('RGB account creation did not match the backup account index')
          }
        }
      } finally {
        const updatedKeyring = await this.getCurrentKeyring()
        if (updatedKeyring) await this.changeKeyring(updatedKeyring, originalAccount.index)
      }
      const verified = await this.inspectRgbHdBackup(params.payload)
      if (verified.missingAccountIndexes.length > 0) {
        throw new Error(`RGB account ${verified.missingAccountIndexes[0]! + 1} has not been created`)
      }
    }
    const backup = await readRgbHdBackupPackage(params.payload, await this.rgbHdBackupKey())
    const accounts = await this.getRgbHdBackupAccounts()
    const restoredIndexes: number[] = []
    for (const entry of backup.accounts) {
      const account = accounts.find(item => item.index === entry.index)
      if (!account) throw new Error(`RGB account ${entry.index + 1} has not been created`)
      try {
        const wallet = await this.getRgbWalletRefForAccount(account)
        await this.withRgbHdBackupWallet(wallet, async () => {
          const context = await this.getLocalRgbServiceForWallet(wallet)
          await this.restoreRgbBackupForContext(entry.payload, context)
        })
        restoredIndexes.push(entry.index)
      } catch (error) {
        throw new Error(
          `RGB account ${entry.index + 1} failed to restore; completed accounts: ${restoredIndexes.map(index => index + 1).join(', ') || 'none'}. ${String(error)}`
        )
      }
    }
    return { restored: true, createdAt: backup.createdAt, accountIndexes: restoredIndexes }
  }

  private findLegacyRgbBackupAccount = async (payload: string) => {
    for (const account of await this.getRgbHdBackupAccounts()) {
      const wallet = await this.getRgbWalletRefForAccount(account)
      const key = await this.rgbBackupKey(wallet)
      try {
        await readRgbBackupPackage(payload, key)
        return { account, wallet }
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== 'RGB backup package cannot be decrypted by this wallet'
        ) {
          throw error
        }
      }
    }
    throw new Error('RGB backup does not belong to a created account in this HD wallet')
  }

  inspectRgbBackupFile = async (payload: string) => {
    if (isRgbHdBackupPackage(payload)) {
      const backup = await this.inspectRgbHdBackup(payload)
      return { kind: 'hd' as const, ...backup }
    }
    const { account, wallet } = await this.findLegacyRgbBackupAccount(payload)
    const backup = await this.withRgbHdBackupWallet(wallet, async () => {
      const context = await this.getLocalRgbServiceForWallet(wallet)
      return this.inspectRgbBackupForContext(payload, context)
    })
    return {
      kind: 'account' as const,
      createdAt: backup.createdAt,
      network: backup.wallet.network,
      accountIndexes: [account.index!],
    }
  }

  restoreRgbBackupFile = async (params: { payload: string; replaceRemote: boolean; createMissingAccounts?: boolean }) => {
    if (isRgbHdBackupPackage(params.payload)) return this.restoreRgbHdBackup(params)
    if (!params.replaceRemote) {
      throw new Error('Restoring an RGB backup requires explicit replacement confirmation')
    }
    const { account, wallet } = await this.findLegacyRgbBackupAccount(params.payload)
    const result = await this.withRgbHdBackupWallet(wallet, async () => {
      const context = await this.getLocalRgbServiceForWallet(wallet)
      return this.restoreRgbBackupForContext(params.payload, context)
    })
    return {
      ...result,
      accountIndexes: [account.index!],
    }
  }

  /** Indicates whether this device may mutate RGB state; no other-device identity is exposed. */
  getRgbWriteLeaseStatus = async () => {
    const context = await this.getLocalRgbReadService()
    const key = this.rgbWriteLeaseKey(context.wallet)
    const lease = this.getRgbWriteLeaseCredential(context.wallet)
    const status = await getRgbApiService().getRgbWriteLeaseStatus({
      wallet: context.wallet,
      ...(lease ? { lease } : {}),
    })
    if (lease && !status.heldByCaller) this.rgbWriteLeases.delete(key)
    return {
      mode: status.heldByCaller
        ? ('writer' as const)
        : status.available
          ? ('available' as const)
          : ('readonly' as const),
      ...(status.expiresAt === undefined ? {} : { expiresAt: status.expiresAt }),
    }
  }

  /** User-confirmed activation. takeover fences the previously active device immediately. */
  activateRgbWriteLease = async (params: { takeover?: boolean } = {}) => {
    // Every user-initiated write must establish the current checkpoint
    // revision first. A cached local writer lease does not prove another
    // installation has not already published a newer checkpoint.
    const context = await this.getLocalRgbReadService()
    if (params.takeover) await this.restoreLatestRgbRecoveryCheckpointForContext(context)
    else await this.refreshRgbRecoveryForWrite(context)
    await this.ensureRgbWriteLease(context, { takeover: params.takeover === true })
    const lease = this.getRgbActiveWriteLease(context.wallet)
    if (!lease) throw new Error('RGB write lease is unavailable')
    return { active: true, expiresAt: lease.expiresAt }
  }

  /** Release the current device's lease to make a deliberate device handoff immediate. */
  releaseRgbWriteLease = async () => {
    const context = await this.getLocalRgbReadService()
    return this.releaseRgbWriteLeaseForWallet(context.wallet)
  }

  /** Wallet-only RGB UTXO diagnostic view. Never exposed through the dApp provider. */
  getRgbUtxoInspection = async (params: { forceSync?: boolean } = {}) => {
    const { service } = await this.getLocalRgbService()
    const fundingAccount = await this.getCurrentRgbFundingAccount()
    if (params.forceSync) await service.sync()
    return {
      ...service.getUtxoInspection(),
      address: fundingAccount.address,
      derivationPath: fundingAccount.derivationPath,
    }
  }

  cancelRgbReceiveInvoice = async (params: Omit<RgbCancelReceiveInvoiceRequest, 'wallet'>) => {
    const context = await this.getLocalRgbService()
    await this.ensureRgbWriteLease(context, { forceRenew: true })
    return this.rgbReceiveOperations.cancelReceiveInvoice(params.batchTransferIdx, context)
  }

  getRgbFundingAddress = async () => {
    const { address } = await this.getCurrentRgbFundingAccount()
    return { address }
  }

  /**
   * Minimal, template-building view of confirmed RGB carrier UTXOs. This is
   * deliberately not a reservation: prepareSwap rechecks every outpoint and
   * locks it atomically before adding the RGB commitment.
   */
  getRgbFundingUtxos = async (params: { assetId: string }) => {
    if (!params.assetId) throw new Error('assetId is required')
    const { service } = await this.getLocalRgbReadService()
    const assetId = service.getLocalAssetDetail(params.assetId).assetId
    const locked = new Set(
      service
        .getPendingTransfers()
        .flatMap(transfer => transfer.prepared.lockedOutpoints)
        .map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
    )
    return {
      utxos: service
        .getSnapshot()
        .utxos.filter(utxo => {
          const key = `${utxo.outpoint.txid}:${utxo.outpoint.vout}`
          return (
            utxo.chainStatus === 'confirmed' &&
            !locked.has(key) &&
            utxo.allocations.length > 0 &&
            utxo.allocations.every(
              allocation =>
                allocation.assetId === assetId && allocation.settled && allocation.spendable
            )
          )
        })
        .map(utxo => ({
          txid: utxo.outpoint.txid,
          vout: utxo.outpoint.vout,
          satoshis: utxo.satoshis,
          scriptPubKey: utxo.scriptPubKey,
          allocations: utxo.allocations
            .filter(
              allocation =>
                allocation.assetId === assetId && allocation.settled && allocation.spendable
            )
            .map(allocation => ({ assetId: allocation.assetId, amount: allocation.amount })),
        })),
    }
  }

  /** Minimal view of unlocked confirmed RGB fee-pool UTXOs for swap templates. */
  getRgbFeeUtxos = async () => {
    const { service } = await this.getLocalRgbReadService()
    const feeAccount = await this.getCurrentRgbFeeAccount()
    const locked = new Set(
      service
        .getPendingTransfers()
        .flatMap(transfer => transfer.prepared.feeOutpoints || [])
        .map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
    )
    const remoteUtxos = await walletApiService.bitcoin.getAllBTCUtxos(feeAccount.address)
    const scriptPubKey = bitcoin.address
      .toOutputScript(feeAccount.address, toPsbtNetwork(this.getNetworkType()))
      .toString('hex')
    return {
      utxos: remoteUtxos
        .filter(utxo => !locked.has(`${utxo.txid}:${utxo.vout}`))
        .filter(utxo => !utxo.inscriptions?.length && !utxo.atomicals?.length)
        .map(utxo => ({
          txid: utxo.txid,
          vout: utxo.vout,
          satoshis: utxo.satoshis,
          scriptPubKey,
        })),
    }
  }

  private rgbFeePoolWithdrawalHistoryKey(wallet: LocalRgbWallet) {
    return `${wallet.network}:${wallet.walletId}`
  }

  private async getRgbFeePoolWithdrawalHistory(
    wallet: LocalRgbWallet
  ): Promise<RgbFeePoolWithdrawalHistoryItem[]> {
    const stored = await keyringService.getEncryptedStorageItem<unknown>(
      RGB_LOCAL_HISTORY_STORAGE_NAMESPACE,
      this.rgbFeePoolWithdrawalHistoryKey(wallet)
    )
    if (!Array.isArray(stored)) return []
    return stored
      .filter((item): item is RgbFeePoolWithdrawalHistoryItem => {
        if (!item || typeof item !== 'object') return false
        const record = item as Partial<RgbFeePoolWithdrawalHistoryItem>
        return (
          typeof record.txid === 'string' &&
          /^[0-9a-f]{64}$/i.test(record.txid) &&
          typeof record.amount === 'number' &&
          Number.isSafeInteger(record.amount) &&
          record.amount >= 0 &&
          typeof record.destination === 'string' &&
          typeof record.createdAt === 'number' &&
          Number.isFinite(record.createdAt)
        )
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, RGB_FEE_POOL_WITHDRAWAL_HISTORY_LIMIT)
  }

  private async addRgbFeePoolWithdrawalHistory(
    wallet: LocalRgbWallet,
    item: RgbFeePoolWithdrawalHistoryItem
  ): Promise<void> {
    const current = await this.getRgbFeePoolWithdrawalHistory(wallet)
    const next = [item, ...current.filter(existing => existing.txid !== item.txid)].slice(
      0,
      RGB_FEE_POOL_WITHDRAWAL_HISTORY_LIMIT
    )
    await keyringService.setEncryptedStorageItem(
      RGB_LOCAL_HISTORY_STORAGE_NAMESPACE,
      this.rgbFeePoolWithdrawalHistoryKey(wallet),
      next
    )
  }

  getRgbFeePoolInspection = async (params: { feeRate?: number } = {}) => {
    const { service, wallet } = await this.getLocalRgbService()
    const feeAccount = await this.getCurrentRgbFeeAccount()
    const remoteUtxos = await walletApiService.bitcoin.getAllBTCUtxos(feeAccount.address)
    const locked = new Set(
      service
        .getPendingTransfers()
        .flatMap(transfer => transfer.prepared.feeOutpoints || [])
        .map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
    )
    const local = service.getPendingFeePoolUtxos()
    const all = new Map(
      remoteUtxos.map(utxo => [
        `${utxo.txid}:${utxo.vout}`,
        { txid: utxo.txid, vout: utxo.vout, satoshis: utxo.satoshis, pending: false },
      ])
    )
    local.forEach(utxo => {
      const key = `${utxo.outpoint.txid}:${utxo.outpoint.vout}`
      if (!all.has(key)) {
        all.set(key, {
          txid: utxo.outpoint.txid,
          vout: utxo.outpoint.vout,
          satoshis: utxo.satoshis,
          pending: true,
        })
      }
    })
    // The pool unit is only the recommended size for newly created outputs.
    // RGB PSBT building combines fee UTXOs, so every unlocked output remains
    // eligible even when it is smaller than the recommended unit.
    const minimumSatoshis = RGB_FEE_POOL_UTXO_SATS
    const utxos = [...all.entries()]
      .map(([key, utxo]) => ({
        ...utxo,
        locked: locked.has(key),
        available: !locked.has(key),
      }))
      .sort((a, b) => a.txid.localeCompare(b.txid) || a.vout - b.vout)
    const availableCount = utxos.filter(utxo => utxo.available).length
    const withdrawals = await this.getRgbFeePoolWithdrawalHistory(wallet)
    return {
      address: feeAccount.address,
      derivationPath: feeAccount.derivationPath,
      minimumSatoshis,
      availableCount,
      targetCount: RGB_FEE_POOL_TARGET_UTXOS,
      ready: availableCount > 0,
      utxos,
      withdrawals,
    }
  }

  getRgbFeePoolStatus = async (params: { feeRate?: number } = {}) => {
    const { address, minimumSatoshis, availableCount, targetCount, ready } =
      await this.getRgbFeePoolInspection(params)
    return { address, minimumSatoshis, availableCount, targetCount, ready }
  }

  /** Build a wallet-only transaction that returns unlocked Fee Pool BTC to the current account. */
  createRgbFeePoolWithdrawBegin = async (params: { feeRate?: number } = {}) => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    const [context, feeAccount] = await Promise.all([
      this.getLocalRgbService(),
      this.getCurrentRgbFeeAccount(),
    ])
    await this.ensureRgbWriteLease(context)
    const { service } = context
    const locked = new Set(
      service
        .getPendingTransfers()
        .flatMap(transfer => transfer.prepared.feeOutpoints || [])
        .map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
    )
    const remoteUtxos = await walletApiService.bitcoin.getAllBTCUtxos(feeAccount.address)
    const feeUtxos = remoteUtxos
      .filter(utxo => !locked.has(`${utxo.txid}:${utxo.vout}`))
      .filter(isSafeRgbFeePoolFundingUtxo)
      .map(utxo => ({
        ...utxo,
        pubkey: feeAccount.publicKey,
        addressType: AddressType.P2TR,
      }))
    if (!feeUtxos.length)
      throw new Error('No unlocked RGB fee pool UTXOs are available to withdraw')

    const feeRate = params.feeRate ?? (await this.getFeeSummary()).list[1]?.feeRate
    if (!feeRate || feeRate <= 0) throw new Error('Invalid RGB fee-pool withdrawal fee rate')
    const { psbt } = await txHelpers.sendAllBTC({
      btcUtxos: feeUtxos,
      toAddress: account.address,
      networkType: this.getNetworkType(),
      feeRate,
      enableRBF: true,
    })
    const amount = psbt.txOutputs[0]?.value
    const toSignData = await this.getRgbToSignData({
      expectedWallet: context.wallet,
      psbt: psbt.toHex(),
      action: {
        name: 'Withdraw RGB Fee Pool',
        description: '',
        details: [
          {
            label: 'My RGB Fee Address',
            labelKey: 'my_rgb_fee_address',
            type: PsbtActionDetailType.ADDRESS,
            value: feeAccount.address,
          },
          { label: 'To', type: PsbtActionDetailType.ADDRESS, value: account.address },
          { label: 'Amount', type: PsbtActionDetailType.TEXT, value: `${amount || 0} sats` },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    await this.assertActiveRgbWallet(context.wallet)
    this.rgbPendingBitcoinOperations.set('fee-pool-withdraw', context.wallet)
    return { toSignData, amount }
  }

  createRgbFeePoolWithdrawEnd = async (params: { signedPsbt: string }) => {
    const expectedWallet = this.rgbPendingBitcoinOperations.get('fee-pool-withdraw')
    if (expectedWallet) await this.assertActiveRgbWallet(expectedWallet)
    const signedPsbt = psbtFromString(params.signedPsbt)
    const feeAccount = await this.getCurrentRgbFeeAccount()
    const feeScript = bitcoin.address.toOutputScript(
      feeAccount.address,
      toPsbtNetwork(this.getNetworkType())
    )
    const inputScripts = signedPsbt.data.inputs.map(input => input.witnessUtxo?.script)
    if (!inputScripts.length || inputScripts.some(script => !script?.equals(feeScript))) {
      throw new RgbWalletContextChangedError()
    }
    const transaction = signedPsbt.extractTransaction(true)
    const spentOutpoints = transaction.ins.map(input => ({
      txid: Buffer.from(input.hash).reverse().toString('hex'),
      vout: input.index,
    }))
    const { service, wallet } = await this.getLocalRgbService()
    if (expectedWallet && !isSameRgbWallet(wallet, expectedWallet)) {
      throw new RgbWalletContextChangedError()
    }
    await this.ensureRgbWriteLease({ service, wallet }, { forceRenew: true })
    if (expectedWallet) await this.assertActiveRgbWallet(expectedWallet)
    const txid = await this.pushTx(transaction.toHex())
    this.rgbPendingBitcoinOperations.delete('fee-pool-withdraw')
    await service.removeFeePoolUtxos(spentOutpoints)
    const account = preferenceService.getCurrentAccount()
    const amount = transaction.outs.reduce((total, output) => total + output.value, 0)
    if (account) {
      try {
        await this.addRgbFeePoolWithdrawalHistory(wallet, {
          txid,
          amount,
          destination: account.address,
          createdAt: this.getRgbNow(),
        })
      } catch (error) {
        console.warn('Failed to save local RGB fee-pool withdrawal history', error)
      }
    }
    return { txid }
  }

  createRgbFeePoolTopUpBegin = async (params: { feeRate?: number } = {}) => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)
    const context = await this.getLocalRgbService()
    await this.ensureRgbWriteLease(context)
    const status = await this.getRgbFeePoolStatus(params)
    const feeSummary = params.feeRate ? undefined : await this.getFeeSummary()
    const feeRate = params.feeRate ?? feeSummary?.list[0]?.feeRate
    if (!feeRate || feeRate <= 0) throw new Error('Invalid RGB fee-pool top-up fee rate')
    const targetCount = Math.max(1, RGB_FEE_POOL_TARGET_UTXOS - status.availableCount)
    const btcUtxos = await this.getBTCUtxos()
    const safeBtcUtxos = btcUtxos.filter(isSafeRgbFeePoolFundingUtxo)
    const availableSatoshis = safeBtcUtxos.reduce((total, utxo) => total + utxo.satoshis, 0)
    const plan = planRgbFeePoolTopUp({
      targetCount,
      minimumSatoshis: status.minimumSatoshis,
      availableSatoshis,
      feeRate,
    })
    if (plan.count === 0) {
      throw rgbFeePoolInsufficientBtcError({
        requiredSatoshis: plan.requiredSatoshis,
        availableSatoshis,
        topUpSatoshis: plan.topUpSatoshis,
        estimatedFeeSatoshis: plan.estimatedFeeSatoshis,
        feePoolUtxoCount: plan.feePoolUtxoCount,
      })
    }
    const { count } = plan
    const { psbt, toSignInputs } = await txHelpers.sendBTC({
      btcUtxos: safeBtcUtxos,
      tos: Array.from({ length: count }, () => ({
        address: status.address,
        satoshis: status.minimumSatoshis,
      })),
      networkType: this.getNetworkType(),
      changeAddress: account.address,
      feeRate,
      enableRBF: true,
    })
    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: { toSignInputs: toSignInputs as any, autoFinalized: true },
      action: {
        name: 'Fund RGB Fee Pool',
        description: '',
        details: [
          { label: 'RGB Fee UTXOs', type: PsbtActionDetailType.TEXT, value: String(count) },
          {
            label: 'My RGB Fee Address',
            labelKey: 'my_rgb_fee_address',
            type: PsbtActionDetailType.ADDRESS,
            value: status.address,
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    await this.assertActiveRgbWallet(context.wallet)
    this.rgbPendingBitcoinOperations.set('fee-pool-top-up', context.wallet)
    return { psbtHex: toSignData.psbtHex, toSignData, count, amount: status.minimumSatoshis }
  }

  createRgbFeePoolTopUpEnd = async (params: { signedPsbt: string }) => {
    const expectedWallet = this.rgbPendingBitcoinOperations.get('fee-pool-top-up')
    if (expectedWallet) await this.assertActiveRgbWallet(expectedWallet)
    const signedPsbt = psbtFromString(params.signedPsbt)
    const transaction = signedPsbt.extractTransaction(true)
    const feeAccount = await this.getCurrentRgbFeeAccount()
    const networkType = this.getNetworkType()
    const hasCurrentFeeOutput = transaction.outs.some(
      output => scriptPkToAddress(output.script, networkType) === feeAccount.address
    )
    if (!hasCurrentFeeOutput) throw new RgbWalletContextChangedError()
    const { service, wallet } = await this.getLocalRgbService()
    if (expectedWallet && !isSameRgbWallet(wallet, expectedWallet)) {
      throw new RgbWalletContextChangedError()
    }
    await this.ensureRgbWriteLease({ service, wallet }, { forceRenew: true })
    if (expectedWallet) await this.assertActiveRgbWallet(expectedWallet)
    const txid = await this.pushTx(transaction.toHex())
    this.rgbPendingBitcoinOperations.delete('fee-pool-top-up')
    const utxos = transaction.outs
      .map((output, vout) => ({ output, vout }))
      .filter(({ output }) => scriptPkToAddress(output.script, networkType) === feeAccount.address)
      .map(({ output, vout }) => ({
        outpoint: { txid, vout },
        satoshis: Number(output.value),
        scriptPubKey: output.script.toString('hex'),
        publicKey: feeAccount.publicKey,
        createdAt: this.getRgbNow(),
      }))
    if (!utxos.length) throw new Error('RGB fee-pool top-up has no fee outputs')
    await service.queueFeePoolUtxos(utxos)
    return { txid, utxos }
  }

  createRgbIssueNia = (params: Omit<RgbIssueNiaRequest, 'wallet'>) =>
    this.rgbIssueOperations.issueNia(params)

  createRgbUtxosBegin = async (params: Omit<RgbCreateUtxosBeginRequest, 'wallet'>) => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)
    const expectedWallet = await this.getCurrentLocalRgbWallet()

    const num = params.num ?? 5
    const size = params.size ?? RGB_FUNDING_UTXO_DUST
    const feeRate = params.feeRate ?? (await this.getFeeSummary()).list[1]?.feeRate
    if (!Number.isInteger(num) || num <= 0) throw new Error('RGB UTXO count must be positive')
    if (!Number.isInteger(size) || size < RGB_FUNDING_UTXO_DUST) {
      throw new Error(`RGB UTXO size must be at least ${RGB_FUNDING_UTXO_DUST} sats`)
    }
    if (!feeRate || feeRate <= 0) throw new Error('Invalid RGB UTXO fee rate')
    if (params.payment && (!params.payment.address || !Number.isSafeInteger(params.payment.satoshis) ||
        params.payment.satoshis < 546)) throw new Error('Invalid RGB issue service fee')

    const [btcUtxos, funding] = await Promise.all([
      this.getBTCUtxos(),
      this.getCurrentRgbFundingAccount(),
    ])
    if (btcUtxos.length === 0) throw new Error('Insufficient balance.')

    // This is a standard Bitcoin transaction. The outputs become RGB-capable
    // UTXOs only after the indexer observes the confirmed transaction.
    const { psbt, toSignInputs } = await txHelpers.sendBTC({
      btcUtxos,
      tos: [
        ...Array.from({ length: num }, () => ({ address: funding.address, satoshis: size })),
        ...(params.payment ? [params.payment] : []),
      ],
      networkType: this.getNetworkType(),
      changeAddress: account.address,
      feeRate,
      enableRBF: true,
    })

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
      action: {
        name: params.issue ? 'Issue RGB asset' : 'Create RGB UTXO',
        description: '',
        details: [
          { label: 'UTXO Count', type: PsbtActionDetailType.TEXT, value: String(num) },
          { label: 'RGB Address', type: PsbtActionDetailType.ADDRESS, value: funding.address },
          ...(params.payment ? [
            { label: 'Service Fee', type: PsbtActionDetailType.TEXT, value: `${params.payment.satoshis} sats` },
            { label: 'Service Fee Address', type: PsbtActionDetailType.ADDRESS, value: params.payment.address },
          ] : []),
          ...(params.issue ? [
            { label: 'Asset', type: PsbtActionDetailType.TEXT, value: `${params.issue.name} (${params.issue.ticker})` },
            { label: 'Supply', type: PsbtActionDetailType.TEXT, value: `${params.issue.amount} atomic units` },
            { label: 'Decimals', type: PsbtActionDetailType.TEXT, value: String(params.issue.precision) },
          ] : []),
        ],
        type: PsbtActionType.CUSTOM,
      },
    })

    await this.assertActiveRgbWallet(expectedWallet)
    this.rgbPendingBitcoinOperations.set('create-utxos', expectedWallet)

    return { local: true, psbtHex: toSignData.psbtHex, toSignData }
  }

  createRgbUtxosEnd = async (params: Omit<RgbCreateUtxosEndRequest, 'wallet'>) => {
    const expectedWallet = this.rgbPendingBitcoinOperations.get('create-utxos')
    if (expectedWallet) await this.assertActiveRgbWallet(expectedWallet)
    const signedPsbt = psbtFromString(params.signedPsbt)
    const transaction = signedPsbt.extractTransaction(true)
    const funding = await this.getCurrentRgbFundingAccount()
    const networkType = this.getNetworkType()
    const hasCurrentFundingOutput = transaction.outs.some(
      output => scriptPkToAddress(output.script, networkType) === funding.address
    )
    if (!hasCurrentFundingOutput) throw new RgbWalletContextChangedError()
    const { service, wallet } = await this.getLocalRgbService()
    if (expectedWallet && !isSameRgbWallet(wallet, expectedWallet)) {
      throw new RgbWalletContextChangedError()
    }
    // The user may have spent time in an external signer. Renew immediately
    // before broadcast so a device that was fenced during signing cannot
    // publish this funding transaction.
    await this.ensureRgbWriteLease({ service, wallet }, { forceRenew: true })
    if (expectedWallet) await this.assertActiveRgbWallet(expectedWallet)
    const txid = await this.pushTx(transaction.toHex())
    this.rgbPendingBitcoinOperations.delete('create-utxos')
    const outpoints = transaction.outs
      .map((output, vout) => ({ output, vout }))
      .filter(({ output }) => scriptPkToAddress(output.script, networkType) === funding.address)
      .map(({ output, vout }) => ({
        txid,
        vout,
        satoshis: Number(output.value),
        scriptPk: output.script.toString('hex'),
        publicKey: funding.publicKey,
        allocations: [],
      }))

    let syncPending = false
    try {
      await service.queueUtxoSync({
        txid,
        outpoints: outpoints.map(outpoint => ({
          outpoint: { txid: outpoint.txid, vout: outpoint.vout },
          satoshis: outpoint.satoshis,
          scriptPubKey: outpoint.scriptPk,
          publicKey: outpoint.publicKey,
          chainStatus: 'mempool',
          allocations: outpoint.allocations,
        })),
      })
      await this.syncRgbIndexerOutbox(service, wallet)
    } catch (error) {
      syncPending = true
      log.warn('RGB funding transaction was broadcast, but UTXO sync is pending', error)
    }

    return { txid, outpoints, syncPending }
  }

  getRgbPendingVanillaTxs = () => this.rgbSendOperations.getPendingVanillaTxs()

  abortRgbVanillaTx = async (params: Omit<RgbAbortVanillaTxRequest, 'wallet'>) => {
    const context = await this.getLocalRgbService()
    await this.ensureRgbWriteLease(context, { forceRenew: true })
    return this.rgbSendOperations.abortVanillaTx(params.txid, context, {
      discardUnsigned: params.discardUnsigned === true,
    })
  }

  abortRgbAcknowledgedSwap = async (params: Omit<RgbAbortVanillaTxRequest, 'wallet'>) => {
    const context = await this.getLocalRgbService()
    await this.ensureRgbWriteLease(context, { forceRenew: true })
    return this.rgbSendOperations.abortAcknowledgedSwap(params.txid, context)
  }

  acceptRgbReceive = async (params: { recipientId: string }) => {
    log.info('[RGB accept] Starting receive acceptance')
    try {
      const context = await this.getLocalRgbService()
      log.info('[RGB accept] Recovery state is ready')
      await this.ensureRgbWriteLease(context, { forceRenew: true })
      log.info('[RGB accept] Write permission acquired')
      const receive = context.service
        .getPendingReceives?.()
        ?.find(
          item =>
            item.recipientId === params.recipientId || item.proxyRecipientId === params.recipientId
        )
      log.warn('[RGB accept] Local receive state', {
        found: Boolean(receive),
        matchedByProxyRecipient: receive?.proxyRecipientId === params.recipientId,
        hasPendingAccept: Boolean(receive?.pendingAccept),
        hasReceivedConsignment: Boolean(receive?.receivedConsignment),
        accepted: receive?.receivedConsignment?.accepted,
        acknowledgementPending: receive?.receivedConsignment?.acknowledgementPending,
        recipientType: receive?.recipientType,
      })
      const result = await this.rgbReceiveOperations.acceptReceive(params.recipientId, context)
      if (!result?.accepted) {
        log.error('[RGB accept] Receive acceptance returned an unexpected result', {
          accepted: result?.accepted,
          status: result?.status,
        })
      } else {
        log.info('[RGB accept] Receive acceptance completed', { status: result.status })
      }
      return result
    } catch (error) {
      const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {}
      log.error('[RGB accept] Receive acceptance failed', {
        name: typeof record['name'] === 'string' ? record['name'] : undefined,
        message: typeof record['message'] === 'string' ? record['message'] : String(error),
        code:
          typeof record['code'] === 'string' || typeof record['code'] === 'number'
            ? record['code']
            : undefined,
        stack: typeof record['stack'] === 'string' ? record['stack'] : undefined,
      })
      throw error
    }
  }

  rejectRgbReceive = async (params: { recipientId: string }) => {
    const context = await this.getLocalRgbService()
    await this.ensureRgbWriteLease(context, { forceRenew: true })
    return this.rgbReceiveOperations.rejectReceive(params.recipientId, context)
  }

  abandonRgbAcceptedReceive = async (params: { recipientId: string }) => {
    const context = await this.getLocalRgbService()
    await this.ensureRgbWriteLease(context, { forceRenew: true })
    return this.rgbReceiveOperations.abandonAcceptedReceive(params.recipientId)
  }

  getRgbAllocationSummary = (params: Omit<RgbAllocationSummaryRequest, 'wallet'> = {}) =>
    this.rgbReceiveOperations.getAllocationSummary(params)

  createRgbSendBegin = async (params: Omit<RgbSendBeginRequest, 'wallet'>) => {
    const context = await this.getLocalRgbService()
    await this.ensureRgbWriteLease(context, { forceRenew: true })
    return this.rgbSendOperations.begin(params)
  }

  createRgbSendEnd = (params: Omit<RgbSendEndRequest, 'wallet'>) =>
    this.rgbSendOperations.complete(params)

  publishRgbSwap = (params: { transferId: string; signedPsbt: string }) =>
    this.rgbSendOperations.publishSwap(params)

  prepareRgbSwapExternalBroadcast = (params: { transferId: string; signedPsbt: string }) =>
    this.rgbSendOperations.prepareExternalSwapBroadcast(params)

  /** Local provider owner for a prepared payment or its retained status history. */
  getRgbPaymentOrigin = async (params: { transferId: string }) => {
    const { service } = await this.getLocalRgbReadService()
    return service.getTransferProviderOrigin(params.transferId)
  }

  /** Provider-facing signing data bound to a locally prepared RGB payment. */
  getRgbPaymentSigningData = async (params: { transferId: string; psbt?: string }) => {
    const { service } = await this.getLocalRgbService()
    const pending = service
      .getPendingTransfers()
      .find(transfer => transfer.id === params.transferId)
    if (!pending || pending.delivery || pending.broadcast) {
      throw new Error('RGB payment is not awaiting a signature')
    }
    const psbt = params.psbt ? psbtFromString(params.psbt).toHex() : pending.prepared.psbt
    const signingPsbt = bitcoin.Psbt.fromHex(psbt)
    if (params.psbt) {
      const prepared = bitcoin.Psbt.fromHex(pending.prepared.psbt)
      if (!sameUnsignedTransaction(signingPsbt, prepared)) {
        throw new Error('RGB swap PSBT changed the prepared transaction')
      }
    }
    if (
      signingPsbt.data.inputs.some(
        input =>
          input.sighashType !== undefined &&
          input.sighashType !== bitcoin.Transaction.SIGHASH_DEFAULT &&
          input.sighashType !== bitcoin.Transaction.SIGHASH_ALL
      )
    ) {
      throw new Error('RGB swap PSBT must use SIGHASH_ALL')
    }
    const toSignInputs = pending.prepared.toSignInputs.map(input => {
      const psbtInput = signingPsbt.data.inputs[input.index]
      if (!psbtInput) throw new Error('RGB signing input is missing from PSBT')
      psbtInput.sighashType = bitcoin.Transaction.SIGHASH_ALL
      return { ...input, sighashTypes: [bitcoin.Transaction.SIGHASH_ALL] }
    })
    return this.getRgbToSignData({
      psbt: signingPsbt.toHex(),
      toSignInputs,
      action: {
        name: 'Send RGB',
        description: '',
        type: PsbtActionType.CUSTOM,
      },
    })
  }

  /** Read-only local status for a dApp-created RGB payment. */
  getRgbPaymentStatus = async (params: { transferId: string }) => {
    const { service } = await this.getLocalRgbReadService()
    const pending = service
      .getPendingTransfers()
      .find(transfer => transfer.id === params.transferId)
    if (pending) {
      return {
        transferId: pending.id,
        assetId: pending.request.assetId,
        amount: pending.request.amount,
        txid: pending.delivery?.completed.txid ?? pending.broadcast?.completed.txid,
        status: pending.delivery?.requiresCounterpartySignature
          ? 'awaiting_buyer_signature'
          : pending.delivery?.externalBroadcast
            ? 'ready_for_dapp_finalize'
            : pending.delivery?.broadcastError
              ? 'broadcast_failed'
              : pending.delivery?.acknowledgedAt
                ? 'ready_to_broadcast'
                : pending.delivery
                  ? 'waiting_ack'
                  : pending.broadcast
                    ? 'broadcasted'
                    : 'prepared',
      }
    }
    const history = service
      .getPendingSendHistory()
      .find(item => item.transferId === params.transferId)
    if (!history) return { transferId: params.transferId, status: 'unknown' as const }
    return {
      transferId: history.transferId,
      assetId: history.assetId,
      amount: history.amount,
      txid: history.txid,
      status: history.status,
    }
  }

  retryRgbBroadcast = (params: { transferId: string }) =>
    this.rgbSendOperations.retryBroadcast(params.transferId)

  private syncRgbReceivedAllocations = async () => {
    const context = await this.getLocalRgbService()
    const funding = await this.getCurrentRgbFundingAccount()
    await this.assertActiveRgbWallet(context.wallet)
    if (funding.address !== context.wallet.fundingAddress) throw new RgbWalletContextChangedError()
    // This only migrates a missing key on invoices created by the first
    // witness-invoice build; acquire the normal writer fence before persisting.
    // A different device may still hold the lease immediately after handoff.
    // Reads must remain available in that window; the next receive poll will
    // retry the claim/index writes after the lease expires or is released.
    if (!(await this.tryEnsureRgbWriteLease(context, { forceRenew: true }))) {
      return context
    }
    await context.service.backfillWitnessReceivePublicKey(funding.publicKey)
    return this.rgbCoordinator.syncReceivedAllocations(context)
  }

  /** Deliver confirmed receive history through a durable, idempotent local outbox. */
  private syncRgbReceiveHistory = async (service: LocalRgbService, wallet: LocalRgbWallet) => {
    if (!(await this.tryEnsureRgbWriteLease({ service, wallet }))) return
    await this.rgbIndexerOutbox.syncReceiveHistory(service, wallet)
  }

  /** Retry durable local RGB allocations before allowing a remote snapshot to replace them. */
  private syncRgbIndexerOutbox = async (service: LocalRgbService, wallet: LocalRgbWallet) => {
    if (!(await this.tryEnsureRgbWriteLease({ service, wallet }))) return false
    return this.rgbIndexerOutbox.sync(service, wallet)
  }

  private syncRgbIssueToIndexer = async (
    issue: import('@unisat/rgb-service').RgbPendingIssue,
    wallet: LocalRgbWallet
  ) => {
    const lease = this.getRgbWriteLeaseCredential(wallet)
    await getRgbApiService().syncRgbAssetMetadata({
      wallet,
      ...(lease ? { lease } : {}),
      asset: { assetId: issue.assetId, ...issue.asset },
    })
    await getRgbApiService().syncRgbUtxos({
      address: wallet.fundingAddress,
      wallet,
      ...(lease ? { lease } : {}),
      txid: issue.utxoSync.txid,
      outpoints: toRgbIndexedUtxos(issue.utxoSync.outpoints),
    })
  }

  private syncRgbAssetMetadataToIndexer = async (
    item: import('@unisat/rgb-service').RgbPendingAssetMetadata,
    wallet: LocalRgbWallet
  ) => {
    const lease = this.getRgbWriteLeaseCredential(wallet)
    await getRgbApiService().syncRgbAssetMetadata({
      wallet,
      ...(lease ? { lease } : {}),
      asset: { assetId: item.assetId, ...item.metadata },
    })
  }

  private replaceRgbUtxosInIndexer = async (
    sync: import('@unisat/rgb-service').RgbPendingUtxoSync,
    wallet: LocalRgbWallet
  ) => {
    const lease = this.getRgbWriteLeaseCredential(wallet)
    await getRgbApiService().replaceRgbUtxos({
      address: wallet.fundingAddress,
      wallet,
      ...(lease ? { lease } : {}),
      txid: sync.txid,
      outpoints: toRgbIndexedUtxos(sync.outpoints),
    })
  }

  private syncRgbReceiveHistoryToIndexer = async (
    receive: import('@unisat/rgb-service').RgbPendingReceiveHistory,
    wallet: LocalRgbWallet
  ) => {
    const lease = this.getRgbWriteLeaseCredential(wallet)
    await getRgbApiService().syncRgbReceiveTransfer({
      wallet,
      ...(lease ? { lease } : {}),
      transferId: receive.transferId,
      assetId: receive.assetId,
      amount: receive.amount,
      txid: receive.txid,
      createdAt: receive.createdAt,
    })
  }

  /** Refresh colored UTXO chain state without polling receive consignments or proxy endpoints. */
  private syncRgbListState = async (previousList?: {
    currentPage: number
    pageSize: number
    total: number
    list: unknown
  }) => {
    if (!isWalletUnlocked()) return
    await this.rgbCoordinator.syncListState()
    if (!previousList) return

    const currentList = await this.getRgbAssetList(
      '',
      previousList.currentPage,
      previousList.pageSize
    )
    const previous = stableRgbJson({ total: previousList.total, list: previousList.list })
    const current = stableRgbJson({ total: currentList.total, list: currentList.list })
    if (previous === current) return

    bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
      method: BUS_METHODS.RGB_ASSETS_CHANGED,
      params: {},
    })
  }

  private syncRgbPendingTransfers = async (
    service: LocalRgbService,
    context: LocalRgbServiceContext
  ) => {
    // Transfer polling can deliver and broadcast a pending send. Revalidate
    // against the server on every such side-effecting attempt; a cached lease
    // may have been fenced by an explicit takeover on another device.
    if (!(await this.tryEnsureRgbWriteLease(context, { forceRenew: true }))) return
    log.debug(
      'RGB recovery: advancing restored pending transfers',
      rgbRecoveryServiceSummary(service)
    )
    await this.rgbCoordinator.syncPendingTransfers(service)
    log.debug(
      'RGB recovery: pending transfer advancement completed',
      rgbRecoveryServiceSummary(service)
    )
  }

  /** Exclude locally locked RGB UTXOs from the UI's spendable balance until a send completes. */
  private getRgbPendingLockedAmounts = () => this.rgbCoordinator.getPendingLockedAmounts()

  private applyRgbPendingLock<T extends { assetId?: string; spendable?: string | number }>(
    balance: T,
    lockedAmounts: Map<string, bigint>
  ) {
    const lockedAmount = balance.assetId ? lockedAmounts.get(balance.assetId) : undefined
    if (!lockedAmount || balance.spendable === undefined) return balance

    try {
      const spendable = BigInt(balance.spendable)
      return {
        ...balance,
        spendable: (spendable > lockedAmount ? spendable - lockedAmount : 0n).toString(),
        lockedAmount: lockedAmount.toString(),
      }
    } catch {
      return balance
    }
  }

  private rgbRecoveryKey = async (wallet: LocalRgbWallet) => {
    if (!isWalletUnlocked()) throw new RgbWalletLockedError()
    const context = bitcoin.crypto
      .sha256(Buffer.from(`unisat-rgb-recovery-v2:${wallet.network}:${wallet.fundingAddress}`))
      .toString('hex')
    const account = await this.getRgbAccountForWallet(wallet)
    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring?.getRgbFundingAccount || !keyring.deriveRgbRecoveryKey) {
      throw new Error('Current wallet does not support RGB recovery encryption')
    }
    const funding = keyring.getRgbFundingAccount(this.getNetworkType(), account.index)
    return keyring.deriveRgbRecoveryKey(
      funding.publicKey,
      chainTypeToCanonicalNetwork(this.getChainType()),
      context
    )
  }

  /** A domain-separated key for user-held files, never for backend checkpoints. */
  private rgbBackupKey = async (wallet: LocalRgbWallet) => {
    const context = bitcoin.crypto
      .sha256(Buffer.from(`unisat-rgb-export-v1:${wallet.network}:${wallet.fundingAddress}`))
      .toString('hex')
    const account = await this.getRgbAccountForWallet(wallet)
    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring?.getRgbFundingAccount || !keyring.deriveRgbRecoveryKey) {
      throw new Error('Current wallet does not support RGB backup encryption')
    }
    const funding = keyring.getRgbFundingAccount(this.getNetworkType(), account.index)
    return keyring.deriveRgbRecoveryKey(
      funding.publicKey,
      chainTypeToCanonicalNetwork(this.getChainType()),
      context
    )
  }

  private restoreRgbRecoveryIfNeeded = async (context: LocalRgbServiceContext) => {
    const { service, wallet } = context
    const key = `${wallet.network}:${wallet.fundingAddress}`
    if (this.rgbRecoveryVersions.has(key)) return
    const active = this.rgbRecoveryRestores.get(key)
    if (active) return active
    const restore = (async () => {
      let recoveryReady = false
      try {
        log.debug('RGB recovery: requesting checkpoint', { wallet: rgbRecoveryWalletTag(wallet) })
        const checkpoint = await getRgbApiService().getRgbRecoveryCheckpoint({ wallet })
        log.debug('RGB recovery: checkpoint response received', {
          wallet: rgbRecoveryWalletTag(wallet),
          hasPayload: Boolean(checkpoint.payload),
          updatedAt: checkpoint.updatedAt,
        })
        const needsRestore = service.needsRecoveryRestore?.()
        const localRevision = service.getRecoveryCheckpointRevision()
        const revisionChanged = localRevision !== checkpoint.revision
        const remoteCheckpointMissing =
          !checkpoint.payload &&
          checkpoint.updatedAt === undefined &&
          checkpoint.revision === undefined
        if (
          !needsRestore &&
          revisionChanged &&
          remoteCheckpointMissing &&
          localRevision !== undefined
        ) {
          // An explicitly empty remote response is not a newer checkpoint. It
          // can occur when recovery data was reset server-side. Re-establish
          // the backup from the complete local state, but only after holding
          // the writer lease so a concurrently active installation is never
          // overwritten.
          await this.ensureRgbWriteLease(context, {
            forceRenew: true,
            ignoreCheckpointRevision: true,
          })
          this.rgbRecoveryVersions.delete(key)
          await service.requeueRecoveryCheckpointAfterRemoteReset()
          log.warn('RGB recovery: remote checkpoint was empty; re-queuing local state', {
            wallet: rgbRecoveryWalletTag(wallet),
          })
        }
        let decryptedCheckpoint: unknown
        const decryptCheckpoint = async () => {
          if (decryptedCheckpoint !== undefined) return decryptedCheckpoint
          decryptedCheckpoint = await decryptRgbRecoveryCheckpoint(
            checkpoint.payload!,
            await this.rgbRecoveryKey(wallet)
          )
          return decryptedCheckpoint
        }
        const localCheckpointGeneration = service.getRecoveryCheckpointGeneration?.()
        const canAdoptNewerNormalCheckpoint =
          service.canAdoptNewerNormalRecoveryCheckpoint?.() === true
        const normalCheckpointAdvance =
          !needsRestore &&
          revisionChanged &&
          checkpoint.kind === 'normal' &&
          checkpoint.generation !== undefined &&
          localCheckpointGeneration !== undefined &&
          checkpoint.generation > localCheckpointGeneration &&
          canAdoptNewerNormalCheckpoint
        const shouldFastForward =
          !needsRestore && revisionChanged && Boolean(checkpoint.payload) && normalCheckpointAdvance
        if (!needsRestore && revisionChanged && !shouldFastForward && !remoteCheckpointMissing) {
          const matchesRemoteCheckpoint =
            Boolean(checkpoint.payload) &&
            service.matchesRecoveryState?.(await decryptCheckpoint()) === true
          if (matchesRemoteCheckpoint) {
            // The async checkpoint upload may have completed immediately
            // before a service-worker restart, leaving only its revision
            // unwritten locally. Its decrypted state proves this is not a
            // second-device conflict, so adopt the new revision below.
            log.debug('RGB recovery: local state matches newer checkpoint; adopting revision', {
              wallet: rgbRecoveryWalletTag(wallet),
              localRevisionKnown: localRevision !== undefined,
              remoteRevisionKnown: checkpoint.revision !== undefined,
            })
          } else {
            const localRecoveryState = service.exportRecoveryState?.()
            log.warn('RGB recovery: checkpoint revision conflicts with local state', {
              wallet: rgbRecoveryWalletTag(wallet),
              localRevisionKnown: localRevision !== undefined,
              remoteRevisionKnown: checkpoint.revision !== undefined,
              needsRestore,
              localGeneration: localCheckpointGeneration,
              remoteGeneration: checkpoint.generation,
              localCheckpointKind: service.getRecoveryCheckpointKind?.(),
              remoteCheckpointKind: checkpoint.kind,
              localCheckpoint: service.getRecoveryCheckpointStatus?.(),
              canAdoptNewerNormalCheckpoint,
              normalCheckpointAdvance,
              ...rgbRecoveryServiceSummary(service),
              differences: rgbRecoveryDifferenceFields(localRecoveryState, decryptedCheckpoint),
              changedSections: rgbRecoveryChangedSections(localRecoveryState, decryptedCheckpoint),
              invoices: rgbRecoveryInvoiceComparison(localRecoveryState, decryptedCheckpoint),
              remote: decryptedCheckpoint
                ? rgbRecoveryStateSummary(decryptedCheckpoint)
                : undefined,
            })
            await service.markRecoveryConflict()
            throw new Error('RGB recovery checkpoint has changed on another installation')
          }
        }
        if (checkpoint.payload && (needsRestore || shouldFastForward)) {
          const state = await decryptCheckpoint()
          log.debug('RGB recovery: checkpoint decrypted', {
            wallet: rgbRecoveryWalletTag(wallet),
            ...rgbRecoveryStateSummary(state),
          })
          const restored = await service.restoreRecoveryState(state)
          log.debug('RGB recovery: checkpoint restore result', {
            wallet: rgbRecoveryWalletTag(wallet),
            restored,
            ...rgbRecoveryServiceSummary(service),
          })
          if (!restored) {
            const recoveredWallet =
              state && typeof state === 'object'
                ? (state as { wallet?: Partial<LocalRgbWallet> }).wallet
                : undefined
            log.warn('RGB recovery checkpoint identity or structure mismatch', {
              expectedWalletId: wallet.walletId,
              recoveredWalletId: recoveredWallet?.walletId,
              expectedNetwork: wallet.network,
              recoveredNetwork: recoveredWallet?.network,
              fundingAddressMatches: recoveredWallet?.fundingAddress === wallet.fundingAddress,
            })
            throw new Error('RGB recovery checkpoint is invalid or belongs to another wallet')
          }
          if (shouldFastForward) {
            log.debug('RGB recovery: clean local state fast-forwarded to newer checkpoint', {
              wallet: rgbRecoveryWalletTag(wallet),
            })
          }
        }
        // A successful read with no checkpoint is also authoritative: this is
        // a new wallet and it is now safe to create its first checkpoint.
        recoveryReady = true
        this.rgbRecoveryVersions.set(key, {
          ...(checkpoint.updatedAt === undefined ? {} : { updatedAt: checkpoint.updatedAt }),
          ...(checkpoint.revision === undefined ? {} : { revision: checkpoint.revision }),
          ...(checkpoint.generation === undefined ? {} : { generation: checkpoint.generation }),
          ...(checkpoint.kind === undefined ? {} : { kind: checkpoint.kind }),
        })
        await service.setRecoveryCheckpointVersion(checkpoint.updatedAt)
        await service.setRecoveryCheckpointRevision(checkpoint.revision)
        await service.setRecoveryCheckpointGeneration(checkpoint.generation)
        await service.setRecoveryCheckpointKind(checkpoint.kind)
      } catch (error) {
        log.warn('Failed to restore RGB recovery checkpoint', error)
        // Do not enable writes after an unreadable request. Otherwise a fresh
        // local state can overwrite the only recoverable remote checkpoint as
        // soon as the service mutates.
        if (service.needsRecoveryRestore?.() || service.hasRecoveryConflict()) {
          await service.disableRecoveryBackup()
        }
        throw error
      }
      if (recoveryReady) {
        await service.enableRecoveryBackup()
        const recoveryStatus = service.getRecoveryCheckpointStatus()
        if (recoveryStatus.dirty || !recoveryStatus.verified) {
          try {
            await service.retryRecoveryCheckpoint()
          } catch (error) {
            log.warn('RGB recovery checkpoint retry failed', error)
          }
        }
        log.debug('RGB recovery: backup enabled', {
          wallet: rgbRecoveryWalletTag(wallet),
          ...rgbRecoveryServiceSummary(service),
        })
      }
    })()
    this.rgbRecoveryRestores.set(key, restore)
    try {
      await restore
    } finally {
      if (this.rgbRecoveryRestores.get(key) === restore) this.rgbRecoveryRestores.delete(key)
    }
  }

  /**
   * A user-initiated write must not rely on a revision cached from an earlier
   * read. Another installation may have published a checkpoint after this
   * background worker opened, while the cached writer lease remains valid.
   */
  private refreshRgbRecoveryForWrite = async (context: LocalRgbServiceContext) => {
    const key = `${context.wallet.network}:${context.wallet.fundingAddress}`
    this.rgbRecoveryVersions.delete(key)
    await this.restoreRgbRecoveryIfNeeded(context)
    if (!context.service.isRecoveryBackupEnabled()) {
      throw new Error('RGB recovery service is unavailable; retry when the backend is reachable')
    }
  }

  private queueRgbRecoveryCheckpoint = (
    wallet: LocalRgbWallet,
    state: unknown,
    context: {
      reason: 'state_change' | 'retry_dirty' | 'retry_unverified'
      kind: 'normal' | 'replacement'
    }
  ) => {
    const key = `${wallet.network}:${wallet.fundingAddress}`
    const diagnostic = {
      wallet: rgbRecoveryWalletTag(wallet),
      reason: context.reason,
      kind: context.kind,
      fingerprint: bitcoin.crypto
        .sha256(Buffer.from(stableRgbJson(state)))
        .toString('hex')
        .slice(0, 16),
      ...rgbRecoveryStateSummary(state),
    }
    // A replacement with identical encrypted state is still a meaningful
    // publication: it records a user-confirmed overwrite and must not be
    // deduplicated with a prior normal checkpoint.
    const diagnosticFingerprint = `${context.kind}:${diagnostic.fingerprint}`
    log.debug('RGB recovery: checkpoint queued', diagnostic)
    const previous = this.rgbRecoveryBackups.get(key) || Promise.resolve()
    const backup = previous
      .catch(() => undefined)
      .then(async () => {
        await this.assertRgbRecoveryWallet(wallet)
        const verifiedFingerprint = this.rgbRecoveryVerifiedFingerprints.get(key)
        if (verifiedFingerprint === diagnosticFingerprint) {
          const version = this.rgbRecoveryVersions.get(key)
          return {
            saved: true,
            ...(version?.updatedAt === undefined ? {} : { updatedAt: version.updatedAt }),
            ...(version?.revision ? { revision: version.revision } : {}),
            ...(version?.generation === undefined ? {} : { generation: version.generation }),
            ...(version?.kind === undefined ? {} : { kind: version.kind }),
            verified: true,
          }
        }
        const payload = await encryptRgbRecoveryCheckpoint(state, await this.rgbRecoveryKey(wallet))
        const checksum = await rgbRecoveryPayloadChecksum(payload)
        await this.assertRgbRecoveryWallet(wallet)
        let expected = this.rgbRecoveryVersions.get(key)
        // The backend deliberately rejects a replacement without a CAS
        // baseline. The cached version may have been cleared by a background
        // restart or lock while an explicit conflict/backup replacement was
        // queued, so refresh it immediately before publishing.
        if (
          context.kind === 'replacement' &&
          expected?.revision === undefined &&
          expected?.updatedAt === undefined
        ) {
          const checkpoint = await getRgbApiService().getRgbRecoveryCheckpoint({ wallet })
          await this.assertRgbRecoveryWallet(wallet)
          if (checkpoint.revision === undefined && checkpoint.updatedAt === undefined) {
            throw new Error('RGB recovery replacement requires an existing cloud checkpoint')
          }
          expected = {
            ...(checkpoint.updatedAt === undefined ? {} : { updatedAt: checkpoint.updatedAt }),
            ...(checkpoint.revision === undefined ? {} : { revision: checkpoint.revision }),
            ...(checkpoint.generation === undefined ? {} : { generation: checkpoint.generation }),
            ...(checkpoint.kind === undefined ? {} : { kind: checkpoint.kind }),
          }
          this.rgbRecoveryVersions.set(key, expected)
        }
        const updatedAt = Math.max(this.getRgbNow(), (expected?.updatedAt ?? -1) + 1)
        const api = getRgbApiService()
        const activeLease = this.getRgbActiveWriteLease(wallet)
        const lease = activeLease
          ? {
              deviceId: activeLease.deviceId,
              leaseId: activeLease.leaseId,
              fencingToken: activeLease.fencingToken,
            }
          : undefined
        let result:
          | {
              saved: boolean
              updatedAt: number
              revision?: string
              generation?: number
              kind?: 'normal' | 'replacement'
            }
          | undefined
        if (payload.length <= RGB_RECOVERY_PAYLOAD_PART_SIZE) {
          // The normal checkpoint fits in one JSON request. The endpoint
          // atomically replaces the encrypted payload with the same revision
          // CAS as the resumable flow, avoiding start/part/complete/read.
          result = await api.saveRgbRecoveryCheckpoint({
            wallet,
            ...(lease ? { lease } : {}),
            payload,
            ...(expected?.updatedAt === undefined ? {} : { expectedUpdatedAt: expected.updatedAt }),
            ...(expected?.revision === undefined ? {} : { expectedRevision: expected.revision }),
            kind: context.kind,
            updatedAt,
          })
        } else {
          const partCount = Math.ceil(payload.length / RGB_RECOVERY_PAYLOAD_PART_SIZE)
          const { uploadId } = await api.startRgbRecoveryCheckpointUpload({
            wallet,
            ...(lease ? { lease } : {}),
            partCount,
            totalLength: payload.length,
            checksum,
            ...(expected?.updatedAt === undefined ? {} : { expectedUpdatedAt: expected.updatedAt }),
            ...(expected?.revision === undefined ? {} : { expectedRevision: expected.revision }),
            kind: context.kind,
            updatedAt,
          })
          let receivedIndexes = new Set<number>()
          for (let index = 0; index < partCount; index++) {
            if (receivedIndexes.has(index)) continue
            const payloadPart = payload.slice(
              index * RGB_RECOVERY_PAYLOAD_PART_SIZE,
              (index + 1) * RGB_RECOVERY_PAYLOAD_PART_SIZE
            )
            try {
              await api.uploadRgbRecoveryCheckpointPart({
                wallet,
                ...(lease ? { lease } : {}),
                uploadId,
                index,
                payload: payloadPart,
              })
            } catch (error) {
              const status = await api
                .getRgbRecoveryCheckpointUploadStatus({ wallet, uploadId })
                .catch(() => undefined)
              if (!status || status.status !== 'pending') throw error
              receivedIndexes = new Set(status.receivedIndexes || [])
              if (!receivedIndexes.has(index)) throw error
            }
          }
          try {
            result = await api.completeRgbRecoveryCheckpointUpload({
              wallet,
              ...(lease ? { lease } : {}),
              uploadId,
            })
          } catch (error) {
            let completionError = error
            for (let attempt = 0; attempt < 7; attempt++) {
              const status = await api
                .getRgbRecoveryCheckpointUploadStatus({ wallet, uploadId })
                .catch(() => undefined)
              if (status?.status === 'completed') {
                result = {
                  saved: status.saved === true,
                  updatedAt: status.updatedAt,
                  ...(status.revision ? { revision: status.revision } : {}),
                  ...(status.generation === undefined ? {} : { generation: status.generation }),
                  ...(status.kind === undefined ? {} : { kind: status.kind }),
                }
                break
              }
              // Do not mistake a timeout/concurrent complete for a failed
              // checkpoint. The server holds a durable publishing lease and a
              // later complete retry either resumes it or returns its result.
              if (status?.status !== 'publishing') throw completionError
              await new Promise<void>(resolve => setTimeout(resolve, 5_000))
              try {
                result = await api.completeRgbRecoveryCheckpointUpload({
                  wallet,
                  ...(lease ? { lease } : {}),
                  uploadId,
                })
                break
              } catch (retryError) {
                completionError = retryError
              }
            }
            if (!result) throw completionError
          }
        }
        if (!result) throw new Error('RGB recovery checkpoint completion did not return a result')
        this.rgbRecoveryVersions.set(key, {
          updatedAt: result.updatedAt,
          ...(result.revision ? { revision: result.revision } : {}),
          ...(result.generation === undefined ? {} : { generation: result.generation }),
          ...(result.kind === undefined ? {} : { kind: result.kind }),
        })
        if (!result.saved) return result
        // The API atomically commits the encrypted payload after its CAS (and
        // verifies the checksum for multipart uploads). Local encryption has
        // already succeeded, so a read-back only adds latency to every send.
        const verifiedRevision = result.revision
        this.rgbRecoveryVerifiedFingerprints.set(key, diagnosticFingerprint)
        this.rgbRecoveryVersions.set(key, {
          updatedAt: result.updatedAt,
          ...(verifiedRevision ? { revision: verifiedRevision } : {}),
          ...(result.generation === undefined ? {} : { generation: result.generation }),
          ...(result.kind === undefined ? {} : { kind: result.kind }),
        })
        log.debug('RGB recovery: checkpoint saved', diagnostic)
        return {
          ...result,
          ...(verifiedRevision ? { revision: verifiedRevision } : {}),
          ...(result.generation === undefined ? {} : { generation: result.generation }),
          ...(result.kind === undefined ? {} : { kind: result.kind }),
          verified: true,
          checksum,
          totalLength: payload.length,
        }
      })
    this.rgbRecoveryBackups.set(key, backup)
    void backup.catch(error => {
      if (isRgbWalletContextCancellation(error)) return
      log.warn('RGB recovery: checkpoint save failed', diagnostic, error)
    })
    return backup
  }

  /** Open encrypted local RGB state for read-only UI queries. */
  private getLocalRgbReadService = async (): Promise<LocalRgbServiceContext> => {
    await this.assertRgbFeatureEnabled()
    const context = await this.rgbServiceRegistry.get()
    // Recovery authenticates remote state before enabling writes, but must
    // never hold up a local list, balance, or detail response.
    void this.restoreRgbRecoveryIfNeeded(context).catch(error => {
      log.warn('Failed to start RGB recovery checkpoint restore', error)
    })
    return context
  }

  /** Open RGB state for operations that may mutate it or write to the backend. */
  private getLocalRgbService = async (): Promise<LocalRgbServiceContext> => {
    await this.assertRgbFeatureEnabled()
    const context = await this.rgbServiceRegistry.get()
    // Unlike UI reads, mutations must wait until recovery has established the
    // checkpoint revision used for safe writes.
    await this.restoreRgbRecoveryIfNeeded(context)
    if (!context.service.isRecoveryBackupEnabled()) {
      throw new Error('RGB recovery service is unavailable; retry when the backend is reachable')
    }
    return context
  }

  private getLocalRgbServiceForWallet = async (
    wallet: LocalRgbWallet
  ): Promise<LocalRgbServiceContext> => {
    if (!(await this.isRgbFeatureEnabled(wallet))) {
      throw new Error('RGB is not enabled for this wallet. Enable RGB before continuing.')
    }
    const context = await this.rgbServiceRegistry.get(wallet)
    await this.restoreRgbRecoveryIfNeeded(context)
    if (!context.service.isRecoveryBackupEnabled()) {
      throw new Error('RGB recovery service is unavailable; retry when the backend is reachable')
    }
    return context
  }

  private rgbWriteLeaseKey(wallet: Pick<LocalRgbWallet, 'network' | 'fundingAddress'>) {
    return `${wallet.network}:${wallet.fundingAddress}`
  }

  private getRgbActiveWriteLease(wallet: RgbWalletRef): RgbControllerWriteLease | undefined {
    if (!wallet.network) return undefined
    const lease = this.rgbWriteLeases.get(`${wallet.network}:${wallet.fundingAddress}`)
    return lease && lease.expiresAt > this.getRgbNow() ? lease : undefined
  }

  private getRgbWriteLeaseCredential(
    wallet: RgbWalletRef
  ): RgbControllerWriteLeaseCredential | undefined {
    const lease = this.getRgbActiveWriteLease(wallet)
    return lease
      ? {
          deviceId: lease.deviceId,
          leaseId: lease.leaseId,
          fencingToken: lease.fencingToken,
        }
      : undefined
  }

  private async getRgbDeviceId() {
    const existing = await keyringService.getEncryptedStorageItem<string>(
      RGB_ENCRYPTED_STORAGE_NAMESPACE,
      RGB_DEVICE_ID_STORAGE_KEY
    )
    if (typeof existing === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing
    const deviceId = globalThis.crypto.randomUUID().replace(/-/g, '')
    await keyringService.setEncryptedStorageItem(
      RGB_ENCRYPTED_STORAGE_NAMESPACE,
      RGB_DEVICE_ID_STORAGE_KEY,
      deviceId
    )
    return deviceId
  }

  /** Acquire/refresh the server-enforced single-writer lease before preparing a send. */
  private async ensureRgbWriteLease(
    context: LocalRgbServiceContext,
    options: { takeover?: boolean; forceRenew?: boolean; ignoreCheckpointRevision?: boolean } = {}
  ): Promise<void> {
    const key = this.rgbWriteLeaseKey(context.wallet)
    const existing = this.rgbWriteLeases.get(key)
    // Reserve enough time for the preflight and local encoder; a later phase
    // renews this lease while a hardware signer is awaiting user confirmation.
    if (!options.forceRenew && existing && existing.expiresAt > this.getRgbNow() + 30_000) return
    // A user-requested takeover must retain its own server request and never
    // be silently folded into an ordinary background refresh.
    if (options.takeover) return this.ensureRgbWriteLeaseOnce(context, options)
    const inFlight = this.rgbWriteLeaseEnsures.get(key)
    if (inFlight) return inFlight

    const ensure = this.ensureRgbWriteLeaseOnce(context, options)
    this.rgbWriteLeaseEnsures.set(key, ensure)
    try {
      await ensure
    } finally {
      if (this.rgbWriteLeaseEnsures.get(key) === ensure) this.rgbWriteLeaseEnsures.delete(key)
    }
  }

  private async ensureRgbWriteLeaseOnce(
    context: LocalRgbServiceContext,
    options: { takeover?: boolean; forceRenew?: boolean; ignoreCheckpointRevision?: boolean }
  ): Promise<void> {
    const key = this.rgbWriteLeaseKey(context.wallet)
    const existing = this.rgbWriteLeases.get(key)
    const deviceId = await this.getRgbDeviceId()
    let ignoreCheckpointRevision = options.ignoreCheckpointRevision === true
    if (existing && existing.expiresAt > this.getRgbNow()) {
      try {
        const renewed = await getRgbApiService().renewRgbWriteLease({
          wallet: context.wallet,
          deviceId: existing.deviceId,
          leaseId: existing.leaseId,
          fencingToken: existing.fencingToken,
        })
        this.rgbWriteLeases.set(key, { deviceId: existing.deviceId, ...renewed })
        return
      } catch (error) {
        if (!String(error).includes('RGB write lease is unavailable')) throw error
        // A recovery-data reset can remove the server lease while this
        // service worker still has a valid-looking local lease cache. Confirm
        // that the checkpoint is also absent before replacing both bases.
        this.rgbWriteLeases.delete(key)
        try {
          const checkpoint = await getRgbApiService().getRgbRecoveryCheckpoint({
            wallet: context.wallet,
          })
          const remoteCheckpointMissing =
            !checkpoint.payload &&
            checkpoint.updatedAt === undefined &&
            checkpoint.revision === undefined
          if (
            remoteCheckpointMissing &&
            context.service.getRecoveryCheckpointRevision?.() !== undefined
          ) {
            this.rgbRecoveryVersions.delete(key)
            await context.service.requeueRecoveryCheckpointAfterRemoteReset()
            ignoreCheckpointRevision = true
          }
        } catch {
          // A lease disappearance alone can result from expiry. Fall through
          // to a regular acquire when checkpoint inspection is unavailable.
        }
      }
    }
    let lease: { leaseId: string; fencingToken: number; expiresAt: number }
    try {
      lease = await getRgbApiService().acquireRgbWriteLease({
        wallet: context.wallet,
        deviceId,
        ...(!ignoreCheckpointRevision && context.service.getRecoveryCheckpointRevision?.()
          ? { checkpointRevision: context.service.getRecoveryCheckpointRevision?.() }
          : {}),
        ...(options.takeover ? { takeover: true } : {}),
      })
    } catch (error) {
      // A newer device may have committed after this device's restore read.
      // Drop the cached read so the next explicit operation re-reads and,
      // when clean, fast-forwards to that checkpoint rather than writing stale
      // state under a newly acquired lease.
      if (String(error).includes('checkpoint revision is stale')) {
        this.rgbRecoveryVersions.delete(key)
      }
      throw error
    }
    this.rgbWriteLeases.set(key, { deviceId, ...lease })
  }

  private async releaseRgbWriteLeaseForWallet(
    wallet: LocalRgbWallet
  ): Promise<{ released: boolean }> {
    const key = this.rgbWriteLeaseKey(wallet)
    const lease = this.getRgbActiveWriteLease(wallet)
    if (!lease) return { released: false }
    const result = await getRgbApiService().releaseRgbWriteLease({
      wallet,
      deviceId: lease.deviceId,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
    })
    this.rgbWriteLeases.delete(key)
    return result
  }

  /** Lock is best-effort: a network failure falls back to the short server TTL. */
  private async releaseAllRgbWriteLeases(): Promise<void> {
    const leases = [...this.rgbWriteLeases.entries()]
    await Promise.all(
      leases.map(async ([key, lease]) => {
        const separator = key.indexOf(':')
        if (separator < 1) return
        const wallet = {
          network: key.slice(0, separator) as RgbNetwork,
          fundingAddress: key.slice(separator + 1),
        } as LocalRgbWallet
        try {
          await getRgbApiService().releaseRgbWriteLease({
            wallet,
            deviceId: lease.deviceId,
            leaseId: lease.leaseId,
            fencingToken: lease.fencingToken,
          })
        } catch (error) {
          log.debug('Failed to release RGB write lease while locking', error)
        }
      })
    )
  }

  /** A lease failure makes this installation read-only; local state remains available. */
  private async tryEnsureRgbWriteLease(
    context: LocalRgbServiceContext,
    options: { forceRenew?: boolean } = {}
  ): Promise<boolean> {
    // Production LocalRgbWallets always have a network. Retain the existing
    // no-lease behavior for compatibility hosts that only expose an address.
    if (!context.wallet.network) return true
    try {
      await this.ensureRgbWriteLease(context, options)
      return true
    } catch (error) {
      if (String(error).includes('RGB lease checkpoint revision is stale')) {
        try {
          // The checkpoint may have finished uploading after our last read.
          // Reconcile it before retrying; never acquire against a revision we
          // have not authenticated or overwrite divergent local state.
          await this.refreshRgbRecoveryForWrite(context)
          await this.ensureRgbWriteLease(context, options)
          return true
        } catch (retryError) {
          log.warn('RGB checkpoint reconciliation blocked background synchronization', retryError)
          return false
        }
      }
      log.debug('RGB index write deferred because another device holds the lease', error)
      return false
    }
  }

  private getCurrentLocalRgbWallet = async (): Promise<LocalRgbWallet> => {
    const wallet = await this.getCurrentRgbWalletRef()
    if (!wallet.walletId || !wallet.network) throw new Error('RGB wallet context is incomplete')
    return {
      ...wallet,
      walletId: wallet.walletId,
      network: wallet.network as RgbNetwork,
    }
  }

  /** Stop stale asynchronous work before it can borrow another wallet's keys or network. */
  private assertActiveRgbWallet = async (expected: LocalRgbWallet): Promise<void> => {
    if (!isWalletUnlocked()) throw new RgbWalletLockedError()
    let active: LocalRgbWallet
    try {
      active = await this.getCurrentLocalRgbWallet()
    } catch (error) {
      if (!isWalletUnlocked()) throw new RgbWalletLockedError()
      throw error
    }
    // Some compatibility hosts expose only a funding address. Production
    // contexts include all three fields, so every available identity field is
    // still checked without weakening older embeddings.
    if (
      active.fundingAddress !== expected.fundingAddress ||
      (expected.walletId && active.walletId !== expected.walletId) ||
      (expected.network && active.network !== expected.network)
    ) {
      throw new RgbWalletContextChangedError()
    }
  }

  private createLocalRgbService = (localWallet: LocalRgbWallet): LocalRgbService => {
    const networkType = this.getNetworkType()
    const chainType = this.getChainType()
    let service: LocalRgbService | undefined
    service = createRgbService({
      storage: {
        get: key => keyringService.getEncryptedStorageItem(RGB_ENCRYPTED_STORAGE_NAMESPACE, key),
        set: (key, value) =>
          keyringService.setEncryptedStorageItem(RGB_ENCRYPTED_STORAGE_NAMESPACE, key, value),
        remove: key =>
          keyringService.removeEncryptedStorageItem(RGB_ENCRYPTED_STORAGE_NAMESPACE, key),
      },
      stateSource: createRgbBackendAdapter({
        api: getRgbApiService() as RgbBackendApi,
        getActiveWriteLease: wallet => this.getRgbActiveWriteLease(wallet),
      }),
      feeSource: {
        getFeeFunding: async () => {
          await this.assertActiveRgbWallet(localWallet)
          const feeAccount = await this.getCurrentRgbFeeAccount()
          await this.assertActiveRgbWallet(localWallet)
          const remoteUtxos = await walletApiService.bitcoin.getAllBTCUtxos(feeAccount.address)
          await this.assertActiveRgbWallet(localWallet)
          const pendingUtxos = service?.getPendingFeePoolUtxos() || []
          const feeUtxosByOutpoint = new Map(
            remoteUtxos
              .filter(utxo => !utxo.inscriptions?.length && !utxo.atomicals?.length)
              .map(utxo => [
                `${utxo.txid}:${utxo.vout}`,
                {
                  outpoint: { txid: utxo.txid, vout: utxo.vout },
                  satoshis: utxo.satoshis,
                  scriptPubKey: utxo.scriptPk,
                  publicKey: feeAccount.publicKey,
                },
              ])
          )
          pendingUtxos.forEach(utxo => {
            const key = `${utxo.outpoint.txid}:${utxo.outpoint.vout}`
            if (!feeUtxosByOutpoint.has(key)) feeUtxosByOutpoint.set(key, utxo)
          })
          return {
            utxos: [...feeUtxosByOutpoint.values()],
            changeScriptPubKey: bitcoin.address
              .toOutputScript(feeAccount.address, toPsbtNetwork(networkType))
              .toString('hex'),
            changeDustLimit: decodeAddress(feeAccount.address).dust,
          }
        },
      },
      encoder: localNiaProtocolEncoder,
      transport: createRgbProxyTransport(CHAINS_MAP[chainType]?.rgbProxyEndpoints || []),
      broadcaster: {
        broadcast: async rawTx => {
          await this.assertActiveRgbWallet(localWallet)
          const txid = await this.pushTx(rawTx)
          await this.assertActiveRgbWallet(localWallet)
          return txid
        },
      },
      now: () => this.getRgbNow(),
      onStatePersisted: (state, context) =>
        this.queueRgbRecoveryCheckpoint(localWallet, state, context),
    })
    return service
  }

  getRgbToSignData = async ({
    psbt,
    toSignInputs,
    action,
    expectedWallet,
  }: RgbSignPsbtRequest & {
    action?: PsbtActionInfo
    expectedWallet?: LocalRgbWallet
  }): Promise<ToSignData> => {
    if (expectedWallet) await this.assertActiveRgbWallet(expectedWallet)
    const parsedPsbt = await this.attachRgbPsbtDerivations(psbtFromString(psbt), expectedWallet)
    const resolvedToSignInputs = toSignInputs || (await this.getRgbToSignInputs(parsedPsbt))
    if (expectedWallet) await this.assertActiveRgbWallet(expectedWallet)
    if (resolvedToSignInputs.length === 0) {
      throw new Error('No RGB PSBT inputs can be signed by this wallet')
    }

    return {
      psbtHex: parsedPsbt.toHex(),
      toSignInputs: resolvedToSignInputs,
      autoFinalized: resolvedToSignInputs.length === parsedPsbt.inputCount,
      action: action
        ? action
        : {
            name: 'Sign RGB PSBT',
            description: '',
            type: PsbtActionType.CUSTOM,
          },
    }
  }

  /** Add only the current account's local RGB derivation to wallet-built PSBTs. */
  private attachRgbPsbtDerivations = async (
    psbt: bitcoin.Psbt,
    expectedWallet?: LocalRgbWallet,
    signingAccount?: Account
  ) => {
    if (expectedWallet) await this.assertActiveRgbWallet(expectedWallet)
    const accounts = signingAccount
      ? await (async () => {
          const keyring = await keyringService.getKeyringForAccount(signingAccount.pubkey, signingAccount.type)
          if (!keyring?.getRgbFundingAccount || !keyring.getRgbFeeAccount) {
            throw new Error('RGB signing account is unavailable')
          }
          return [
            keyring.getRgbFundingAccount(this.getNetworkType(), signingAccount.index),
            keyring.getRgbFeeAccount(this.getNetworkType(), signingAccount.index),
          ]
        })()
      : await Promise.all([this.getCurrentRgbFundingAccount(), this.getCurrentRgbFeeAccount()])
    if (expectedWallet) await this.assertActiveRgbWallet(expectedWallet)
    const networkType = this.getNetworkType()
    for (const account of accounts) {
      const internalKey = Buffer.from(account.publicKey, 'hex').subarray(1)
      const expectedScript = bitcoin.payments.p2tr({
        internalPubkey: internalKey,
        network: toPsbtNetwork(networkType),
      }).output
      if (!expectedScript) throw new Error('Unable to derive RGB signing script')

      psbt.data.inputs.forEach((input: any) => {
        if (
          !input.witnessUtxo ||
          (input.tapInternalKey && !input.tapInternalKey.equals(internalKey)) ||
          !input.witnessUtxo.script.equals(expectedScript)
        )
          return
        input.tapInternalKey = internalKey
        input.tapBip32Derivation = [
          {
            masterFingerprint: Buffer.from(account.masterFingerprint, 'hex'),
            path: account.derivationPath,
            pubkey: internalKey,
            leafHashes: [],
          },
        ]
      })
    }
    return psbt
  }

  private getRgbToSignInputs = async (psbt: bitcoin.Psbt, signingAccount?: Account): Promise<ToSignInput[]> => {
    const account = signingAccount ?? preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring?.getRgbFundingAccount || !keyring.getRgbFeeAccount) {
      throw new Error('Current wallet does not support RGB PSBT signing')
    }

    const networkType = this.getNetworkType()
    const rgbAccounts = [
      keyring.getRgbFundingAccount(networkType, account.index),
      keyring.getRgbFeeAccount(networkType, account.index),
    ]

    const toSignInputs: ToSignInput[] = []
    psbt.data.inputs.forEach((input: any, index) => {
      const isSigned =
        input.finalScriptSig ||
        input.finalScriptWitness ||
        input.tapKeySig ||
        input.partialSig ||
        input.tapScriptSig
      if (isSigned) return

      const tapDerivation = input.tapBip32Derivation?.[0]
      if (
        tapDerivation?.pubkey &&
        rgbAccounts.some(item => this.isCurrentRgbDerivation(tapDerivation, item))
      ) {
        const leafHashes = tapDerivation.leafHashes || []
        const toSignInput: ToSignInput = {
          index,
          publicKey: Buffer.from(tapDerivation.pubkey).toString('hex'),
          sighashTypes: input.sighashType ? [input.sighashType] : undefined,
          useTweakedSigner: leafHashes.length === 0,
        }
        if (leafHashes[0]) {
          toSignInput.tapLeafHashToSign = Buffer.from(leafHashes[0]).toString('hex')
        }
        toSignInputs.push(toSignInput)
        return
      }

      const derivation = input.bip32Derivation?.[0]
      if (
        derivation?.pubkey &&
        rgbAccounts.some(item => this.isCurrentRgbDerivation(derivation, item))
      ) {
        toSignInputs.push({
          index,
          publicKey: Buffer.from(derivation.pubkey).toString('hex'),
          sighashTypes: input.sighashType ? [input.sighashType] : undefined,
        })
      }
    })

    return toSignInputs
  }

  private isCurrentRgbDerivation(
    derivation: any,
    funding: { publicKey: string; derivationPath: string; masterFingerprint: string }
  ) {
    const fingerprint = normalizeRgbDerivationHex(derivation?.masterFingerprint)
    if (fingerprint !== funding.masterFingerprint.toLowerCase()) {
      return false
    }

    const path = derivation?.path
    if (
      !path ||
      normalizeRgbDerivationPath(path) !== normalizeRgbDerivationPath(funding.derivationPath)
    ) {
      return false
    }

    const pubkey = normalizeRgbDerivationHex(derivation.pubkey)
    const compressed = funding.publicKey.toLowerCase()
    return pubkey === compressed || pubkey === compressed.slice(2)
  }

  createSendRunesPsbt = async ({
    to,
    runeid,
    runeAmount,
    feeRate,
    btcUtxos,
    assetUtxos,
    outputValue,
    enableRBF = true,
  }: {
    to: string
    runeid: string
    runeAmount: string
    feeRate?: number
    btcUtxos?: UnspentOutput[]
    assetUtxos?: UnspentOutput[]
    outputValue?: number
    enableRBF?: boolean
  }): Promise<ToSignData> => {
    if (feeRate !== undefined) assertValidFeeRate(feeRate, { supportLowFeeMode: true })
    runeAmount = paramsUtils.formatAmount(runeAmount)
    if (!/^[1-9]\d*$/.test(runeAmount)) {
      throw new Error('Rune amount must be a positive integer')
    }

    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    const networkType = this.getNetworkType()

    if (!assetUtxos) {
      assetUtxos = await this.getAssetUtxosRunes(runeid)
    }

    if (feeRate === undefined) {
      const feeSummary = await this.getFeeSummary()
      feeRate = feeSummary.list[1]?.feeRate! // use normal fee rate
    }
    feeRate = assertValidFeeRate(feeRate, { supportLowFeeMode: true })

    const _assetUtxos: UnspentOutput[] = []

    // find the utxo that has the exact amount to split
    for (let i = 0; i < assetUtxos!.length; i++) {
      const v = assetUtxos![i]!
      if (v.runes && v.runes.length > 1) {
        const balance = v.runes.find(r => r.runeid == runeid)
        if (balance && balance.amount == runeAmount) {
          _assetUtxos.push(v)
          break
        }
      }
    }

    if (_assetUtxos.length == 0) {
      for (let i = 0; i < assetUtxos!.length; i++) {
        const v = assetUtxos![i]!
        if (v.runes) {
          const balance = v.runes.find(r => r.runeid == runeid)
          if (balance && balance.amount == runeAmount) {
            _assetUtxos.push(v)
            break
          }
        }
      }
    }

    if (_assetUtxos.length == 0) {
      let total = BigInt(0)
      for (let i = 0; i < assetUtxos!.length; i++) {
        const v = assetUtxos![i]!
        v.runes?.forEach(r => {
          if (r.runeid == runeid) {
            total = total + BigInt(r.amount)
          }
        })
        _assetUtxos.push(v)
        if (total >= BigInt(runeAmount)) {
          break
        }
      }
    }

    assetUtxos = _assetUtxos

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos()
    }

    const { psbt, toSignInputs } = await txHelpers.sendRunes({
      assetUtxos,
      assetAddress: account.address,
      btcUtxos: btcUtxos!,
      btcAddress: account.address,
      toAddress: to,
      networkType,
      feeRate,
      runeid,
      runeAmount,
      outputValue: outputValue || UTXO_DUST,
      enableRBF,
    })

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
      action: {
        name: t('send_runes'),
        description: '',
        details: [
          {
            label: t('to'),
            type: PsbtActionDetailType.ADDRESS,
            value: to,
          },
          {
            label: t('runes'),
            type: PsbtActionDetailType.RUNES,
            value: {
              runeid,
              runeAmount,
            },
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  getToSignData = async ({
    psbtHex,
    options,
    action,
  }: {
    psbtHex: string
    options?: SignPsbtOptions
    action?: PsbtActionInfo
  }): Promise<ToSignData> => {
    const toSignInputs = await this.formatOptionsToSignInputs(psbtHex, options)
    const result = await this.formatPsbt(
      bitcoin.Psbt.fromHex(psbtHex),
      toSignInputs,
      options?.autoFinalized
    )
    return {
      psbtHex: result.psbt.toHex(),
      toSignInputs: result.toSignInputs,
      autoFinalized: result.autoFinalized,
      action: action
        ? action
        : {
            name: '',
            description: '',
            type: PsbtActionType.DEFAULT,
          },
    }
  }

  getSignedResult = async (psbt: bitcoin.Psbt, toSignInputs: ToSignInput[]) => {
    this.setPsbtSignNonSegwitEnable(psbt, true)
    await this._signPsbt(psbt, toSignInputs, true)
    this.setPsbtSignNonSegwitEnable(psbt, false)

    const psbtHex = psbt.toHex()
    let rawtx = ''
    let fee = 0
    try {
      rawtx = psbt.extractTransaction(true).toHex()
      fee = psbt.getFee()
    } catch (e) {
      // ignore
    }

    return {
      psbtHex,
      rawtx,
      fee,
    }
  }

  getAutoLockTimeId = async () => {
    return preferenceService.getAutoLockTimeId()
  }

  getRgbInvoiceExpirySeconds = async () => {
    return preferenceService.getRgbInvoiceExpirySeconds()
  }

  setRgbInvoiceExpirySeconds = async (seconds: number) => {
    if (![0, 60 * 60, 24 * 60 * 60, 7 * 24 * 60 * 60].includes(seconds)) {
      throw new Error('Invalid RGB invoice expiry')
    }
    preferenceService.setRgbInvoiceExpirySeconds(seconds)
  }

  setAutoLockTimeId = async (timeId: number) => {
    preferenceService.setAutoLockTimeId(timeId)
    this._resetTimeout()
  }

  getOpenInSidePanel = async () => {
    return preferenceService.getOpenInSidePanel()
  }

  getDeveloperMode = async () => {
    return preferenceService.getDeveloperMode()
  }

  setDeveloperMode = async (developerMode: boolean) => {
    preferenceService.setDeveloperMode(developerMode)
  }

  setOpenInSidePanel = async (openInSidePanel: boolean) => {
    preferenceService.setOpenInSidePanel(openInSidePanel)

    try {
      const chromeWithSidePanel = chrome as any
      if (chromeWithSidePanel.sidePanel) {
        chromeWithSidePanel.sidePanel.setPanelBehavior({ openPanelOnActionClick: openInSidePanel })
      }
    } catch (error) {
      console.error('Failed to update side panel behavior:', error)
    }
  }

  setLastActiveTime = async () => {
    this._resetTimeout()
  }

  private _resetTimeout = () => {
    if (this.timer) {
      clearTimeout(this.timer)
    }

    const timeId = preferenceService.getAutoLockTimeId()
    const timeConfig = getLockTimeInfo(timeId)
    this.timer = setTimeout(() => {
      this.lockWallet()
      bgEventBus.emit(BUS_EVENTS.broadcastToUI, {
        method: BUS_METHODS.AUTO_LOCKED,
        params: {},
      })
    }, timeConfig.time)
  }

  getAppList = async () => {
    const data = await walletApiService.utility.getAppList()
    return data
  }

  getAppExtra = async (id: string | number, locale?: string) => {
    const data = await walletApiService.utility.getAppExtra(id, locale)
    return data
  }

  getBannerList = async () => {
    const data = await walletApiService.utility.getBannerList()
    return data
  }

  getBlockActiveInfo = () => {
    return walletApiService.utility.getBlockActiveInfo()
  }

  getBuyCoinChannelList = async (coin: 'FB' | 'BTC') => {
    return walletApiService.utility.getBuyCoinChannelList(coin)
  }

  createBuyCoinPaymentUrl = (coin: 'FB' | 'BTC', address: string, channel: string) => {
    return walletApiService.utility.createBuyCoinPaymentUrl(coin, address, channel)
  }

  //  ----------- cosmos support --------

  getCosmosKeyring = async (chainId: string) => {
    if (!hasOwn(this.cosmosChainInfoMap, chainId)) {
      throw new Error('Not supported chainId')
    }
    if (!keyringService.memStore.getState().isUnlocked) {
      throw new Error(t('you_need_to_unlock_wallet_first'))
    }

    const currentAccount = await this.getCurrentAccount()
    if (!currentAccount) return null

    const key = `${currentAccount.pubkey}-${currentAccount.type}-${chainId}`

    if (key === this._cacheCosmosKeyringKey) {
      return this._cosmosKeyring
    }

    const keyring = await keyringService.getKeyringForAccount(
      currentAccount.pubkey,
      currentAccount.type
    )
    if (!keyring) return null

    let cosmosKeyring: CosmosKeyring | null = null
    const name = `${currentAccount.alianName}-${chainId}`
    let privateKey

    if (currentAccount.type !== KeyringType.KeystoneKeyring) {
      privateKey = await keyring.exportAccount(currentAccount.pubkey)
    }

    cosmosKeyring = await CosmosKeyring.createCosmosKeyring({
      privateKey,
      publicKey: currentAccount.pubkey,
      name,
      chainId,
      provider: this,
    })

    this._cacheCosmosKeyringKey = key
    this._cosmosKeyring = cosmosKeyring
    return cosmosKeyring
  }

  getBabylonAddress = async (chainId: string) => {
    const cosmosKeyring = await this.getCosmosKeyring(chainId)
    if (!cosmosKeyring) return null
    const address = cosmosKeyring.getKey().bech32Address
    return address
  }

  getBabylonAddressSummary = async (babylonChainId: string, babylonConfig: BabylonConfigV2) => {
    const chainType = this.getChainType()
    const chain = CHAINS_MAP[chainType]

    const cosmosKeyring = await this.getCosmosKeyring(babylonChainId)
    if (!cosmosKeyring) return null
    const address = cosmosKeyring.getKey().bech32Address
    let balance: CosmosBalance = {
      amount: '0',
      denom: 'ubbn',
    }
    let rewardBalance = 0
    try {
      balance = await cosmosKeyring.getBalance()
      if (babylonConfig) {
        rewardBalance = await cosmosKeyring.getBabylonStakingRewards()
      }
    } catch (e) {
      console.error('getBabylonAddressSummary:getBalance error:', e)
    }

    let stakedBalance = 0
    if (babylonConfig) {
      try {
        const currentAccount = await this.getCurrentAccount()
        if (!currentAccount) return null
        const pubkey = toXOnly(Buffer.from(currentAccount.pubkey, 'hex')).toString('hex')
        let pagination_key = ''

        do {
          const response = await getDelegationsV2(
            babylonConfig.phase2.stakingApi || '',
            pubkey,
            pagination_key
          )
          stakedBalance += response.delegations
            .filter(v => v.state === DelegationV2StakingState.ACTIVE)
            .reduce((pre, cur) => pre + cur.stakingAmount, 0)
          if (response.pagination.next_key) {
            pagination_key = response.pagination.next_key
          }
        } while (pagination_key)
      } catch (e) {
        console.error('getBabylonAddressSummary:getDelegationsV2 error:', e)
      }
    }

    return { address, balance, rewardBalance, stakedBalance }
  }

  genSignCosmosUr = async (cosmosSignRequest: {
    requestId?: string
    signData: string
    dataType: CosmosSignDataType
    path: string
    chainId?: string
    accountNumber?: string
    address?: string
  }) => {
    if (!cosmosSignRequest.signData) {
      throw new Error('signData is required for Cosmos signing')
    }

    if (!cosmosSignRequest.dataType) {
      throw new Error('dataType is required for Cosmos signing')
    }

    if (!cosmosSignRequest.path) {
      throw new Error('path is required for Cosmos signing')
    }

    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error(t('no_current_account'))

    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring.genSignCosmosUr) {
      throw new Error(t('current_keyring_does_not_support_gensigncosmosur'))
    }

    const { requestId, signData, dataType, path, chainId, accountNumber, address } =
      cosmosSignRequest

    const signRequest = {
      requestId,
      signData,
      dataType,
      path,
      extra: {
        chainId,
        accountNumber,
        address,
      },
    }

    const result = await keyring.genSignCosmosUr(signRequest as any)
    return result
  }

  parseCosmosSignUr = async (type: string, cbor: string) => {
    if (!type) {
      throw new Error('UR type is required for parsing Cosmos signature')
    }

    if (!cbor) {
      throw new Error('CBOR data is required for parsing Cosmos signature')
    }

    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const keyring = await keyringService.getKeyringForAccount(account.pubkey, account.type)
    if (!keyring.parseSignCosmosUr) {
      throw new Error(t('current_keyring_does_not_support_parsesigncosmosur'))
    }
    return await keyring.parseSignCosmosUr(type, cbor)
  }

  cosmosSignData = async (chainId: string, signBytesHex: string) => {
    const keyring = await this.getCosmosKeyring(chainId)
    if (!keyring) return null
    const result = await keyring.cosmosSignData(signBytesHex)
    return result
  }

  createSendTokenStep1 = async (
    chainId: string,
    tokenBalance: CosmosBalance,
    recipient: string,
    memo: string,
    {
      gasLimit,
      gasPrice,
      gasAdjustment,
    }: {
      gasLimit: number
      gasPrice: string
      gasAdjustment: number
    }
  ) => {
    assertValidCosmosMemo(memo)
    const keyring = await this.getCosmosKeyring(chainId)
    if (!keyring) return null
    const result = await keyring.createSendTokenStep1(tokenBalance, recipient, memo, {
      gasLimit,
      gasPrice,
      gasAdjustment,
    })
    return result
  }

  createSendTokenStep2 = async (chainId: string, signature: string) => {
    const keyring = await this.getCosmosKeyring(chainId)
    if (!keyring) return null
    const result = await keyring.createSendTokenStep2(signature)
    return result
  }

  /**
   * Simulate the gas for the send tokens transaction
   * @param chainId
   * @param tokenBalance
   * @param recipient
   * @param memo
   * @returns
   */
  simulateBabylonGas = async (
    chainId: string,
    recipient: string,
    amount: { denom: string; amount: string },
    memo: string
  ) => {
    assertValidCosmosMemo(memo)
    const keyring = await this.getCosmosKeyring(chainId)
    if (!keyring) return null
    const result = await keyring.simulateBabylonGas(recipient, amount, memo)
    return result
  }

  getBabylonConfig = async () => {
    return walletApiService.config.getBabylonConfig()
  }

  singleStepTransferBRC20Step1 = async (params: {
    userAddress: string
    userPubkey: string
    receiver: string
    ticker: string
    amount: string
    feeRate: number
  }) => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    params.amount = paramsUtils.formatAmount(params.amount)

    const result = await walletApiService.brc20.singleStepTransferBRC20Step1(params)
    const toSignData = await this.getToSignData({
      psbtHex: result.psbtHex,
      options: {
        toSignInputs: result.toSignInputs as any,
        autoFinalized: true,
      },
    })
    return {
      orderId: result.orderId,
      toSignData,
    }
  }

  singleStepTransferBRC20Step2 = async (params: { orderId: string; commitTx: string }) => {
    const networkType = this.getNetworkType()
    const psbtNetwork = toPsbtNetwork(networkType)
    const psbt = bitcoin.Psbt.fromHex(params.commitTx, { network: psbtNetwork })

    const result = await walletApiService.brc20.singleStepTransferBRC20Step2({
      orderId: params.orderId,
      psbt: psbt.toBase64(),
    })

    const toSignData = await this.getToSignData({
      psbtHex: result.psbtHex,
      options: {
        toSignInputs: result.toSignInputs as any,
        autoFinalized: false,
      },
    })
    return {
      toSignData,
    }
  }

  singleStepTransferBRC20Step3 = async (params: { orderId: string; revealTx: string }) => {
    const networkType = this.getNetworkType()
    const psbtNetwork = toPsbtNetwork(networkType)
    const psbt = bitcoin.Psbt.fromHex(params.revealTx, { network: psbtNetwork })

    const result = await walletApiService.brc20.singleStepTransferBRC20Step3({
      orderId: params.orderId,
      psbt: psbt.toBase64(),
    })

    return result
  }

  createSendBTCOffsetPsbt = async (
    tos: { address: string; satoshis: number }[],
    feeRate: number,
    enableRBF = true
  ): Promise<ToSignData> => {
    const currentAccount = await this.getCurrentAccount()
    if (!currentAccount) throw new Error('no current account')
    assertCanCreateSigningRequest(currentAccount)

    const { psbtBase64, toSignInputs } =
      await walletApiService.bitcoin.createSendCoinBypassHeadOffsets(
        currentAccount.address,
        currentAccount.pubkey,
        tos,
        feeRate,
        enableRBF
      )

    const psbt = bitcoin.Psbt.fromBase64(psbtBase64)

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
    })

    const estimatedFee = getEstimateFee(psbt, currentAccount.address, currentAccount.pubkey)
    toSignData.estimatedFee = estimatedFee

    return toSignData
  }

  getAlkanesList = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize
    const { total, list } = await walletApiService.alkanes.getAlkanesList(address, cursor, size)

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAssetUtxosAlkanes = async (alkaneid: string) => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    const alkanesUtxos = await walletApiService.alkanes.getAlkanesUtxos(account.address, alkaneid)

    const assetUtxos = alkanesUtxos.map(v => {
      return Object.assign(v, { pubkey: account.pubkey })
    }) as unknown as UnspentOutput[]

    assetUtxos.forEach(v => {
      v.inscriptions = []
    })

    assetUtxos.sort((a, b) => {
      const bAmount = b.alkanes?.find(v => v.alkaneid === alkaneid)?.amount || '0'
      const aAmount = a.alkanes?.find(v => v.alkaneid === alkaneid)?.amount || '0'
      return bnUtils.compareAmount(bAmount, aAmount) || 0
    })

    return assetUtxos
  }

  getAddressAlkanesTokenSummary = async (
    address: string,
    runeid: string,
    fetchAvailable: boolean
  ) => {
    const tokenSummary = await walletApiService.alkanes.getAddressAlkanesTokenSummary(
      address,
      runeid,
      fetchAvailable
    )
    return tokenSummary
  }

  createSendAlkanesPsbt = async ({
    to,
    alkaneid,
    amount,
    feeRate,
    type,
    enableRBF = true,
  }: {
    to: string
    alkaneid: string
    amount: string
    feeRate: number
    type: 'ft' | 'nft'
    enableRBF?: boolean
  }): Promise<ToSignData> => {
    amount = paramsUtils.formatAmount(amount)
    if (amount === '0') {
      throw new Error('Amount must be greater than 0')
    }

    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')
    assertCanCreateSigningRequest(account)

    const assetUtxos = await this.getAssetUtxosAlkanes(alkaneid)
    const selectedAssetUtxos: UnspentOutput[] = []
    const amountToSend = BigInt(amount)

    const exactUtxo = assetUtxos.find(utxo => {
      const balance = utxo.alkanes?.find(alkane => alkane.alkaneid === alkaneid)
      return balance && BigInt(balance.amount) === amountToSend && utxo.alkanes?.length === 1
    })
    if (exactUtxo) {
      selectedAssetUtxos.push(exactUtxo)
    } else {
      let total = 0n
      for (const utxo of assetUtxos) {
        const balance = utxo.alkanes?.find(alkane => alkane.alkaneid === alkaneid)
        if (!balance) continue

        total += BigInt(balance.amount)
        selectedAssetUtxos.push(utxo)
        if (total >= amountToSend) break
      }
    }

    const btcUtxos = await this.getBTCUtxos()
    const { psbt, toSignInputs } = await txHelpers.sendAlkanes({
      assetUtxos: selectedAssetUtxos,
      assetAddress: account.address,
      btcUtxos,
      btcAddress: account.address,
      toAddress: to,
      networkType: this.getNetworkType(),
      alkaneid,
      amount,
      outputValue: UTXO_DUST,
      feeRate,
      enableRBF,
    })

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: true,
      },
      action: {
        name: t('send_alkanes'),
        description: '',
        details: [
          {
            label: t('to'),
            value: to,
            type: PsbtActionDetailType.ADDRESS,
          },
          {
            label: t('alkanes'),
            value: {
              alkaneid,
              amount,
              type,
            },
            type: PsbtActionDetailType.ALKANES,
          },
        ],
        type: PsbtActionType.CUSTOM,
      },
    })
    return toSignData
  }

  getAlkanesCollectionList = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize
    const { total, list } = await walletApiService.alkanes.getAlkanesCollectionList(
      address,
      cursor,
      size
    )

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getAlkanesCollectionItems = async (
    address: string,
    collectionId: string,
    currentPage: number,
    pageSize: number
  ) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize
    const { total, list } = await walletApiService.alkanes.getAlkanesCollectionItems(
      address,
      collectionId,
      cursor,
      size
    )

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  getBRC20RecentHistory(address: string, ticker: string): Promise<BRC20HistoryItem[]> {
    return walletApiService.brc20.getBRC20RecentHistory(address, ticker)
  }

  getBRC20ProgList = async ({
    address,
    currentPage,
    pageSize,
  }: {
    address: string
    currentPage: number
    pageSize: number
  }) => {
    const cursor = (currentPage - 1) * pageSize
    const size = pageSize
    const { total, list } = await walletApiService.brc20.getBRC20ProgList({ address, cursor, size })

    return {
      currentPage,
      pageSize,
      total,
      list,
    }
  }

  // Rate Us Status
  getRateUsStatus = (): RateUsStatus => {
    return preferenceService.getRateUsStatus()
  }

  setHasRated = (hasRated: boolean) => {
    return preferenceService.setHasRated(hasRated)
  }

  setRatePromptDismissedAt = (timestamp: number | null) => {
    return preferenceService.setRatePromptDismissedAt(timestamp)
  }

  setHasShownSecondPrompt = (hasShown: boolean) => {
    return preferenceService.setHasShownSecondPrompt(hasShown)
  }

  resetRateUsStatus = async () => {
    return preferenceService.resetRateUsStatus()
  }

  getGuideReaded = async () => {
    return preferenceService.getGuideReaded()
  }

  setGuideReaded = async () => {
    preferenceService.setGuideReaded(true)
  }

  getAnnouncements = async (cursor: number, size: number) => {
    return walletApiService.utility.getAnnouncements(cursor, size)
  }

  // get the notifications
  getNotifications = async () => {
    return notificationService.getNotifications()
  }

  // mark the notification as read
  readNotification = async (id: string) => {
    return notificationService.markAsRead(id)
  }

  // mark all notifications as read
  readAllNotifications = async () => {
    return notificationService.readAll()
  }

  // delete the notification
  deleteNotification = async (id: string) => {
    return notificationService.deleteNotification(id)
  }

  getNotificationUnreadCount = (): number => {
    return notificationService.getUnreadCount()
  }

  getAcceptLowFeeMode = async () => {
    return preferenceService.getAcceptLowFeeMode()
  }

  setAcceptLowFeeMode = async (accept: boolean) => {
    preferenceService.setAcceptLowFeeMode(accept)
  }

  getEnableRBF = async () => {
    return preferenceService.getEnableRBF()
  }

  setEnableRBF = async (enableRBF: boolean) => {
    preferenceService.setEnableRBF(enableRBF)
  }

  createTmpKeyringWithPublicKey = async (publicKey: string, addressType: AddressType) => {
    const networkType = this.getNetworkType()
    if (!canDeriveAddressFromPublicKey(publicKey, addressType, networkType)) {
      throw new Error('Invalid Public Key')
    }

    const originKeyring = keyringService.createTmpKeyring(KeyringType.ReadonlyKeyring, [publicKey])
    const displayedKeyring = await keyringService.displayForKeyring(originKeyring, addressType, -1)
    const tmpKeyring = this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
    return tmpKeyring
  }

  createKeyringWithPublicKey = async (
    data: string,
    addressType: AddressType,
    alianName?: string
  ) => {
    const networkType = this.getNetworkType()
    if (!canDeriveAddressFromPublicKey(data, addressType, networkType)) {
      throw new Error('Invalid Public Key')
    }

    const originKeyring = await keyringService.importPublicKeyOnly(data, addressType as AddressType)

    const displayedKeyring = await keyringService.displayForKeyring(
      originKeyring,
      addressType,
      keyringService.keyrings.length - 1
    )
    const keyring = this.displayedKeyringToWalletKeyring(
      displayedKeyring,
      keyringService.keyrings.length - 1
    )
    await this.changeKeyring(keyring)

    preferenceService.setShowSafeNotice(true)
  }

  createTmpKeyringWithAddress = async (address: string) => {
    const networkType = this.getNetworkType()
    if (!isValidAddress(address, networkType)) {
      throw new Error('Invalid address')
    }
    const addressType = getAddressType(address, networkType)
    const originKeyring = keyringService.createTmpKeyring(KeyringType.WatchAddressKeyring, [
      address,
    ])
    const displayedKeyring = await keyringService.displayForKeyring(originKeyring, addressType, -1)
    return this.displayedKeyringToWalletKeyring(displayedKeyring, -1, false)
  }

  createKeyringWithAddress = async (address: string) => {
    const networkType = this.getNetworkType()
    if (!isValidAddress(address, networkType)) {
      throw new Error('Invalid address')
    }
    const addressType = getAddressType(address, networkType)
    const originKeyring = await keyringService.importWatchAddress(address, addressType)
    const displayedKeyring = await keyringService.displayForKeyring(
      originKeyring,
      addressType,
      keyringService.keyrings.length - 1
    )
    const keyring = this.displayedKeyringToWalletKeyring(
      displayedKeyring,
      keyringService.keyrings.length - 1
    )
    await this.changeKeyring(keyring)

    preferenceService.setShowSafeNotice(true)
  }

  createDummyPsbt = async ({
    txType,
  }: {
    txType: DummyTxType
  }): Promise<{
    psbtHex: string
    toSignInputs: ToSignInput[]
  }> => {
    const account = preferenceService.getCurrentAccount()
    if (!account) throw new Error('no current account')

    const { psbt, toSignInputs } = txHelpers.createDummyTx({
      txType,
      address: account.address,
      pubkey: account.pubkey,
    })

    const toSignData = await this.getToSignData({
      psbtHex: psbt.toHex(),
      options: {
        toSignInputs: toSignInputs as any,
        autoFinalized: false,
      },
    })
    return toSignData
  }

  getBTCUnit() {
    const chainType = this.getChainType()
    return CHAINS_MAP[chainType]!.unit
  }
}
export default new WalletController()
