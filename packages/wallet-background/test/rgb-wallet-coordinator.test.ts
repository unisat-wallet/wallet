import { describe, expect, it, vi } from 'vitest'

import {
  isSameRgbWallet,
  RgbWalletContextChangedError,
  RgbWalletCoordinator,
} from '../src/rgb/RgbWalletCoordinator'

describe('RgbWalletCoordinator', () => {
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
