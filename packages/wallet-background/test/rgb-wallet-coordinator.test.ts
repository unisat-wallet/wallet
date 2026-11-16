import { describe, expect, it, vi } from 'vitest'

import {
  isSameRgbWallet,
  RgbWalletContextChangedError,
  RgbWalletCoordinator,
} from '../src/rgb/RgbWalletCoordinator'

describe('RgbWalletCoordinator', () => {
  it('refreshes pending allocations when recovery backup is disabled', async () => {
    const snapshot = {
      syncedAt: 1,
      utxos: [{
        chainStatus: 'mempool',
        allocations: [{ assetId: 'rgb:asset', amount: '95', settled: false }],
      }],
    }
    const service = {
      isRecoveryBackupEnabled: vi.fn().mockReturnValue(false),
      getSnapshot: vi.fn().mockReturnValue(snapshot),
      hasKnownAssetHistory: vi.fn().mockReturnValue(true),
      sync: vi.fn().mockResolvedValue(snapshot),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'bc1p-funding', network: 'mainnet' },
    }
    const coordinator = new RgbWalletCoordinator({
      getContext: vi.fn().mockResolvedValue(context as any),
      getReadContext: vi.fn().mockResolvedValue(context as any),
      syncIndexerOutbox: vi.fn(),
      syncReceiveHistory: vi.fn(),
      tryEnsureWriteLease: vi.fn().mockResolvedValue(true),
    })

    await coordinator.syncListState()

    expect(service.sync).toHaveBeenCalledOnce()
  })

  it('refreshes an empty RGB snapshot when the wallet has asset history', async () => {
    const service = {
      isRecoveryBackupEnabled: vi.fn().mockReturnValue(true),
      getSnapshot: vi.fn().mockReturnValue({ syncedAt: 1, utxos: [] }),
      hasKnownAssetHistory: vi.fn().mockReturnValue(true),
      sync: vi.fn().mockResolvedValue({ syncedAt: 2, utxos: [] }),
    }
    const context = {
      service,
      wallet: {
        walletId: 'wallet-1',
        fundingAddress: 'bc1p-funding',
        network: 'mainnet' as const,
      },
    }
    const tryEnsureWriteLease = vi.fn().mockResolvedValue(true)
    const coordinator = new RgbWalletCoordinator({
      getContext: vi.fn().mockResolvedValue(context as any),
      syncIndexerOutbox: vi.fn(),
      syncReceiveHistory: vi.fn(),
      tryEnsureWriteLease,
    })

    await coordinator.syncListState()

    expect(tryEnsureWriteLease).toHaveBeenCalledOnce()
    expect(service.sync).toHaveBeenCalledOnce()
  })

  it('publishes a recovered allocation after the receive invoice has settled', async () => {
    const pending = { txid: 'a'.repeat(64), outpoints: [] }
    const service = {
      isRecoveryBackupEnabled: vi.fn().mockReturnValue(true),
      getSnapshot: vi.fn().mockReturnValue({ syncedAt: 1, utxos: [] }),
      hasKnownAssetHistory: vi.fn().mockReturnValue(true),
      getPendingUtxoSync: vi.fn().mockReturnValue(pending),
      sync: vi.fn().mockResolvedValue({ syncedAt: 1, utxos: [] }),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'bc1p-funding', network: 'mainnet' },
    }
    const syncIndexerOutbox = vi.fn().mockResolvedValue(true)
    const coordinator = new RgbWalletCoordinator({
      getContext: vi.fn().mockResolvedValue(context as any),
      syncIndexerOutbox,
      syncReceiveHistory: vi.fn(),
      tryEnsureWriteLease: vi.fn().mockResolvedValue(true),
    })

    await coordinator.syncListState()

    expect(service.sync).toHaveBeenCalledOnce()
    expect(syncIndexerOutbox).toHaveBeenCalledWith(service, context.wallet)
  })

  it('checks pending RGB allocations sooner than settled balances', async () => {
    const snapshot = {
      syncedAt: 1,
      utxos: [{
        chainStatus: 'mempool',
        allocations: [{ assetId: 'rgb-asset', amount: '998', settled: false }],
      }],
    }
    const service = {
      isRecoveryBackupEnabled: vi.fn().mockReturnValue(true),
      getSnapshot: vi.fn().mockReturnValue(snapshot),
      hasKnownAssetHistory: vi.fn().mockReturnValue(true),
      sync: vi.fn().mockResolvedValue(snapshot),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet-1', fundingAddress: 'bc1p-funding', network: 'mainnet' },
    }
    const coordinator = new RgbWalletCoordinator({
      getContext: vi.fn().mockResolvedValue(context as any),
      syncIndexerOutbox: vi.fn(),
      syncReceiveHistory: vi.fn(),
      tryEnsureWriteLease: vi.fn().mockResolvedValue(true),
    })
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      await coordinator.syncListState()
      vi.spyOn(Date, 'now').mockReturnValue(now + 9_000)
      await coordinator.syncListState()
      expect(service.sync).toHaveBeenCalledTimes(1)

      vi.spyOn(Date, 'now').mockReturnValue(now + 10_000)
      await coordinator.syncListState()
      expect(service.sync).toHaveBeenCalledTimes(2)

      snapshot.utxos[0]!.allocations[0]!.settled = true
      snapshot.utxos[0]!.chainStatus = 'confirmed'
      vi.spyOn(Date, 'now').mockReturnValue(now + 20_000)
      await coordinator.syncListState()
      expect(service.sync).toHaveBeenCalledTimes(2)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('reuses a recent token-balance snapshot while polling an unresolved invoice', async () => {
    const seal = { txid: 'a'.repeat(64), vout: 0, blinding: 1n }
    const snapshot = {
      syncedAt: 1,
      utxos: [{
        outpoint: { txid: seal.txid, vout: seal.vout },
        chainStatus: 'mempool', allocations: [],
      }],
    }
    const service = {
      isRecoveryBackupEnabled: vi.fn().mockReturnValue(true),
      hasKnownAssetHistory: vi.fn().mockReturnValue(true),
      getSnapshot: vi.fn().mockReturnValue(snapshot),
      getPendingReceives: vi.fn().mockReturnValue([{ recipientId: 'invoice', seal }]),
      claimPendingReceives: vi.fn(),
      processBroadcastCancellations: vi.fn(),
      processClaimedReceives: vi.fn().mockResolvedValue({ received: 0, snapshotRequired: false }),
      sync: vi.fn().mockResolvedValue(snapshot),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'bc1p-funding', network: 'mainnet' },
    }
    const coordinator = new RgbWalletCoordinator({
      getContext: vi.fn().mockResolvedValue(context as any),
      getReadContext: vi.fn().mockResolvedValue(context as any),
      syncIndexerOutbox: vi.fn().mockResolvedValue(true),
      syncReceiveHistory: vi.fn(),
      tryEnsureWriteLease: vi.fn().mockResolvedValue(true),
    })

    await coordinator.syncListState()
    await coordinator.syncReceivedAllocations(context as any)

    expect(service.sync).toHaveBeenCalledTimes(1)
  })

  it('bypasses receive and snapshot throttles for an explicit refresh', async () => {
    const snapshot = {
      syncedAt: 1,
      utxos: [{
        outpoint: { txid: 'a'.repeat(64), vout: 0 },
        chainStatus: 'mempool',
        allocations: [{ assetId: 'rgb:asset', amount: '1', settled: false, spendable: false }],
      }],
    }
    const service = {
      hasKnownAssetHistory: vi.fn().mockReturnValue(true),
      getSnapshot: vi.fn().mockReturnValue(snapshot),
      getPendingReceives: vi.fn().mockReturnValue([]),
      claimPendingReceives: vi.fn(),
      processBroadcastCancellations: vi.fn(),
      processClaimedReceives: vi.fn().mockResolvedValue({ received: 0, snapshotRequired: false }),
      getPendingUtxoSync: vi.fn(),
      sync: vi.fn().mockResolvedValue(snapshot),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'bc1p-funding', network: 'mainnet' },
    }
    const coordinator = new RgbWalletCoordinator({
      getContext: vi.fn().mockResolvedValue(context as any),
      getReadContext: vi.fn().mockResolvedValue(context as any),
      syncIndexerOutbox: vi.fn().mockResolvedValue(true),
      syncReceiveHistory: vi.fn(),
      tryEnsureWriteLease: vi.fn().mockResolvedValue(true),
    })

    await coordinator.syncReceivedAllocations(context as any)
    await coordinator.syncReceivedAllocations(context as any)
    await coordinator.syncReceivedAllocations(context as any, undefined, { force: true })
    expect(service.processClaimedReceives).toHaveBeenCalledTimes(2)

    await coordinator.syncListState()
    await coordinator.syncListState()
    await coordinator.syncListState({ force: true })
    expect(service.sync).toHaveBeenCalledTimes(2)
  })

  it('treats the network and wallet id as part of RGB wallet identity', () => {
    const wallet = {
      walletId: 'wallet-1',
      fundingAddress: 'bc1p-funding',
      network: 'mainnet' as const,
    }
    expect(isSameRgbWallet(wallet, { ...wallet })).toBe(true)
    expect(isSameRgbWallet(wallet, { ...wallet, walletId: 'wallet-2' })).toBe(false)
    expect(isSameRgbWallet(wallet, { ...wallet, fundingAddress: 'bc1p-other' })).toBe(false)
    expect(isSameRgbWallet(wallet, { ...wallet, network: 'fractal-mainnet' })).toBe(false)
  })

  it('keeps receive synchronization bound to the context captured by its caller', async () => {
    const service = {
      claimPendingReceives: vi.fn().mockResolvedValue({ claimed: 0 }),
      getPendingReceives: vi.fn().mockReturnValue([]),
      getSnapshot: vi.fn().mockReturnValue({ syncedAt: 1, utxos: [] }),
      processClaimedReceives: vi.fn().mockResolvedValue({
        received: 0,
        snapshotRequired: false,
      }),
    }
    const boundContext = {
      service,
      wallet: {
        walletId: 'account-2',
        fundingAddress: 'bc1p-account-2',
        network: 'mainnet' as const,
      },
    }
    const getContext = vi.fn().mockRejectedValue(new Error('must not read the active account'))
    const coordinator = new RgbWalletCoordinator({
      getContext,
      syncIndexerOutbox: vi.fn().mockResolvedValue(true),
      syncReceiveHistory: vi.fn().mockResolvedValue(undefined),
      tryEnsureWriteLease: vi.fn().mockResolvedValue(true),
    })

    await expect(coordinator.syncReceivedAllocations(boundContext as any)).resolves.toBe(
      boundContext
    )
    expect(getContext).not.toHaveBeenCalled()
    expect(service.processClaimedReceives).toHaveBeenCalled()
  })

  it('runs witness key backfill after one lease check and before receive writes', async () => {
    const calls: string[] = []
    const service = {
      claimPendingReceives: vi.fn(async () => { calls.push('claim') }),
      getPendingReceives: vi.fn(() => []),
      getSnapshot: vi.fn(() => ({ utxos: [] })),
      processClaimedReceives: vi.fn(async () => ({ received: 0, snapshotRequired: false })),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'bc1p-funding', network: 'mainnet' as const },
    }
    const tryEnsureWriteLease = vi.fn(async () => { calls.push('lease'); return true })
    const beforeSync = vi.fn(async () => { calls.push('backfill') })
    const coordinator = new RgbWalletCoordinator({
      getContext: vi.fn().mockResolvedValue(context as any),
      syncIndexerOutbox: vi.fn().mockResolvedValue(true),
      syncReceiveHistory: vi.fn().mockResolvedValue(undefined),
      tryEnsureWriteLease,
    })

    await coordinator.syncReceivedAllocations(context as any, beforeSync)

    expect(tryEnsureWriteLease).toHaveBeenCalledOnce()
    expect(calls.slice(0, 3)).toEqual(['lease', 'backfill', 'claim'])
  })

  it('cancels receive processing when the active wallet changes after lease acquisition', async () => {
    const service = {
      claimPendingReceives: vi.fn().mockResolvedValue({ claimed: 0 }),
      getPendingReceives: vi.fn().mockReturnValue([]),
      getSnapshot: vi.fn().mockReturnValue({ syncedAt: 1, utxos: [] }),
      processClaimedReceives: vi.fn(),
    }
    const context = {
      service,
      wallet: {
        walletId: 'account-2',
        fundingAddress: 'bc1p-account-2',
        network: 'mainnet' as const,
      },
    }
    const coordinator = new RgbWalletCoordinator({
      getContext: vi.fn().mockResolvedValue(context),
      syncIndexerOutbox: vi.fn(),
      syncReceiveHistory: vi.fn(),
      tryEnsureWriteLease: vi.fn().mockResolvedValue(true),
      assertContext: vi.fn().mockRejectedValue(new RgbWalletContextChangedError()),
    })

    await expect(coordinator.syncReceivedAllocations(context as any)).rejects.toBeInstanceOf(
      RgbWalletContextChangedError
    )
    expect(service.claimPendingReceives).not.toHaveBeenCalled()
    expect(service.processClaimedReceives).not.toHaveBeenCalled()
  })
})
