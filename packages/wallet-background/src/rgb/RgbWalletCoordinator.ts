import { RgbService, RgbTransferAwaitingAckError, type RgbWalletRef } from '@unisat/rgb-service'

export type LocalRgbWallet = Required<Pick<RgbWalletRef, 'walletId' | 'fundingAddress' | 'network'>>

export type LocalRgbServiceContext = {
  service: RgbService
  wallet: LocalRgbWallet
}

type RgbWalletCoordinatorDependencies = {
  getContext: () => Promise<LocalRgbServiceContext>
  /** Read-only local context; available even while recovery/index APIs are down. */
  getReadContext?: () => Promise<LocalRgbServiceContext>
  syncIndexerOutbox: (service: RgbService, wallet: LocalRgbWallet) => Promise<boolean>
  syncReceiveHistory: (service: RgbService, wallet: LocalRgbWallet) => Promise<void>
}

const LIST_SNAPSHOT_SYNC_INTERVAL = 60_000
const RECEIVE_POLL_INTERVAL = 10_000

/** Owns per-funding-wallet RGB polling, snapshot synchronization, and local locks. */
export class RgbWalletCoordinator {
  private readonly activeTransferIds = new Map<string, string>()
  private readonly snapshotSyncAt = new Map<string, number>()
  private readonly snapshotSyncing = new Map<string, Promise<void>>()
  private readonly receivePollingAt = new Map<string, number>()
  private readonly receivePolling = new Map<string, Promise<LocalRgbServiceContext>>()

  constructor(private readonly dependencies: RgbWalletCoordinatorDependencies) {}

  clear(): void {
    this.activeTransferIds.clear()
    this.snapshotSyncAt.clear()
    this.snapshotSyncing.clear()
    this.receivePollingAt.clear()
    this.receivePolling.clear()
  }

  getActiveTransferId(fundingAddress: string): string | undefined {
    return this.activeTransferIds.get(fundingAddress)
  }

  setActiveTransferId(fundingAddress: string, transferId: string): void {
    this.activeTransferIds.set(fundingAddress, transferId)
  }

  clearActiveTransferId(fundingAddress: string): void {
    this.activeTransferIds.delete(fundingAddress)
  }

  async syncReceivedAllocations(): Promise<LocalRgbServiceContext> {
    const context = await this.dependencies.getContext()
    const key = walletKey(context.wallet)
    const activePolling = this.receivePolling.get(key)
    if (activePolling) return activePolling
    if ((this.receivePollingAt.get(key) ?? 0) + RECEIVE_POLL_INTERVAL > Date.now()) {
      return context
    }

    const polling = this.syncReceivedAllocationsOnce(context)
      .then(result => {
        this.receivePollingAt.set(key, Date.now())
        return result
      })
      .finally(() => {
        this.receivePolling.delete(key)
      })
    this.receivePolling.set(key, polling)
    return polling
  }

  async syncListState(): Promise<void> {
    const { service, wallet } = await this.dependencies.getContext()
    const snapshot = service.getSnapshot()
    if (!snapshot.utxos.some(utxo => utxo.allocations.length > 0)) return

    try {
      await this.syncSnapshot(service, wallet, LIST_SNAPSHOT_SYNC_INTERVAL)
    } catch (error) {
      if (error instanceof RgbTransferAwaitingAckError) return
      throw error
    }
  }

  async syncPendingTransfers(service: RgbService): Promise<void> {
    await service.syncPendingTransfers()
  }

  async getPendingLockedAmounts(): Promise<Map<string, bigint>> {
    const { service } = await (
      this.dependencies.getReadContext?.() ?? this.dependencies.getContext()
    )
    const snapshot = service.getSnapshot?.()
    if (!snapshot) return new Map<string, bigint>()
    const lockedAmounts = new Map<string, bigint>()
    for (const pending of service.getPendingTransfers?.() || []) {
      if (pending.broadcast) continue
      const lockedOutpoints = new Set(
        pending.prepared.lockedOutpoints.map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
      )
      for (const utxo of snapshot.utxos) {
        if (!lockedOutpoints.has(`${utxo.outpoint.txid}:${utxo.outpoint.vout}`)) continue
        for (const allocation of utxo.allocations) {
          if (
            allocation.assetId !== pending.request.assetId ||
            !allocation.settled ||
            !allocation.spendable
          ) {
            continue
          }
          const current = lockedAmounts.get(allocation.assetId) ?? 0n
          lockedAmounts.set(allocation.assetId, current + BigInt(allocation.amount))
        }
      }
    }
    return lockedAmounts
  }

  private async syncReceivedAllocationsOnce(
    context: LocalRgbServiceContext
  ): Promise<LocalRgbServiceContext> {
    const { service, wallet } = context
    // Claims are durable recipient-to-address bindings. Retrying them here
    // covers invoices created while the recovery endpoint was unavailable.
    await service.claimPendingReceives?.()
    await this.dependencies.syncIndexerOutbox(service, wallet)
    // Invoice availability depends on its funding UTXO being confirmed. This
    // operation is already rate-limited by RECEIVE_POLL_INTERVAL, so force a
    // fresh snapshot for unresolved invoices instead of leaving their local
    // chainStatus at mempool forever.
    if (this.hasUnconfirmedInvoiceFunding(service)) {
      await this.syncSnapshot(service, wallet, 0)
    }
    let processed = await service.processClaimedReceives({
      includeClaimed: false,
      deferConfirmedSettlement: true,
    })
    if (processed.snapshotRequired) {
      await this.syncSnapshot(service, wallet, 0)
      processed = await service.processClaimedReceives({ includeClaimed: false })
    }
    if (processed.received) await this.dependencies.syncIndexerOutbox(service, wallet)
    await this.dependencies.syncReceiveHistory(service, wallet)
    return context
  }

  private hasUnconfirmedInvoiceFunding(service: RgbService): boolean {
    // Lightweight controller tests and compatibility hosts may not implement
    // receive tracking. They have no invoice funding state to refresh.
    const pendingReceives = service.getPendingReceives?.() || []
    if (!pendingReceives.length) return false
    const snapshot = service.getSnapshot()
    return pendingReceives.some(receive => {
      const funding = snapshot.utxos.find(
        utxo =>
          utxo.outpoint.txid === receive.seal.txid && utxo.outpoint.vout === receive.seal.vout
      )
      return funding?.chainStatus !== 'confirmed'
    })
  }

  private async syncSnapshot(
    service: RgbService,
    wallet: LocalRgbWallet,
    minInterval: number
  ): Promise<void> {
    const key = walletKey(wallet)
    const activeSync = this.snapshotSyncing.get(key)
    if (activeSync) return activeSync
    if ((this.snapshotSyncAt.get(key) ?? 0) + minInterval > Date.now()) return

    const sync = service
      .sync()
      .then(() => {
        this.snapshotSyncAt.set(key, Date.now())
      })
      .finally(() => {
        this.snapshotSyncing.delete(key)
      })
    this.snapshotSyncing.set(key, sync)
    return sync
  }
}

function walletKey(wallet: Pick<RgbWalletRef, 'network' | 'fundingAddress'>): string {
  return `${wallet.network}:${wallet.fundingAddress}`
}
