import {
  RgbTransferAwaitingAckError,
  RgbTransferCanceledError,
  RgbTransferRejectedError,
  decodeRgbInvoice,
  createBfaBurnDestinationV1,
} from '@unisat/rgb-service'
import type { BfaBurnDestinationV1 } from '@unisat/rgb-service'
import type { ToSignInput } from '@unisat/keyring-service/types'
import { assertValidFeeRate } from '@unisat/base-utils'
import { toRgbDisplayAmount, type ToSignData } from '@unisat/wallet-shared'

import { psbtFromString } from '../utils/psbt-utils'
import type { LocalRgbServiceContext } from './RgbWalletCoordinator'

/** Finalize a copy for node preflight while leaving the dApp's PSBT untouched. */
function finalizeSwapPsbtForPreflight(psbt: ReturnType<typeof psbtFromString>) {
  const finalized = psbt.clone()
  finalized.data.inputs.forEach((input, index) => {
    if (input.finalScriptSig || input.finalScriptWitness) return
    if (input.tapKeySig) {
      const signature = Buffer.from(input.tapKeySig)
      if (signature.length !== 64 && signature.length !== 65) {
        throw new Error(`RGB swap PSBT input ${index} has an invalid Taproot signature`)
      }
      // One-item witness stack: CompactSize(1), CompactSize(sig length), sig.
      input.finalScriptWitness = Buffer.concat([Buffer.from([1, signature.length]), signature])
      return
    }
    try {
      finalized.finalizeInput(index)
    } catch {
      throw new Error(`RGB swap PSBT input ${index} is not fully signed`)
    }
  })
  return finalized
}

type RgbSendOperationsDependencies = {
  getContext: () => Promise<LocalRgbServiceContext>
  ensureWriteLease?: (
    context: LocalRgbServiceContext,
    options?: { forceRenew?: boolean }
  ) => Promise<void>
  getFeeRate: () => Promise<number | undefined>
  getToSignData: (params: {
    wallet: LocalRgbServiceContext['wallet']
    psbt: string
    toSignInputs: ToSignInput[]
    amountDisplay: string
    actionName: string
  }) => Promise<ToSignData>
  getActiveTransferId: (fundingAddress: string) => string | undefined
  setActiveTransferId: (fundingAddress: string, transferId: string) => void
  clearActiveTransferId: (fundingAddress: string) => void
  assertContext?: (context: LocalRgbServiceContext) => Promise<void>
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
  burn?: boolean
  burnReason?: string
  burnDestinationChainId?: number
  burnDestination?: BfaBurnDestinationV1
  /** Maker-built, unsigned swap template. It is validated and colored locally. */
  swapPsbt?: string
  instantSwap?: boolean
  /** Trusted provider origin persisted with a dApp-created payment. */
  providerOrigin?: string
}

/** Local RGB send state machine. Signing presentation remains a controller-provided capability. */
/* eslint-disable @typescript-eslint/explicit-function-return-type -- preserve precise inferred service result contracts. */
export class RgbSendOperations {
  constructor(private readonly dependencies: RgbSendOperationsDependencies) {}

