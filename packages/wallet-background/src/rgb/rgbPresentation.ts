import type { RgbWalletSnapshot } from '@unisat/rgb-service'

export type RgbPendingReceiveInvoice = {
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
  [key: string]: unknown
}

type RgbReceiveInvoiceStatus =
  | 'WaitingConfirmations'
  | 'WaitingCounterparty'
  | 'WaitingSenderBroadcast'
  | 'WaitingSenderConfirmation'

export function toPublicRgbPendingReceiveInvoice(
  item: {
    invoice: string
    recipientId: string
    assetId?: string
    amount?: string
    expirationTimestamp?: number
    createdAt?: number
    pendingAccept?: unknown
    receivedConsignment?: {
      accepted?: boolean
      acknowledgementPending?: boolean
      broadcastDetectedAt?: number
    }
  },
  batchTransferIdx?: number,
  status: RgbReceiveInvoiceStatus = 'WaitingCounterparty'
): RgbPendingReceiveInvoice {
  const awaitingAcceptance = item.pendingAccept !== undefined
  const awaitingSenderBroadcast = item.receivedConsignment?.accepted === true
  const awaitingSenderConfirmation = item.receivedConsignment?.broadcastDetectedAt !== undefined
  return {
    invoice: item.invoice,
    recipientId: item.recipientId,
    ...(item.assetId === undefined ? {} : { assetId: item.assetId }),
    ...(item.amount === undefined ? {} : { amount: item.amount }),
    ...(item.expirationTimestamp === undefined
      ? {}
      : { expirationTimestamp: item.expirationTimestamp }),
    ...(item.createdAt === undefined ? {} : { createdAt: item.createdAt }),
    kind: 'ReceiveBlind',
    status: awaitingAcceptance
      ? 'PendingAccept'
      : awaitingSenderConfirmation
        ? 'WaitingSenderConfirmation'
      : awaitingSenderBroadcast
        ? 'WaitingSenderBroadcast'
        : status,
    canCancel:
      !awaitingAcceptance &&
      item.receivedConsignment?.accepted !== true &&
      item.receivedConsignment?.acknowledgementPending !== true,
    ...(batchTransferIdx === undefined ? {} : { batchTransferIdx }),
  }
}

export function getRgbReceiveInvoiceStatus(
  snapshot: RgbWalletSnapshot,
  receive: { seal: { txid: string; vout: number } }
): 'WaitingConfirmations' | 'WaitingCounterparty' {
  const utxo = snapshot.utxos.find(
    item => item.outpoint.txid === receive.seal.txid && item.outpoint.vout === receive.seal.vout
  )
  return utxo?.chainStatus === 'confirmed' ? 'WaitingCounterparty' : 'WaitingConfirmations'
}
