import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useRGBReceiveScreenLogic } from '../../src/ui-hooks/useRGBReceiveScreenLogic'
import { createHookTestHarness } from './testHelpers'

describe('useRGBReceiveScreenLogic', () => {
  it('allows decimal fixed amounts up to RGB asset precision and submits atomic amount', async () => {
    const assetId = 'rgb:test-asset'
    const tokenBalance = {
      assetId,
      ticker: 'RGB',
      precision: 8,
    }
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { assetId, tokenBalance },
    })

    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await act(async () => {
      result.current.setMode('fixed')
      result.current.onAmountChange('1.234567891')
    })

    expect(result.current.amount).toBe('1.23456789')
    expect(result.current.normalizedAmount).toBe('123456789')
    expect(result.current.isAmountValid).toBe(true)

    await act(async () => {
      await result.current.onCreateInvoice()
    })

    await waitFor(() => {
      expect(wallet.createRgbBlindReceive).toHaveBeenCalledWith({
        assetId,
        amount: '123456789',
      })
    })
  })

  it('does not allow decimals when RGB asset precision is zero', async () => {
    const assetId = 'rgb:integer-asset'
    const tokenBalance = {
      assetId,
      ticker: 'INT',
      precision: 0,
    }
    const { wrapper } = createHookTestHarness({
      routeState: { assetId, tokenBalance },
    })

    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await act(async () => {
      result.current.setMode('fixed')
      result.current.onAmountChange('12.34')
    })

    expect(result.current.amount).toBe('12')
    expect(result.current.normalizedAmount).toBe('12')
    expect(result.current.isAmountValid).toBe(true)
  })

  it('shows backend RGB invoice error message when the error is an object', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    wallet.createRgbBlindReceive.mockRejectedValue({
      code: 2,
      msg: 'amount must be an unsigned integer or unsigned integer string',
    })

    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await act(async () => {
      await result.current.onCreateInvoice()
    })

    expect(result.current.error).toBe('amount must be an unsigned integer or unsigned integer string')
  })

  it('does not abort unrelated pending RGB UTXO vanilla transactions before creating a new one', async () => {
    const assetId = 'rgb:test-asset'
    const tokenBalance = {
      assetId,
      ticker: 'RGB',
      precision: 8,
    }
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { assetId, tokenBalance },
    })

    wallet.getRgbAllocationSummary.mockResolvedValue({ available: false })
    wallet.getRgbPendingVanillaTxs.mockResolvedValue({
      list: [{ txid: 'unrelated-pending-tx', type: 'createutxos' }],
    })
    wallet.createRgbUtxosBegin.mockResolvedValue({
      txid: 'current-flow-tx',
      toSignData: {
        psbtHex: '00',
        toSignInputs: [],
      },
    })

    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await act(async () => {
      await result.current.onCreateInvoice()
    })

    expect(wallet.createRgbUtxosBegin).toHaveBeenCalled()
    expect(wallet.getRgbPendingVanillaTxs).not.toHaveBeenCalled()
    expect(wallet.abortRgbVanillaTx).not.toHaveBeenCalledWith({ txid: 'unrelated-pending-tx' })
  })
})
