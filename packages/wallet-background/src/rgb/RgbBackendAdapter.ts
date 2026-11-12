import type {
  RgbStateSource,
  RgbValidationHistory,
  RgbWalletRef,
  RgbWalletSnapshot,
} from '@unisat/rgb-service'

type RgbIndexedUtxo = {
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
    historyRef?: string
    historyAvailable?: boolean
  }>
}

export type RgbActiveWriteLease = {
  deviceId: string
  leaseId: string
  fencingToken: number
}

export type RgbBackendApi = {
  getRgbWalletUtxoSnapshot: (params: {
    wallet: RgbWalletRef
    forceSync?: boolean
    knownRevision?: number
  }) => Promise<{
    changed?: boolean
    revision?: number
    syncedAt: number
    utxos?: RgbIndexedUtxo[]
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
  }) => Promise<RgbValidationHistory>
  storeRgbHistoryFragment?: (params: {
    wallet: RgbWalletRef
    lease?: RgbActiveWriteLease
    assetId: string
    opIds: string[]
    payloadHash: string
    payload: string
  }) => Promise<{ stored: true; payloadHash: string }>
  syncRgbTransfer: (params: {
    wallet: RgbWalletRef
    lease?: RgbActiveWriteLease
    transferId: string
    txid: string
    assetId: string
    amount: string
    createdAt: number
    spentOutpoints: Array<{ txid: string; vout: number }>
    consignments: Array<{
      recipientId: string
      assetId: string
      opIds: string[]
      transportId?: string
    }>
  }) => Promise<void>
  replaceRgbUtxos: (params: {
    address: string
    wallet?: RgbWalletRef & { network: string }
    lease?: RgbActiveWriteLease
    txid: string
    historyRefsVersion?: 1
    outpoints: RgbIndexedUtxo[]
  }) => Promise<void>
  claimRgbConsignments: (params: {
    wallet: RgbWalletRef
    lease?: RgbActiveWriteLease
    recipientId: string
  }) => Promise<{ claimed: number }>
  getClaimedRgbConsignments: (params: {
    wallet: RgbWalletRef
  }) => Promise<{ consignments: Array<{ recipientId: string; payload: string }> }>
  getRgbTransactionStatus: (
    txid: string,
    params: { wallet: RgbWalletRef }
  ) => Promise<{
    status: 'mempool' | 'confirmed' | 'pending_spend' | 'spent' | 'replaced' | 'unknown'
    confirmations: number
  }>
  testRgbTransactionAcceptance: (params: {
    wallet: RgbWalletRef
    rawTx: string
  }) => Promise<{ txid: string; allowed: boolean; rejectReason?: string }>
  reportRgbBroadcastFailure: (params: {
    wallet: RgbWalletRef
    transferId: string
    recipientId: string
    txid: string
    rawTx: string
    error: string
  }) => Promise<void>
  getRgbBroadcastFailureStatus: (params: {
    wallet: RgbWalletRef
    recipientId: string
    txid: string
  }) => Promise<{ canceled: boolean }>
  getRgbBroadcastFailureStatuses: (params: {
    wallet: RgbWalletRef
    items: Array<{ recipientId: string; txid: string }>
  }) => Promise<{ items: Array<{ recipientId: string; txid: string; canceled: boolean }> }>
  reportRgbReceiveValidationFailure: (params: {
    wallet: RgbWalletRef
    recipientId: string
    txid?: string
    payload?: string
    reason: string
    endpoint?: string
    proxyTransferId?: string
    proxyConsignmentHash?: string
  }) => Promise<{ caseId: string; status: 'under_review' | 'rejection_allowed'; reviewReason?: string }>
  getRgbReceiveValidationFailureStatus: (params: {
    wallet: RgbWalletRef
    caseId: string
  }) => Promise<{ status: 'under_review' | 'rejection_allowed'; reviewReason?: string }>
  resolveRgbReceiveValidationFailure: (params: {
    wallet: RgbWalletRef
    caseId: string
  }) => Promise<{ resolved: boolean }>
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
}

type RgbBackendAdapterDependencies = {
  api: RgbBackendApi
  getActiveWriteLease: (wallet: RgbWalletRef) => RgbActiveWriteLease | undefined
}

