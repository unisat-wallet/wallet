import { describe, expect, it, vi } from 'vitest'

import {
  isSameRgbWallet,
  RgbWalletContextChangedError,
  RgbWalletCoordinator,
} from '../src/rgb/RgbWalletCoordinator'

describe('RgbWalletCoordinator', () => {
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
