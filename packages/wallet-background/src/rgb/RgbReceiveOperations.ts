import type { RgbService } from '@unisat/rgb-service'

import type { LocalRgbServiceContext } from './RgbWalletCoordinator'
import {
  getRgbReceiveInvoiceStatus,
  toPublicRgbPendingReceiveInvoice,
  type RgbPendingReceiveInvoice,
} from './rgbPresentation'

type RgbReceiveOperationsDependencies = {
  getContext: () => Promise<LocalRgbServiceContext>
  ensureWriteLease?: (context: LocalRgbServiceContext) => Promise<void>
  syncReceivedAllocations: () => Promise<LocalRgbServiceContext>
}

export type RgbBlindReceiveParams = {
  assetId?: string
  amount?: number | string
  durationSeconds?: number
  skipSync?: boolean
}

/** Local blind-invoice lifecycle, independent of controller RPC and keyring details. */
export class RgbReceiveOperations {
  constructor(private readonly dependencies: RgbReceiveOperationsDependencies) {}

  async createBlindReceive(params: RgbBlindReceiveParams): Promise<RgbPendingReceiveInvoice> {
    const context = await this.dependencies.getContext()
    const { service } = context
    await this.dependencies.ensureWriteLease?.(context)
    if (!params.skipSync) await service.sync()
    const receive = await service.createBlindReceive({
      ...(params.assetId === undefined ? {} : { assetId: params.assetId }),
      ...(params.amount === undefined ? {} : { amount: String(params.amount) }),
      ...(params.durationSeconds === undefined ? {} : { durationSeconds: params.durationSeconds }),
      // The following claim updates this exact pending receive and performs
      // the durable checkpoint. Avoid uploading the intermediate, unclaimed
      // invoice state only to upload it again a few milliseconds later.
      deferRecoveryCheckpoint: true,
    })
    // Persist recipient ownership before a sender uploads the consignment, so a
    // reinstalled wallet can discover it even when the proxy is no longer available.
    await service.claimPendingReceives()
    const batchTransferIdx = service
      .getPendingReceives()
      .findIndex(item => item.recipientId === receive.recipientId)
    return toPublicRgbPendingReceiveInvoice(
      receive,
      batchTransferIdx < 0 ? undefined : batchTransferIdx,
      getRgbReceiveInvoiceStatus(service.getSnapshot(), receive)
    )
  }

  async getPendingReceiveInvoices(): Promise<{ list: RgbPendingReceiveInvoice[] }> {
    let { service } = await this.dependencies.getContext()
    if (!service.getPendingReceives().length) return { list: [] }
    ;({ service } = await this.dependencies.syncReceivedAllocations())
    return {
      list: service
        .getPendingReceives()
        .map((item, batchTransferIdx) =>
          toPublicRgbPendingReceiveInvoice(
            item,
            batchTransferIdx,
            getRgbReceiveInvoiceStatus(service.getSnapshot(), item)
          )
        ),
    }
  }

  async cancelReceiveInvoice(batchTransferIdx: number): Promise<{ changed: boolean }> {
    const context = await this.dependencies.getContext()
    const { service } = context
    const pending = service.getPendingReceives()[batchTransferIdx]
    if (!pending) return { changed: false }
    await this.dependencies.ensureWriteLease?.(context)
    const result = await service.cancelBlindReceive(pending.recipientId)
    return { changed: result.cancelled }
  }

  async acceptReceive(
    recipientId: string
  ): Promise<Awaited<ReturnType<RgbService['acceptReceive']>>> {
    const context = await this.dependencies.getContext()
    const { service } = context
    await this.dependencies.ensureWriteLease?.(context)
    return service.acceptReceive(recipientId)
  }

  async rejectReceive(
    recipientId: string
  ): Promise<Awaited<ReturnType<RgbService['rejectReceive']>>> {
    const context = await this.dependencies.getContext()
    const { service } = context
    await this.dependencies.ensureWriteLease?.(context)
    return service.rejectReceive(recipientId)
  }

  async abandonAcceptedReceive(
    recipientId: string
  ): Promise<Awaited<ReturnType<RgbService['abandonAcceptedReceive']>>> {
    const context = await this.dependencies.getContext()
    const { service } = context
    await this.dependencies.ensureWriteLease?.(context)
    return service.abandonAcceptedReceive(recipientId)
  }

  async getAllocationSummary(params: { skipSync?: boolean } = {}): Promise<{
    available: boolean
    availableAllocationCount: number
    freeAllocationCount: number
    colorableUtxoCount: number
    pendingConfirmation: boolean
    pendingAllocationCount: number
  }> {
    const { service } = await this.dependencies.getContext()
    if (!params.skipSync) await service.sync()
    const free = service.getAvailableReceiveUtxos()
    const pending = service.getPendingConfirmationReceiveUtxos?.() ?? []
    return {
      available: free.length > 0,
      availableAllocationCount: free.length,
      freeAllocationCount: free.length,
      colorableUtxoCount: free.length,
      pendingConfirmation: pending.length > 0,
      pendingAllocationCount: pending.length,
    }
  }
}
