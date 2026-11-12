import { act, renderHook, waitFor } from '@testing-library/react'
import { BUS_METHODS } from '@unisat/wallet-shared'
import { ChainType } from '@unisat/wallet-types'
import { describe, expect, it, vi } from 'vitest'

import { useRGBListLogic } from '../../src/ui-hooks/useRGBListLogic'
import { uiActions } from '../../src/reducers/ui'
import { settingsActions } from '../../src/reducers/settings'
import { WalletView } from '../../src/types/ui'
import { uiEventBus } from '../../src/utils/eventBus'
import { createHookTestHarness } from './testHelpers'

describe('useRGBListLogic', () => {
  const createRgbHookTestHarness = () =>
    createHookTestHarness({ chainType: ChainType.BITCOIN_TESTNET4 })

  it('shows the configured USDT asset even before the wallet holds it', async () => {
    const { store, wrapper, wallet } = createRgbHookTestHarness()
    wallet.getRGBAssetBalance.mockResolvedValue(undefined)
    store.dispatch(settingsActions.updateSettings({
      walletConfig: { ...store.getState().settings.walletConfig, rgbUsdtAssetId: 'rgb:usdt-asset' },
    }))

    const { result } = renderHook(() => useRGBListLogic(), { wrapper })

    await waitFor(() => expect(result.current.items).toEqual([
      expect.objectContaining({ assetId: 'rgb:usdt-asset', ticker: 'USDT', configuredUsdt: true, configuredPlaceholder: true }),
    ]))
    expect(result.current.total).toBe(1)
    expect(wallet.getRGBAssetBalance).toHaveBeenCalledWith('', 'rgb:usdt-asset')
  })

  it('shows an inert zero-balance USDT item when the configured asset ID is a dash', async () => {
    const { store, wrapper, wallet } = createRgbHookTestHarness()
    store.dispatch(settingsActions.updateSettings({
      walletConfig: { ...store.getState().settings.walletConfig, rgbUsdtAssetId: '-' },
    }))

    const { result } = renderHook(() => useRGBListLogic(), { wrapper })

    await waitFor(() => expect(result.current.hasLoaded).toBe(true))
    expect(result.current.items).toEqual([
      expect.objectContaining({ assetId: '-', ticker: 'USDT', spendable: '0', configuredUsdt: true, configurationUnavailable: true }),
    ])
    expect(result.current.total).toBe(1)
    expect(wallet.getRGBAssetBalance).not.toHaveBeenCalled()
  })

  it('does not duplicate configured USDT when it is already in the RGB asset list', async () => {
    const { store, wrapper, wallet } = createRgbHookTestHarness()
    store.dispatch(settingsActions.updateSettings({
      walletConfig: { ...store.getState().settings.walletConfig, rgbUsdtAssetId: 'rgb:usdt-asset' },
    }))
    wallet.getRGBList.mockResolvedValue({
      list: [{
        assetId: 'rgb:usdt-asset',
        ticker: 'USDT0',
        name: 'Tether',
        tokenInfo: { ticker: 'USDT0', name: 'Tether USD' },
        spendable: '42',
      }],
      total: 1,
    })
    wallet.getRGBAssetBalance.mockResolvedValue({ assetId: 'rgb:usdt-asset', spendable: '42' })

    const { result } = renderHook(() => useRGBListLogic(), { wrapper })

    await waitFor(() => expect(result.current.items).toEqual([
      expect.objectContaining({
        assetId: 'rgb:usdt-asset',
        name: 'USDT',
        ticker: 'USDT',
        tokenInfo: { name: 'USDT', ticker: 'USDT' },
        spendable: '42',
        configuredUsdt: true,
      }),
    ]))
    expect(result.current.total).toBe(1)
  })

  it('shows the active USDT separately from a held deprecated issuance', async () => {
    const { store, wrapper, wallet } = createRgbHookTestHarness()
    store.dispatch(settingsActions.updateSettings({
      walletConfig: {
        ...store.getState().settings.walletConfig,
        rgbUsdtAssetId: 'rgb:new-usdt',
        rgbAssetPolicies: [
          {
            assetId: 'rgb:new-usdt', displayName: 'USDT', ticker: 'USDT',
            official: true, status: 'active', showWhenZero: true, sortOrder: 100,
          },
          {
            assetId: 'rgb:old-usdt', displayName: 'USDT (Legacy)', ticker: 'USDT',
            official: true, status: 'deprecated', sortOrder: 10,
          },
        ],
      },
    }))
    wallet.getRGBList.mockResolvedValue({
      list: [{
        assetId: 'rgb:old-usdt', ticker: 'USDT', name: 'USDT',
        balance: '50', spendable: '50',
      }],
      total: 1,
    })
    wallet.getRGBAssetBalance.mockRejectedValue(new Error('not held'))

    const { result } = renderHook(() => useRGBListLogic(), { wrapper })

    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(result.current.items).toEqual([
      expect.objectContaining({
        assetId: 'rgb:new-usdt', name: 'USDT', configuredPlaceholder: true,
        rgbAssetPolicyStatus: 'active',
      }),
      expect.objectContaining({
        assetId: 'rgb:old-usdt', name: 'USDT (Legacy)', balance: '50',
        rgbAssetPolicyStatus: 'deprecated',
      }),
    ])
    expect(result.current.total).toBe(2)
    expect(wallet.getRGBAssetBalance).toHaveBeenCalledWith('', 'rgb:new-usdt')
    expect(wallet.getRGBAssetBalance).not.toHaveBeenCalledWith('', 'rgb:old-usdt')
  })

  it('does not load the RGB asset list when disabled', async () => {
    const { wrapper, wallet } = createRgbHookTestHarness()

    renderHook(() => useRGBListLogic({ enabled: false }), { wrapper })

    await waitFor(() => {
      expect(wallet.getRGBList).not.toHaveBeenCalled()
    })
  })

  it('loads the RGB asset list without a full sync on the Bitcoin home view', async () => {
    const { wrapper, wallet } = createRgbHookTestHarness()

    renderHook(() => useRGBListLogic(), { wrapper })

    await waitFor(() => {
      expect(wallet.getRGBList).toHaveBeenCalledWith('', expect.any(Number), expect.any(Number), {
        skipSync: true,
      })
    })

    expect(wallet.getAddressBalanceV2).not.toHaveBeenCalled()
  })

  it('syncs RGB allocations and funding balance while the RGB wallet view is visible', async () => {
    const { store, wrapper, wallet } = createRgbHookTestHarness()
    store.dispatch(uiActions.setWalletView(WalletView.RGB))

    const { result } = renderHook(() => useRGBListLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.fundingAddress).toBe('bc1p-rgb-funding')
      expect(result.current.fundingBalance).toBe(210000)
    })

    expect(wallet.getRgbFundingAddress).toHaveBeenCalled()
    expect(wallet.getAddressBalanceV2).toHaveBeenCalledWith('bc1p-rgb-funding')
    expect(wallet.getRGBList).toHaveBeenCalledWith('', expect.any(Number), expect.any(Number), {
      skipSync: false,
    })
  })

  it('polls the RGB asset list while the RGB wallet view is visible', async () => {
    const { store, wrapper } = createRgbHookTestHarness()
    const setIntervalSpy = vi.spyOn(global, 'setInterval')

    renderHook(() => useRGBListLogic({ autoRefresh: true }), { wrapper })

    act(() => {
      store.dispatch(uiActions.setWalletView(WalletView.RGB))
    })

    await act(async () => {
      await waitFor(() => {
        expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000)
      })
    })

    setIntervalSpy.mockRestore()
  })

  it('refreshes the visible RGB asset list after the background reports a change', async () => {
    const { store, wrapper, wallet } = createRgbHookTestHarness()
    store.dispatch(uiActions.setWalletView(WalletView.RGB))

    renderHook(() => useRGBListLogic(), { wrapper })

    await waitFor(() => {
      expect(wallet.getRGBList).toHaveBeenCalledTimes(1)
    })

    act(() => {
      uiEventBus.emit(BUS_METHODS.RGB_ASSETS_CHANGED)
    })

    await waitFor(() => {
      expect(wallet.getRGBList).toHaveBeenCalledTimes(2)
    })
  })
})
