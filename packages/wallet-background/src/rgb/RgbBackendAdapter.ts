import type {
  RgbStateSource,
  RgbValidationHistory,
  RgbWalletRef,
  RgbWalletSnapshot,
} from '@unisat/rgb-service'
import type { NetworkType } from '@unisat/wallet-types'

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
  }>
}

export type RgbBackendApi = {
  getRgbWalletUtxoSnapshot: (params: {
    wallet: RgbWalletRef
    forceSync?: boolean
  }) => Promise<{ syncedAt: number; utxos: RgbIndexedUtxo[] }>
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
  syncRgbTransfer: (params: {
    wallet: RgbWalletRef
    transferId: string
    txid: string
    amount: string
    createdAt: number
    to?: string
    spentOutpoints: Array<{ txid: string; vout: number }>
    consignments: Array<{
      recipientId: string
      payload: string
      assetId: string
      opIds: string[]
      transportId?: string
    }>
  }) => Promise<void>
  replaceRgbUtxos: (params: {
    address: string
    txid: string
    outpoints: RgbIndexedUtxo[]
  }) => Promise<void>
  claimRgbConsignments: (params: {
    wallet: RgbWalletRef
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
}

type RgbBackendAdapterDependencies = {
  api: RgbBackendApi
  getNetworkType: () => NetworkType
  getInvoiceDestination: (
    invoice: string | undefined,
    networkType: NetworkType
  ) => string | undefined
}

/** Adapts the address indexer and RGB backend APIs to RgbService's state source port. */
/* eslint-disable @typescript-eslint/explicit-function-return-type -- object callbacks implement the typed RgbStateSource port. */
export function createRgbBackendAdapter(
  dependencies: RgbBackendAdapterDependencies
): RgbStateSource {
  const { api } = dependencies
  return {
    getSnapshot: async wallet => {
      const snapshot = await api.getRgbWalletUtxoSnapshot({ wallet, forceSync: true })
      return {
        syncedAt: snapshot.syncedAt,
        utxos: snapshot.utxos.map(toRgbUtxo),
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
    syncBroadcast: async (wallet, transferId, transfer, snapshot, metadata) => {
      const to = dependencies.getInvoiceDestination(metadata.invoice, dependencies.getNetworkType())
      await api.syncRgbTransfer({
        wallet,
        transferId,
        txid: transfer.txid,
        amount: metadata.amount,
        createdAt: metadata.createdAt,
        ...(to ? { to } : {}),
        spentOutpoints: transfer.fundingUpdate?.spentOutpoints ?? [],
        consignments: transfer.consignments.map((consignment, index) => ({
          ...consignment,
          transportId: `${transferId}:${index}`,
        })),
      })
      await api.replaceRgbUtxos({
        address: wallet.fundingAddress,
        txid: transfer.txid,
        outpoints: snapshot.utxos.map(toIndexedUtxo),
      })
    },
    claimConsignments: async (wallet, recipientId) => {
      const result = await api.claimRgbConsignments({ wallet, recipientId })
      return result.claimed
    },
    getClaimedConsignments: async wallet => {
      const result = await api.getClaimedRgbConsignments({ wallet })
      return result.consignments
    },
    getTransactionStatus: (wallet, txid) => api.getRgbTransactionStatus(txid, { wallet }),
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
