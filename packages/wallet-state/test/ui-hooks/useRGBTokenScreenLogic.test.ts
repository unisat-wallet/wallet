import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useRGBTokenScreenLogic } from '../../src/ui-hooks/useRGBTokenScreenLogic'
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
    expect(wallet.getRgbTransfers).toHaveBeenCalledWith(1, 50, { skipSync: true })
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
})