/** Adapts the address indexer and RGB backend APIs to RgbService's state source port. */
/* eslint-disable @typescript-eslint/explicit-function-return-type -- object callbacks implement the typed RgbStateSource port. */
export function createRgbBackendAdapter(
  dependencies: RgbBackendAdapterDependencies
): RgbStateSource {
  const { api } = dependencies
  return {
    getSnapshot: async (wallet, options) => {
      const snapshot = await api.getRgbWalletUtxoSnapshot({
        wallet,
        forceSync: true,
        ...(options?.knownRevision === undefined
          ? {}
          : { knownRevision: options.knownRevision }),
      })
      if (snapshot.changed === false) {
        return {
          unchanged: true as const,
          utxos: [],
          syncedAt: snapshot.syncedAt,
          ...(snapshot.revision === undefined
            ? (options?.knownRevision === undefined ? {} : { revision: options.knownRevision })
            : { revision: snapshot.revision }),
        }
      }
      return {
        syncedAt: snapshot.syncedAt,
        ...(snapshot.revision === undefined ? {} : { revision: snapshot.revision }),
        utxos: (snapshot.utxos || []).map(toRgbUtxo),
      }
    },
    getValidationHistory: (wallet, request) =>
      api.getRgbConsignmentHistory({
        wallet,
        assetId: request.assetId,
        allocations: request.allocations.map(allocation => ({
          txid: allocation.outpoint.txid,
          vout: allocation.outpoint.vout,
          opId: allocation.opId,
          assignmentIndex: allocation.assignmentIndex,
          assignmentType: allocation.assignmentType,
        })),
      }),
    ...(api?.storeRgbHistoryFragment
      ? {
          storeValidationHistory: async (wallet: RgbWalletRef, fragment: {
            assetId: string
            opIds: string[]
            payloadHash: string
            payload: string
          }) => {
            const lease = dependencies.getActiveWriteLease(wallet)
            return api.storeRgbHistoryFragment!({
              wallet,
              ...(lease ? { lease } : {}),
              ...fragment,
            })
          },
        }
      : {}),
    syncBroadcast: async (wallet, transferId, transfer, snapshot, metadata) => {
      const lease = dependencies.getActiveWriteLease(wallet)
      await api.syncRgbTransfer({
        wallet,
        ...(lease ? { lease } : {}),
        transferId,
        txid: transfer.txid,
        assetId: transfer.consignments[0]?.assetId || metadata.assetId,
        amount: metadata.amount,
        createdAt: metadata.createdAt,
        spentOutpoints: transfer.fundingUpdate?.spentOutpoints ?? [],
        consignments: transfer.consignments.map((consignment, index) => ({
          recipientId: consignment.recipientId,
          assetId: consignment.assetId,
          opIds: consignment.opIds,
          transportId: `${transferId}:${index}`,
        })),
      })
      await api.replaceRgbUtxos({
        address: wallet.fundingAddress,
        ...(wallet.network ? { wallet: wallet as RgbWalletRef & { network: string } } : {}),
        ...(lease ? { lease } : {}),
        txid: transfer.txid,
        historyRefsVersion: 1,
        outpoints: snapshot.utxos.map(toIndexedUtxo),
      })
    },
    claimConsignments: async (wallet, recipientId) => {
      const lease = dependencies.getActiveWriteLease(wallet)
      const result = await api.claimRgbConsignments({
        wallet,
        ...(lease ? { lease } : {}),
        recipientId,
      })
      return result.claimed
    },
    getClaimedConsignments: async wallet => {
      const result = await api.getClaimedRgbConsignments({ wallet })
      return result.consignments
    },
    getTransactionStatus: (wallet, txid) => api.getRgbTransactionStatus(txid, { wallet }),
    testTransactionAcceptance: (wallet, rawTx) =>
      api.testRgbTransactionAcceptance({ wallet, rawTx }),
    reportBroadcastFailure: (wallet, report) => api.reportRgbBroadcastFailure({ wallet, ...report }),
    getBroadcastCancellation: async (wallet, recipientId, txid) => {
      const result = await api.getRgbBroadcastFailureStatus({ wallet, recipientId, txid })
      return result.canceled
    },
    getBroadcastCancellations: async (wallet, items) => {
      const result = await api.getRgbBroadcastFailureStatuses({ wallet, items })
      return result.items
    },
    reportReceiveValidationFailure: (wallet, failure) =>
      api.reportRgbReceiveValidationFailure({ wallet, ...failure }),
    getReceiveValidationFailureStatus: (wallet, caseId) =>
      api.getRgbReceiveValidationFailureStatus({ wallet, caseId }),
    resolveReceiveValidationFailure: async (wallet, caseId) => {
      await api.resolveRgbReceiveValidationFailure({ wallet, caseId })
    },
    verifyUtxos: async (wallet, outpoints) => {
      const lease = dependencies.getActiveWriteLease(wallet)
      if (!lease) throw new Error('RGB write lease is unavailable')
      if (!wallet.network) throw new Error('RGB write lease wallet network is unavailable')
      const result = await api.verifyRgbUtxos({
        wallet: wallet as RgbWalletRef & { network: string },
        deviceId: lease.deviceId,
        leaseId: lease.leaseId,
        fencingToken: lease.fencingToken,
        outpoints: outpoints.map(utxo => ({
          txid: utxo.outpoint.txid,
          vout: utxo.outpoint.vout,
          satoshis: utxo.satoshis,
          scriptPk: utxo.scriptPubKey,
        })),
      })
      return result.outpoints.map(outpoint => ({
        outpoint: { txid: outpoint.txid, vout: outpoint.vout },
        status: outpoint.status,
        confirmations: outpoint.confirmations,
        ...(outpoint.confirmationHeight === undefined
          ? {}
          : { confirmationHeight: outpoint.confirmationHeight }),
      }))
    },
  }
}

function toRgbUtxo(utxo: RgbIndexedUtxo): RgbWalletSnapshot['utxos'][number] {
  return {
    outpoint: { txid: utxo.txid, vout: utxo.vout },
    satoshis: utxo.satoshis,
    scriptPubKey: utxo.scriptPk,
    publicKey: utxo.publicKey,
    ...(utxo.chainStatus === undefined ? {} : { chainStatus: utxo.chainStatus }),
    ...(utxo.confirmations === undefined ? {} : { confirmations: utxo.confirmations }),
    ...(utxo.confirmationHeight === undefined
      ? {}
      : { confirmationHeight: utxo.confirmationHeight }),
    allocations: utxo.allocations,
  }
}

function toIndexedUtxo(utxo: RgbWalletSnapshot['utxos'][number]): RgbIndexedUtxo {
  return {
    txid: utxo.outpoint.txid,
    vout: utxo.outpoint.vout,
    satoshis: utxo.satoshis,
    scriptPk: utxo.scriptPubKey,
    publicKey: utxo.publicKey,
    ...(utxo.chainStatus === undefined ? {} : { chainStatus: utxo.chainStatus }),
    ...(utxo.confirmations === undefined ? {} : { confirmations: utxo.confirmations }),
    ...(utxo.confirmationHeight === undefined
      ? {}
      : { confirmationHeight: utxo.confirmationHeight }),
    allocations: utxo.allocations,
  }
}