  async begin(params: RgbSendBeginParams) {
    const { service, wallet } = await this.dependencies.getContext()
    await this.dependencies.ensureWriteLease?.({ service, wallet })
    await this.dependencies.assertContext?.({ service, wallet })
    const feeRate = params.feeRate ?? (await this.dependencies.getFeeRate())
    await this.dependencies.assertContext?.({ service, wallet })
    const validatedFeeRate = assertValidFeeRate(feeRate, { supportLowFeeMode: true })
    const burnDestination = params.burnDestination ||
      (params.burn && params.burnDestinationChainId
        ? createBfaBurnDestinationV1(params.burnDestinationChainId, params.burnReason || '')
        : undefined)

    await service.sync()
    await this.dependencies.assertContext?.({ service, wallet })
    const sendRequest =
      {
        assetId: params.assetId,
        invoice: params.invoice,
        feeRate: validatedFeeRate,
        ...(params.precision === undefined ? {} : { precision: params.precision }),
        ...(params.amount === undefined ? {} : { amount: String(params.amount) }),
        ...(params.donation === undefined ? {} : { donation: params.donation }),
        ...(params.burn === undefined ? {} : { burn: params.burn }),
        ...(params.burnReason === undefined ? {} : { burnReason: params.burnReason }),
        ...(burnDestination === undefined ? {} : { burnDestination }),
        ...(params.minConfirmations === undefined
          ? {}
          : { minConfirmations: params.minConfirmations }),
        ...(params.swapPsbt === undefined ? {} : { swapPsbt: params.swapPsbt }),
        ...(params.instantSwap === undefined ? {} : { instantSwap: params.instantSwap }),
      }
    const burnRequest = {
      assetId: params.assetId,
      amount: String(params.amount || ''),
      feeRate: validatedFeeRate,
      ...(params.precision === undefined ? {} : { precision: params.precision }),
      ...(params.burnReason === undefined ? {} : { burnReason: params.burnReason }),
      ...(burnDestination === undefined ? {} : { burnDestination }),
      ...(params.minConfirmations === undefined
        ? {}
        : { minConfirmations: params.minConfirmations }),
    }
    const prepared = params.burn
      ? params.providerOrigin === undefined
        ? await service.prepareBurn(burnRequest)
        : await service.prepareBurn(burnRequest, { providerOrigin: params.providerOrigin })
      : await service.prepareSend(
          sendRequest,
          params.providerOrigin === undefined ? {} : { providerOrigin: params.providerOrigin }
        )
    await this.dependencies.assertContext?.({ service, wallet })
    const toSignData = await this.dependencies.getToSignData({
      wallet,
      psbt: prepared.psbt,
      toSignInputs: prepared.toSignInputs,
      amountDisplay: getAmountDisplay(params),
      actionName: prepared.metadata?.['burnSplit'] === 'true'
        ? `Split ${getAssetLabel(params)} for burn`
        : params.burn
        ? `Burn ${getAssetLabel(params)}`
        : params.donation
        ? `Send ${getAssetLabel(params)} without recipient acceptance`
        : `Send ${getAssetLabel(params)}`,
    })
    this.dependencies.setActiveTransferId(wallet.fundingAddress, prepared.id)
    return {
      ...prepared,
      txid: prepared.id,
      ...(prepared.metadata?.['burnSplit'] === 'true' ? { burnSplitRequired: true } : {}),
      psbtHex: toSignData.psbtHex,
      toSignData,
    }
  }

  async beginAllocationSplit(params: {
    txid: string
    vout: number
    feeRate?: number
    providerOrigin?: string
  }) {
    const { service, wallet } = await this.dependencies.getContext()
    await this.dependencies.ensureWriteLease?.({ service, wallet })
    await this.dependencies.assertContext?.({ service, wallet })
    const feeRate = assertValidFeeRate(params.feeRate ?? (await this.dependencies.getFeeRate()), {
      supportLowFeeMode: true,
    })
    await service.sync()
    const prepared = await service.prepareAllocationSplit(
      { txid: params.txid, vout: params.vout, feeRate },
      params.providerOrigin ? { providerOrigin: params.providerOrigin } : {}
    )
    const pending = service.getPendingTransfers().find(item => item.id === prepared.id)
    const assetCount = pending?.allocationSplit?.assets.length || 0
    const toSignData = await this.dependencies.getToSignData({
      wallet,
      psbt: prepared.psbt,
      toSignInputs: prepared.toSignInputs,
      amountDisplay: `${assetCount} RGB assets`,
      actionName: 'Split RGB asset UTXO',
    })
    this.dependencies.setActiveTransferId(wallet.fundingAddress, prepared.id)
    return { ...prepared, txid: prepared.id, psbtHex: toSignData.psbtHex, toSignData }
  }

