import {
  RgbTransferAwaitingAckError,
  RgbTransferRejectedError,
  decodeRgbInvoice,
} from '@unisat/rgb-service'
import type { ToSignInput } from '@unisat/keyring-service/types'
import { toRgbDisplayAmount, type ToSignData } from '@unisat/wallet-shared'

import { psbtFromString } from '../utils/psbt-utils'
import type { LocalRgbServiceContext } from './RgbWalletCoordinator'

type RgbSendOperationsDependencies = {
  getContext: () => Promise<LocalRgbServiceContext>
  getFeeRate: () => Promise<number | undefined>
  getToSignData: (params: {
    psbt: string
    toSignInputs: ToSignInput[]
    amountDisplay: string
    actionName: string
  }) => Promise<ToSignData>
  getActiveTransferId: (fundingAddress: string) => string | undefined
  setActiveTransferId: (fundingAddress: string, transferId: string) => void
  clearActiveTransferId: (fundingAddress: string) => void
}

export type RgbSendBeginParams = {
  invoice: string
  assetId: string
  amount?: number | string
  ticker?: string
  name?: string
  precision?: number
  feeRate?: number
  minConfirmations?: number
  donation?: boolean
}

/** Local RGB send state machine. Signing presentation remains a controller-provided capability. */
/* eslint-disable @typescript-eslint/explicit-function-return-type -- preserve precise inferred service result contracts. */
export class RgbSendOperations {
  constructor(private readonly dependencies: RgbSendOperationsDependencies) {}

  async begin(params: RgbSendBeginParams) {
    const { service, wallet } = await this.dependencies.getContext()
    const feeRate = params.feeRate ?? (await this.dependencies.getFeeRate())
    if (!feeRate || feeRate <= 0) throw new Error('Invalid RGB transaction fee rate')

    await service.sync()
    const prepared = await service.prepareSend({
      assetId: params.assetId,
      invoice: params.invoice,
      feeRate,
      ...(params.amount === undefined ? {} : { amount: String(params.amount) }),
      ...(params.donation === undefined ? {} : { donation: params.donation }),
      ...(params.minConfirmations === undefined
        ? {}
        : { minConfirmations: params.minConfirmations }),
    })
    const toSignData = await this.dependencies.getToSignData({
      psbt: prepared.psbt,
      toSignInputs: prepared.toSignInputs,
      amountDisplay: getAmountDisplay(params),
      actionName: `Send ${getAssetLabel(params)}`,
    })
    this.dependencies.setActiveTransferId(wallet.fundingAddress, prepared.id)
    return {
      ...prepared,
      txid: prepared.id,
      psbtHex: toSignData.psbtHex,
      toSignData,
    }
  }

  async complete(params: { signedPsbt: string; transferId?: string }) {
    const { service, wallet } = await this.dependencies.getContext()
    const pending = service.getPendingTransfers()
    const transferId =
      params.transferId ??
      this.dependencies.getActiveTransferId(wallet.fundingAddress) ??
      (pending.length === 1 ? pending[0]?.id : undefined)
    if (!transferId || !pending.some(transfer => transfer.id === transferId)) {
      throw new Error(
        'No uniquely identified locally prepared RGB transfer is awaiting a signature'
      )
    }
    this.dependencies.setActiveTransferId(wallet.fundingAddress, transferId)
    try {
      return await service.completeSend(transferId, psbtFromString(params.signedPsbt).toBase64())
    } catch (error) {
      const transfer = service.getPendingTransfers().find(item => item.id === transferId)
      if (error instanceof RgbTransferAwaitingAckError) {
        return {
          transferId,
          txid: transfer?.delivery?.completed.txid,
          status: 'waiting_ack' as const,
        }
      }
      if (error instanceof RgbTransferRejectedError) {
        return { transferId, txid: error.txid, status: 'rejected' as const }
      }
      if (transfer?.delivery?.broadcastError) {
        return {
          transferId,
          txid: transfer.delivery.completed.txid,
          status: 'broadcast_failed' as const,
          error: transfer.delivery.broadcastError,
        }
      }
      throw error
    } finally {
      this.dependencies.clearActiveTransferId(wallet.fundingAddress)
    }
  }

  async retryBroadcast(transferId: string) {
    const { service } = await this.dependencies.getContext()
    const transfer = service.getPendingTransfers().find(item => item.id === transferId)
    if (!transfer?.delivery?.broadcastError) {
      return { broadcast: false, status: 'not_retryable' as const }
    }
    try {
      await service.sync()
    } catch (error) {
      const latest = service.getPendingTransfers().find(item => item.id === transferId)
      if (latest?.broadcast) return { broadcast: true, status: 'confirming' as const }
      if (latest?.delivery?.broadcastError) {
        return {
          broadcast: false,
          status: 'broadcast_failed' as const,
          error: latest.delivery.broadcastError,
        }
      }
      if (error instanceof RgbTransferAwaitingAckError) {
        return { broadcast: false, status: 'waiting_ack' as const }
      }
      throw error
    }
    return { broadcast: true, status: 'confirming' as const }
  }

  async abortVanillaTx(txid: string) {
    const { service, wallet } = await this.dependencies.getContext()
    const requestedId = String(txid).replace(/^local-send:/, '')
    const match = service
      .getPendingTransfers()
      .find(
        transfer =>
          transfer.id === requestedId ||
          transfer.delivery?.completed.txid === requestedId ||
          transfer.broadcast?.completed.txid === requestedId
      )
    if (!match) return { aborted: false, local: true }

    const result = await service.abortSend(match.id)
    if (
      result.aborted &&
      this.dependencies.getActiveTransferId(wallet.fundingAddress) === match.id
    ) {
      this.dependencies.clearActiveTransferId(wallet.fundingAddress)
    }
    return { aborted: result.aborted, local: true, status: result.status, transferId: match.id }
  }

  async getPendingVanillaTxs() {
    const { service } = await this.dependencies.getContext()
    return {
      list: service.getPendingTransfers().map(pending => ({ txid: pending.id, type: 'send-rgb' })),
    }
  }
}

function getAssetLabel(params: RgbSendBeginParams): string {
  return (
    [params.name, params.ticker]
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.trim())
      .find(value => value.length > 0) ?? 'RGB'
  )
}

function getAmountDisplay(params: RgbSendBeginParams): string {
  const assetLabel = getAssetLabel(params)
  let amount = params.amount === undefined || params.amount === '' ? '' : String(params.amount)
  if (!amount) {
    try {
      amount = decodeRgbInvoice(params.invoice).amount ?? ''
    } catch {
      amount = ''
    }
  }
  return `${amount ? toRgbDisplayAmount(amount, params.precision ?? 0) : '--'} ${assetLabel}`.trim()
}
