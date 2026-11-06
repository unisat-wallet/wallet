import type { RgbWalletSnapshot } from '@unisat/rgb-service'

export type RgbPendingReceiveInvoice = {
  invoice: string
  recipientId?: string
  assetId?: string | null
  amount?: number | string
  precision?: number
  status?: string
  kind?: string
  transferKind?: string
  batchTransferIdx?: number
  expirationTimestamp?: number
  minConfirmations?: number
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
    minConfirmations?: number
    createdAt?: number
  recipientType?: 'blind' | 'witness'
  witnessScriptPubKey?: string
    proxyRecipientId?: string
    pendingAccept?: {
      assetId?: string
      amount?: string
      precision?: number
      [key: string]: unknown
    }
    pendingValidationFailure?: unknown
    receivedConsignment?: {
      assetId?: string
      amount?: string
      precision?: number
      accepted?: boolean
      acknowledgementPending?: boolean
      broadcastDetectedAt?: number
      [key: string]: unknown
    }
  },
  batchTransferIdx?: number,
  status: RgbReceiveInvoiceStatus = 'WaitingCounterparty'
): RgbPendingReceiveInvoice {
  const awaitingAcceptance = item.pendingAccept !== undefined
  const awaitingSenderBroadcast = item.receivedConsignment?.accepted === true
  const awaitingSenderConfirmation = item.receivedConsignment?.broadcastDetectedAt !== undefined
  const assetId = item.receivedConsignment?.assetId ?? item.pendingAccept?.assetId ?? item.assetId
  const amount = item.receivedConsignment?.amount ?? item.pendingAccept?.amount ?? item.amount
  const precision = item.receivedConsignment?.precision ?? item.pendingAccept?.precision
  return {
    invoice: item.invoice,
    recipientId: item.proxyRecipientId || item.recipientId,
    ...(assetId === undefined ? {} : { assetId }),
    ...(amount === undefined ? {} : { amount }),
    ...(precision === undefined ? {} : { precision }),
    ...(item.expirationTimestamp === undefined
      ? {}
      : { expirationTimestamp: item.expirationTimestamp }),
    ...(item.minConfirmations === undefined ? {} : { minConfirmations: item.minConfirmations }),
    ...(item.createdAt === undefined ? {} : { createdAt: item.createdAt }),
    kind: item.recipientType === 'witness' ? 'ReceiveWitness' : 'ReceiveBlind',
    ...(item.recipientType === 'witness' && item.witnessScriptPubKey
      ? { witnessScriptPubKey: item.witnessScriptPubKey }
      : {}),
    status: item.pendingValidationFailure
      ? 'ValidationFailed'
      : awaitingAcceptance
      ? 'PendingAccept'
      : awaitingSenderConfirmation
        ? 'WaitingSenderConfirmation'
      : awaitingSenderBroadcast
        ? 'WaitingSenderBroadcast'
        : status,
    canCancel:
      !awaitingAcceptance &&
      !item.pendingValidationFailure &&
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