  async complete(params: { signedPsbt: string; transferId?: string }) {
    const { service, wallet } = await this.dependencies.getContext()
    // A signer may be open long enough for another device to take over. Do
    // not complete delivery or broadcast using a locally cached lease.
    await this.dependencies.ensureWriteLease?.({ service, wallet }, { forceRenew: true })
    await this.dependencies.assertContext?.({ service, wallet })
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
    const selectedPending = pending.find(transfer => transfer.id === transferId)
    const burnSplit = selectedPending?.burnSplit
    const allocationSplit = selectedPending?.allocationSplit
    this.dependencies.setActiveTransferId(wallet.fundingAddress, transferId)
    try {
      const completed = await service.completeSend(
        transferId,
        psbtFromString(params.signedPsbt).toBase64()
      )
      if (burnSplit) {
        return {
          transferId,
          txid: completed.txid,
          status: 'burn_split_complete' as const,
        }
      }
      if (allocationSplit) {
        return {
          transferId,
          txid: completed.txid,
          status: 'allocation_split_complete' as const,
        }
      }
      const latest = service.getPendingTransfers().find(item => item.id === transferId)
      return latest?.delivery?.acknowledgedAt
        ? { transferId, txid: completed.txid, status: 'ready_to_broadcast' as const }
        : completed
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
      if (error instanceof RgbTransferCanceledError) {
        return { transferId, txid: error.txid, status: 'canceled' as const }
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

  /** Signer output for a seller-side atomic swap: publish RGB only, never broadcast. */
  async publishSwap(params: { transferId: string; signedPsbt: string }) {
    const { service, wallet } = await this.dependencies.getContext()
    await this.dependencies.ensureWriteLease?.({ service, wallet }, { forceRenew: true })
    const completed = await service.publishSwap(
      params.transferId,
      psbtFromString(params.signedPsbt).toBase64()
    )
    return {
      transferId: params.transferId,
      txid: completed.txid,
      status: 'awaiting_buyer_signature' as const,
    }
  }

  async finalizeInstantListing(params: {
    transferId: string
    signedPsbt: string
    priceSats: string
  }) {
    const { service, wallet } = await this.dependencies.getContext()
    await this.dependencies.ensureWriteLease?.({ service, wallet }, { forceRenew: true })
    return service.finalizeInstantListing(
      params.transferId,
      psbtFromString(params.signedPsbt).toHex(),
      params.priceSats
    )
  }

  /** Sign the standard buyer commitment with this seller transfer's Proxy key. */
  async signBuySwapCommit(params: {
    transferId: string
    txid: string
    buyerSignedPsbtHash: string
  }) {
    const { service, wallet } = await this.dependencies.getContext()
    await this.dependencies.ensureWriteLease?.({ service, wallet }, { forceRenew: true })
    return service.signPublishedSwapBuyerCommitment(
      params.transferId,
      params.txid,
      params.buyerSignedPsbtHash
    )
  }

  /** Record buyer ACK/signatures; the dApp finalizes and broadcasts the PSBT. */
  async prepareExternalSwapBroadcast(params: { transferId: string; signedPsbt: string }) {
    const { service, wallet } = await this.dependencies.getContext()
    await this.dependencies.ensureWriteLease?.({ service, wallet }, { forceRenew: true })
    const relayedPsbt = psbtFromString(params.signedPsbt)
    const makerSignedPsbt = service.getPendingTransfers()
      .find(item => item.id === params.transferId)
      ?.delivery?.makerSignedPsbt
    if (makerSignedPsbt) {
      // Never rely on the market relay to preserve the seller signature. The
      // wallet retained the approved maker PSBT specifically so it can merge
      // that signature back into the buyer-completed transaction here.
      relayedPsbt.combine(psbtFromString(makerSignedPsbt))
    }
    const finalizedForPreflight = finalizeSwapPsbtForPreflight(relayedPsbt)
    const completed = await service.completePublishedSwap(
      params.transferId,
      finalizedForPreflight.toBase64(),
      { externalBroadcast: true }
    )
    return {
      transferId: params.transferId,
      txid: completed.txid,
      signedPsbt: relayedPsbt.toHex(),
      status: 'ready_for_dapp_finalize' as const,
    }
  }

  /** Query and verify the Proxy ACK for a backend-controlled seller swap. */
  async syncSellSwapAcknowledgement(transferId: string) {
    const { service, wallet } = await this.dependencies.getContext()
    await this.dependencies.ensureWriteLease?.({ service, wallet }, { forceRenew: true })
    return service.syncPublishedSwapAcknowledgement(transferId)
  }

  async retryBroadcast(transferId: string) {
    const { service, wallet } = await this.dependencies.getContext()
    // Retrying can broadcast a previously prepared transaction, so it needs
    // the same authoritative lease check as signed completion.
    await this.dependencies.ensureWriteLease?.({ service, wallet }, { forceRenew: true })
    const transfer = service.getPendingTransfers().find(item => item.id === transferId)
    if (!(transfer?.delivery?.acknowledgedAt || transfer?.delivery?.donationReadyAt || transfer?.request.burn || transfer?.burnSplit) ||
      transfer?.delivery?.externalBroadcast) {
      return { broadcast: false, status: 'not_retryable' as const }
    }
    try {
      await this.dependencies.assertContext?.({ service, wallet })
      await service.broadcastPendingSend(transferId)
    } catch (error) {
      if (error instanceof RgbTransferCanceledError) {
        return { broadcast: false, status: 'canceled' as const, error: error.message }
      }
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
    const latest = service.getPendingTransfers().find(item => item.id === transferId)
    if (latest?.broadcast) return { broadcast: true, status: 'confirming' as const }
    if (latest?.delivery?.broadcastError) {
      return {
        broadcast: false,
        status: 'broadcast_failed' as const,
        error: latest.delivery.broadcastError,
      }
    }
    if (latest?.delivery) return { broadcast: false, status: 'ready_to_broadcast' as const }
    // Broadcast synchronization may compact the local pending transfer
    // immediately. It is confirming, not a user cancellation.
    return { broadcast: true, status: 'confirming' as const }
  }

  async requestBroadcastCancellationReview(transferId: string) {
    const { service, wallet } = await this.dependencies.getContext()
    await this.dependencies.ensureWriteLease?.({ service, wallet }, { forceRenew: true })
    await this.dependencies.assertContext?.({ service, wallet })
    return service.requestBroadcastCancellationReview(transferId)
  }

  async abortVanillaTx(
    txid: string,
    boundContext?: LocalRgbServiceContext,
    options: { discardUnsigned?: boolean } = {}
  ) {
    const { service, wallet } = boundContext ?? (await this.dependencies.getContext())
    await this.dependencies.ensureWriteLease?.({ service, wallet })
    await this.dependencies.assertContext?.({ service, wallet })
    const requestedId = String(txid).replace(/^local-send:/, '')
    const match = service
      .getPendingTransfers()
      .find(
        transfer =>
          transfer.id === requestedId ||
          transfer.delivery?.completed.txid === requestedId ||
          transfer.broadcast?.completed.txid === requestedId
      )
    if (!match) return { aborted: false, local: true, reason: 'transfer_not_found' as const }

    const result = await service.abortSend(match.id, options)
    if (
      result.aborted &&
      this.dependencies.getActiveTransferId(wallet.fundingAddress) === match.id
    ) {
      this.dependencies.clearActiveTransferId(wallet.fundingAddress)
    }
    return { ...result, local: true, transferId: match.id }
  }

  async abortAcknowledgedSwap(txid: string, boundContext?: LocalRgbServiceContext) {
    const { service, wallet } = boundContext ?? (await this.dependencies.getContext())
    await this.dependencies.ensureWriteLease?.({ service, wallet })
    await this.dependencies.assertContext?.({ service, wallet })
    const requestedId = String(txid).replace(/^local-send:/, '')
    const match = service.getPendingTransfers().find(
      transfer =>
        transfer.id === requestedId ||
        transfer.delivery?.completed.txid === requestedId ||
        transfer.broadcast?.completed.txid === requestedId
    )
    if (!match) return { aborted: false, local: true, reason: 'transfer_not_found' as const }
    const result = await service.abortAcknowledgedSwap(match.id)
    if (
      result.aborted &&
      this.dependencies.getActiveTransferId(wallet.fundingAddress) === match.id
    ) {
      this.dependencies.clearActiveTransferId(wallet.fundingAddress)
    }
    return { ...result, local: true, transferId: match.id }
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
