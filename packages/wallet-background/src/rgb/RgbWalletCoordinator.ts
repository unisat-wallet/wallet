import { RgbService, RgbTransferAwaitingAckError, type RgbWalletRef } from '@unisat/rgb-service'

export type LocalRgbWallet = Required<Pick<RgbWalletRef, 'walletId' | 'fundingAddress' | 'network'>>

export type LocalRgbServiceContext = {
  service: RgbService
  wallet: LocalRgbWallet
}

export class RgbWalletContextChangedError extends Error {
  constructor() {
    super('RGB operation canceled because the active wallet or network changed')
    this.name = 'RgbWalletContextChangedError'
  }
}

export function isSameRgbWallet(
  left: Pick<LocalRgbWallet, 'walletId' | 'fundingAddress' | 'network'>,
  right: Pick<LocalRgbWallet, 'walletId' | 'fundingAddress' | 'network'>
): boolean {
  return (
    left.walletId === right.walletId &&
    left.fundingAddress === right.fundingAddress &&
    left.network === right.network
  )
}

type RgbWalletCoordinatorDependencies = {
  getContext: () => Promise<LocalRgbServiceContext>
  /** Read-only local context; available even while recovery/index APIs are down. */
  getReadContext?: () => Promise<LocalRgbServiceContext>
  syncIndexerOutbox: (service: RgbService, wallet: LocalRgbWallet) => Promise<boolean>
  syncReceiveHistory: (service: RgbService, wallet: LocalRgbWallet) => Promise<void>
  /** A secondary device remains readable, but must not publish index mutations. */
  tryEnsureWriteLease?: (
    context: LocalRgbServiceContext,
    options?: { forceRenew?: boolean }
  ) => Promise<boolean>
  assertContext?: (context: LocalRgbServiceContext) => Promise<void>
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

  async syncReceivedAllocations(
    boundContext?: LocalRgbServiceContext
  ): Promise<LocalRgbServiceContext> {
    const context = boundContext ?? (await this.dependencies.getContext())
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
    // This is initiated by a list render. Recovery may still be restoring or
    // intentionally read-only after a conflict, neither of which should turn
    // into a user-visible indexer error. Use local read state first and only
    // escalate to a writer after recovery has established a safe baseline.
    const context = await (this.dependencies.getReadContext?.() ?? this.dependencies.getContext())
    const { service, wallet } = context
    if (!service.isRecoveryBackupEnabled()) return
    const snapshot = service.getSnapshot()
    if (!snapshot.utxos.some(utxo => utxo.allocations.length > 0)) return
    const key = walletKey(wallet)
    // Avoid a lease round-trip when this is only a render-triggered call that
    // is already covered by an in-flight or recently completed list refresh.
    if (
      this.snapshotSyncing.has(key) ||
      (this.snapshotSyncAt.get(key) ?? 0) + LIST_SNAPSHOT_SYNC_INTERVAL > Date.now()
    ) {
      return
    }
    // Snapshot refresh can persist changed local state and enqueue a recovery
    // checkpoint. Acquire or renew before it runs; after a background restart
    // there is no in-memory lease to attach to that checkpoint.
    const canWrite =
      (await this.dependencies.tryEnsureWriteLease?.(context, { forceRenew: true })) ?? true
    if (!canWrite) return

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
    const { service } = await (this.dependencies.getReadContext?.() ??
      this.dependencies.getContext())
    const snapshot = service.getSnapshot?.()
    if (!snapshot) return new Map<string, bigint>()
    const lockedAmounts = new Map<string, bigint>()
    const lockedTransfers = [
      ...(service.getPendingTransfers?.() || []).map(pending => ({
        assetId: pending.request.assetId,
        lockedOutpoints: pending.prepared.lockedOutpoints,
      })),
      ...(service.getPendingSendHistory?.() || [])
        .filter(item => item.status === 'broadcasted')
        .map(item => ({
          assetId: item.assetId,
          lockedOutpoints: item.spentOutpoints || [],
        })),
    ]
    for (const transfer of lockedTransfers) {
      const lockedOutpoints = new Set(
        transfer.lockedOutpoints.map(outpoint => `${outpoint.txid}:${outpoint.vout}`)
      )
      for (const utxo of snapshot.utxos) {
        if (!lockedOutpoints.has(`${utxo.outpoint.txid}:${utxo.outpoint.vout}`)) continue
        for (const allocation of utxo.allocations) {
          if (
            allocation.assetId !== transfer.assetId ||
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
    // Receipt processing persists state and may acknowledge a consignment;
    // it is not safe to run as a read-only poller. Force a server round-trip
    // because another device may have fenced a locally cached lease.
    const canWrite =
      (await this.dependencies.tryEnsureWriteLease?.(context, { forceRenew: true })) ?? true
    if (!canWrite) return context
    await this.dependencies.assertContext?.(context)
    // Claims are durable recipient-to-address bindings. Retrying them here
    // covers invoices created while the recovery endpoint was unavailable.
    await service.claimPendingReceives?.()
    await service.processBroadcastCancellations?.()
    await this.dependencies.assertContext?.(context)
    await this.dependencies.syncIndexerOutbox(service, wallet)
    await this.dependencies.assertContext?.(context)
    // Invoice availability depends on its funding UTXO being confirmed. This
    // operation is already rate-limited by RECEIVE_POLL_INTERVAL, so force a
    // fresh snapshot for unresolved invoices instead of leaving their local
    // chainStatus at mempool forever.
    if (this.hasUnconfirmedInvoiceFunding(service)) {
      await this.syncSnapshot(service, wallet, 0)
      await this.dependencies.assertContext?.(context)
    }
    let processed = await service.processClaimedReceives({
      includeClaimed: false,
      deferConfirmedSettlement: true,
    })
    await this.dependencies.assertContext?.(context)
    if (processed.snapshotRequired) {
      // A confirmed witness receive has just registered its sender-created
      // output in the local outbox. The backend cannot derive it itself, so
      // publish that verified observation before requesting a fresh snapshot.
      await this.dependencies.syncIndexerOutbox(service, wallet)
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
      // A witness invoice has no pre-existing funding UTXO. Its outpoint is
      // created by the sender and only becomes known from the consignment.
      const seal = receive.seal
      if (!seal) return false
      const funding = snapshot.utxos.find(
        utxo => utxo.outpoint.txid === seal.txid && utxo.outpoint.vout === seal.vout
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
