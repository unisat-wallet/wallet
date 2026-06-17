import { renderHook, waitFor } from '@testing-library/react'
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

    expect(wallet.getRGBAssetBalance).toHaveBeenCalledWith(
      'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      assetId
    )
    expect(result.current.tokenSummary?.tokenBalance).toEqual(fetchedBalance)
    expect(result.current.enableTransfer).toBe(true)
  })

  it('uses route tokenBalance without fetching token balance', async () => {
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
    wallet.getRGBAssetBalance.mockResolvedValue(undefined)
    wallet.getRGBAssetActivity.mockResolvedValue({ list: [], total: 0 })

    const { result } = renderHook(() => useRGBTokenScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.tokenSummary?.tokenBalance).toEqual(routeBalance)
    })

    expect(wallet.getRGBAssetBalance).not.toHaveBeenCalled()
  })
})
