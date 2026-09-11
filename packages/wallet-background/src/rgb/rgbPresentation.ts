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
    recipientType?: 'blind' | 'witness'
    proxyRecipientId?: string
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
    recipientId: item.proxyRecipientId || item.recipientId,
    ...(item.assetId === undefined ? {} : { assetId: item.assetId }),
    ...(item.amount === undefined ? {} : { amount: item.amount }),
    ...(item.expirationTimestamp === undefined
      ? {}
      : { expirationTimestamp: item.expirationTimestamp }),
    ...(item.createdAt === undefined ? {} : { createdAt: item.createdAt }),
    kind: item.recipientType === 'witness' ? 'ReceiveWitness' : 'ReceiveBlind',
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
  receive: { seal?: { txid: string; vout: number } }
): 'WaitingConfirmations' | 'WaitingCounterparty' {
  // Witness recipients receive an output created by the sender, so there is
  // no local funding UTXO to wait for before the invoice is usable.
  const seal = receive.seal
  if (!seal) return 'WaitingCounterparty'
  const utxo = snapshot.utxos.find(
    item => item.outpoint.txid === seal.txid && item.outpoint.vout === seal.vout
  )
  return utxo?.chainStatus === 'confirmed' ? 'WaitingCounterparty' : 'WaitingConfirmations'
}
