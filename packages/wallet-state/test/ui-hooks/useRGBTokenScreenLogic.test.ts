import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useRGBTokenScreenLogic } from '../../src/ui-hooks/useRGBTokenScreenLogic'
import { settingsActions } from '../../src/reducers/settings'
import { createHookTestHarness } from './testHelpers'

describe('useRGBTokenScreenLogic', () => {
  const assetId = 'rgb:test-asset'
  const detail = {
    assetId,
    ticker: 'RGB',
    name: 'RGB Token',
  }
  const fetchedBalance = {
    assetId,
    ticker: 'RGB',
    spendable: '12',
    balance: '12',
  }

  it('marks the configured token for the USDT icon even when its metadata uses another ticker', async () => {
    const { store, wrapper, wallet } = createHookTestHarness({ routeState: { assetId } })
    store.dispatch(settingsActions.updateSettings({
      walletConfig: { ...store.getState().settings.walletConfig, rgbUsdtAssetId: assetId },
    }))
    wallet.getRGBAssetDetail.mockResolvedValue({ ...detail, ticker: 'OTHER', iconUrl: 'https://example.com/other.png' })
    wallet.getRGBAssetBalance.mockResolvedValue(fetchedBalance)
    wallet.getRGBAssetActivity.mockResolvedValue({ list: [], total: 0 })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })
    await waitFor(() => expect(result.current.iconInfo.isConfiguredUsdt).toBe(true))
  })

  it('shows the unconfigured USDT item without loading an invalid asset or allowing transfers', async () => {
    const { wrapper, wallet, navigation } = createHookTestHarness({
      routeState: { assetId: '-', tokenBalance: { assetId: '-', ticker: 'USDT', spendable: '0' } },
    })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tokenSummary?.tokenInfo).toMatchObject({ assetId: '-', ticker: 'USDT' })
    expect(result.current.enableReceive).toBe(false)
    expect(result.current.enableTransfer).toBe(false)
    expect(wallet.getRGBAssetDetail).not.toHaveBeenCalled()
    expect(wallet.getRGBAssetBalance).not.toHaveBeenCalled()
    expect(wallet.getRGBAssetActivity).not.toHaveBeenCalled()
    act(() => {
      result.current.onClickReceive()
      result.current.onClickSend()
    })
    expect(navigation.navigate).not.toHaveBeenCalled()
  })

  it('opens the token invoice list with the selected asset and balance', async () => {
    const { wrapper, wallet, navigation } = createHookTestHarness({ routeState: { assetId } })
    wallet.getRGBAssetDetail.mockResolvedValue(detail)
    wallet.getRGBAssetBalance.mockResolvedValue(fetchedBalance)
    wallet.getRGBAssetActivity.mockResolvedValue({ list: [], total: 0 })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })
    await waitFor(() => expect(result.current.tokenBalance).toEqual(fetchedBalance))

    act(() => result.current.onClickViewInvoices())

    expect(navigation.navigate).toHaveBeenCalledWith('RGBInvoiceListScreen', {
      assetId,
      tokenBalance: fetchedBalance,
    })
  })

  it('fetches token balance when route tokenBalance is missing', async () => {
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { assetId },
    })
    wallet.getRGBAssetDetail.mockResolvedValue(detail)
    wallet.getRGBAssetBalance.mockResolvedValue(fetchedBalance)
    wallet.getRGBAssetActivity.mockResolvedValue({ list: [], total: 0 })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.tokenBalance).toEqual(fetchedBalance)
    })

    expect(wallet.getRGBAssetBalance).toHaveBeenCalledWith('', assetId)
    expect(result.current.tokenSummary?.tokenBalance).toEqual(fetchedBalance)
    expect(result.current.enableTransfer).toBe(true)
  })

  it('refreshes a pending token balance automatically while its detail page is open', async () => {
    vi.useFakeTimers()
    const { wrapper, wallet } = createHookTestHarness({ routeState: { assetId } })
    wallet.getRGBAssetDetail.mockResolvedValue(detail)
    wallet.getRGBAssetBalance
      .mockResolvedValueOnce({ ...fetchedBalance, spendable: '0', pending: '998' })
      .mockResolvedValue({ ...fetchedBalance, spendable: '998', pending: '0' })
    wallet.getRGBAssetActivity.mockResolvedValue({ list: [], total: 0 })

    try {
      const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.tokenBalance?.pending).toBe('998')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(result.current.tokenBalance).toMatchObject({ spendable: '998', pending: '0' })
      expect(wallet.getRGBAssetBalance).toHaveBeenCalledTimes(2)
      expect(wallet.getRGBAssetActivity).toHaveBeenCalledTimes(2)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(wallet.getRGBAssetBalance).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refreshes a route tokenBalance and prefers the latest value', async () => {
    const routeBalance = {
      assetId,
      ticker: 'RGB',
      spendable: '5',
      balance: '5',
    }
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { assetId, tokenBalance: routeBalance },
    })
    wallet.getRGBAssetDetail.mockResolvedValue(detail)
    wallet.getRGBAssetBalance.mockResolvedValue(fetchedBalance)
    wallet.getRGBAssetActivity.mockResolvedValue({ list: [], total: 0 })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.tokenSummary?.tokenBalance).toEqual(fetchedBalance)
    })

    expect(wallet.getRGBAssetBalance).toHaveBeenCalledWith('', assetId)
  })

  it('keeps Send disabled until a stale route balance has been refreshed', async () => {
    const routeBalance = {
      assetId,
      ticker: 'RGB',
      spendable: '8500',
      balance: '8500',
    }
    let resolveBalance: ((value: typeof fetchedBalance) => void) | undefined
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { assetId, tokenBalance: routeBalance },
    })
    wallet.getRGBAssetDetail.mockResolvedValue(detail)
    wallet.getRGBAssetBalance.mockReturnValue(
      new Promise(resolve => {
        resolveBalance = resolve
      })
    )
    wallet.getRGBAssetActivity.mockResolvedValue({ list: [], total: 0 })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(wallet.getRGBAssetBalance).toHaveBeenCalledWith('', assetId)
    })
    expect(result.current.enableTransfer).toBe(false)

    await act(async () => {
      resolveBalance?.({ ...routeBalance, spendable: '0', pending: '8500' })
    })

    await waitFor(() => {
      expect(result.current.enableTransfer).toBe(false)
      expect(result.current.tokenBalance).toMatchObject({ spendable: '0', pending: '8500' })
    })
  })

  it('does not re-enable Send when the refreshed balance cannot be read', async () => {
    const routeBalance = {
      assetId,
      ticker: 'RGB',
      spendable: '8500',
      balance: '8500',
    }
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { assetId, tokenBalance: routeBalance },
    })
    wallet.getRGBAssetDetail.mockResolvedValue(detail)
    wallet.getRGBAssetBalance.mockRejectedValue(new Error('temporary balance read failure'))
    wallet.getRGBAssetActivity.mockResolvedValue({ list: [], total: 0 })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.balanceLoading).toBe(false)
    })
    expect(result.current.enableTransfer).toBe(false)
  })

  it('retains asset precision when the refreshed balance only contains amounts', async () => {
    const { wrapper, wallet } = createHookTestHarness({ routeState: { assetId } })
    wallet.getRGBAssetDetail.mockResolvedValue({ ...detail, precision: 8 })
    wallet.getRGBAssetBalance.mockResolvedValue(fetchedBalance)
    wallet.getRGBAssetActivity.mockResolvedValue({ list: [], total: 0 })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.tokenBalance).toEqual({ ...fetchedBalance, precision: 8 })
    })
  })

  it('includes a local pending transfer in token history before it is indexed', async () => {
    const { wrapper, wallet } = createHookTestHarness({ routeState: { assetId } })
    wallet.getRGBAssetDetail.mockResolvedValue(detail)
    wallet.getRGBAssetBalance.mockResolvedValue(fetchedBalance)
    wallet.getRGBAssetActivity.mockResolvedValue({
      total: 1,
      list: [
        {
          id: 'indexed-transfer',
          assetId,
          type: 'send',
          status: 'confirmed',
          amount: '5',
          txid: 'indexed-txid',
          timestamp: 1,
        },
      ],
    })
    wallet.getRgbTransfers.mockResolvedValue({
      total: 2,
      list: [
        {
          id: 'local-send:pending-transfer',
          transferId: 'pending-transfer',
          assetId,
          type: 'send',
          status: 'waiting_ack',
          amount: '7',
          timestamp: 2,
          local: true,
        },
        {
          id: 'local-send:other-asset',
          assetId: 'rgb:other-asset',
          type: 'send',
          status: 'waiting_ack',
          amount: '9',
          timestamp: 3,
          local: true,
        },
      ],
    })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.activityItems).toEqual([
        expect.objectContaining({ id: 'local-send:pending-transfer', status: 'waiting_ack' }),
        expect.objectContaining({ id: 'indexed-transfer', status: 'confirmed' }),
      ])
    })
    expect(result.current.activityTotal).toBe(2)
    expect(wallet.getRgbTransfers).toHaveBeenCalledWith(1, 50, { skipSync: false })
  })

  it('includes a ready-to-broadcast transfer from the full RGB history', async () => {
    const { wrapper, wallet } = createHookTestHarness({ routeState: { assetId } })
    wallet.getRGBAssetDetail.mockResolvedValue(detail)
    wallet.getRGBAssetBalance.mockResolvedValue(fetchedBalance)
    wallet.getRGBAssetActivity.mockResolvedValue({ list: [], total: 0 })
    wallet.getRgbTransfers.mockResolvedValue({
      total: 1,
      list: [{
        id: 'local-send:ready-transfer',
        transferId: 'ready-transfer',
        assetId: 'test-asset',
        type: 'send',
        status: 'ready_to_broadcast',
        amount: '7',
        txid: 'ready-txid',
        timestamp: 2,
        local: true,
      }],
    })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.activityItems).toEqual([
        expect.objectContaining({
          id: 'local-send:ready-transfer',
          transferId: 'ready-transfer',
          status: 'ready_to_broadcast',
          local: true,
        }),
      ])
    })
    expect(result.current.activityTotal).toBe(1)
  })

  it('preserves the local receive identity needed to accept it from token history', async () => {
    const { wrapper, wallet } = createHookTestHarness({ routeState: { assetId } })
    wallet.getRGBAssetDetail.mockResolvedValue(detail)
    wallet.getRGBAssetBalance.mockResolvedValue(fetchedBalance)
    wallet.getRGBAssetActivity.mockResolvedValue({ list: [], total: 0 })
    wallet.getRgbTransfers.mockResolvedValue({
      total: 1,
      list: [{
        id: 'local-receive:recipient-1',
        transferId: 'recipient-1',
        assetId,
        type: 'receive',
        status: 'pending_accept',
        amount: '7',
        timestamp: 2,
        local: true,
      }],
    })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.activityItems).toContainEqual(expect.objectContaining({
        id: 'local-receive:recipient-1',
        transferId: 'recipient-1',
        local: true,
        status: 'pending_accept',
      }))
    })
  })

  it('keeps a canceled send in token history after refreshing', async () => {
    const { wrapper, wallet } = createHookTestHarness({ routeState: { assetId } })
    wallet.getRGBAssetDetail.mockResolvedValue(detail)
    wallet.getRGBAssetBalance.mockResolvedValue(fetchedBalance)
    wallet.getRGBAssetActivity
      .mockResolvedValueOnce({ list: [], total: 0 })
      .mockResolvedValue({
        list: [{ id: 'indexed-transfer-1', assetId, type: 'send', status: 'pending', amount: '7', txid: 'txid-1', timestamp: 1 }],
        total: 1,
      })
    const transfer = {
      id: 'local-send:transfer-1',
      transferId: 'transfer-1',
      assetId,
      type: 'send',
      amount: '7',
      txid: 'txid-1',
      timestamp: 2,
      local: true,
    }
    wallet.getRgbTransfers
      .mockResolvedValueOnce({ list: [{ ...transfer, status: 'waiting_ack' }], total: 1 })
      .mockResolvedValue({ list: [{ ...transfer, status: 'canceled' }], total: 1 })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.activityItems).toContainEqual(
        expect.objectContaining({ id: transfer.id, status: 'waiting_ack' })
      )
    })

    act(() => result.current.onRefreshActivity())

    await waitFor(() => {
      expect(result.current.activityItems).toEqual([
        expect.objectContaining({ id: transfer.id, status: 'canceled', transferId: 'transfer-1' }),
      ])
    })
    expect(result.current.activityTotal).toBe(1)
  })
})
