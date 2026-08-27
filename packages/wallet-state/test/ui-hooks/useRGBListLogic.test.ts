import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useRGBListLogic } from '../../src/ui-hooks/useRGBListLogic'
import { uiActions } from '../../src/reducers/ui'
import { WalletView } from '../../src/types/ui'
import { createHookTestHarness } from './testHelpers'

describe('useRGBListLogic', () => {
  it('does not load the RGB asset list when disabled', async () => {
    const { wrapper, wallet } = createHookTestHarness()

    renderHook(() => useRGBListLogic({ enabled: false }), { wrapper })

    await waitFor(() => {
      expect(wallet.getRGBList).not.toHaveBeenCalled()
    })
  })

  it('loads the RGB asset list without a full sync on the Bitcoin home view', async () => {
    const { wrapper, wallet } = createHookTestHarness()

    renderHook(() => useRGBListLogic(), { wrapper })

    await waitFor(() => {
      expect(wallet.getRGBList).toHaveBeenCalledWith('', expect.any(Number), expect.any(Number), {
        skipSync: true,
      })
    })

    expect(wallet.getAddressBalanceV2).not.toHaveBeenCalled()
  })

  it('syncs RGB allocations and funding balance while the RGB wallet view is visible', async () => {
    const { store, wrapper, wallet } = createHookTestHarness()
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
    const { store, wrapper } = createHookTestHarness()
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
})
