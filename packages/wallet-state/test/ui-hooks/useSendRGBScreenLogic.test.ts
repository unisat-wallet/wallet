import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useSendRGBScreenLogic } from '../../src/ui-hooks/useSendRGBScreenLogic'
import { createHookTestHarness } from './testHelpers'

describe('useSendRGBScreenLogic', () => {
  it('converts valid decimal amounts to atomic units for invoices without a fixed amount', async () => {
    const assetId = 'rgb:test-asset'
    const invoice = 'rgb:test-asset/~/~/bc:utxob:test?endpoints=rpc://proxy'
    const { wrapper, wallet } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: { assetId, ticker: 'RGB', precision: 8, spendable: '150000000' },
      },
    })
    wallet.createRgbSendBegin = vi.fn().mockResolvedValue({ toSignData: {} })
    const { result } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    act(() => {
      result.current.onInvoiceChange(invoice)
    })

    expect(result.current.requiresAmount).toBe(true)

    for (const amount of ['1e3', '1.123456789', '0']) {
      act(() => {
        result.current.onAmountChange(amount)
      })

      expect(result.current.isAmountValid).toBe(false)
      expect(result.current.disabled).toBe(true)
    }

    act(() => {
      result.current.onAmountChange('1.5')
    })

    expect(result.current.isAmountValid).toBe(true)
    expect(result.current.disabled).toBe(false)

    act(() => {
      result.current.onClickMaxAmount()
    })

    expect(result.current.amount).toBe('1.5')

    await act(async () => {
      await result.current.onClickNext()
    })

    expect(wallet.createRgbSendBegin).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '150000000' })
    )
  })

  it('disables Next when an RGB invoice amount exceeds the spendable balance', async () => {
    const assetId = 'rgb:test-asset'
    const fixedAmountInvoice = JSON.stringify({
      invoice: 'rgb:test-asset/~/~/bc:utxob:test?amount=150000001',
      endpoints: 'rpc://proxy',
    })
    const { wrapper } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: { assetId, ticker: 'RGB', precision: 8, spendable: '150000000' },
      },
    })
    const { result } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      result.current.onInvoiceChange(fixedAmountInvoice)
    })

    await waitFor(() => {
      expect(result.current.insufficientBalance).toBe(true)
      expect(result.current.disabled).toBe(true)
    })
  })

  it('rejects a valid RGB invoice without a transport endpoint before creating a send', async () => {
    const assetId = 'rgb:test-asset'
    const { wrapper, wallet } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: { assetId, ticker: 'RGB', precision: 8, spendable: '150000000' },
      },
    })
    wallet.createRgbSendBegin = vi.fn()
    const { result } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    act(() => {
      result.current.onInvoiceChange('rgb:test-asset/~/~/bc:utxob:test?amount=1')
    })

    expect(result.current.invoiceInvalid).toBe(true)
    expect(result.current.disabled).toBe(true)
    await act(async () => {
      await result.current.onClickNext()
    })
    expect(wallet.createRgbSendBegin).not.toHaveBeenCalled()
  })

  it('submits a JSON envelope with its transport endpoints', async () => {
    const assetId = 'rgb:test-asset'
    const innerInvoice = 'rgb:test-asset/~/~/bc:utxob:test?amount=1'
    const { wrapper, wallet } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: { assetId, ticker: 'RGB', precision: 8, spendable: '150000000' },
      },
    })
    wallet.createRgbSendBegin = vi.fn().mockResolvedValue({ toSignData: {} })
    const { result } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    act(() => {
      result.current.onInvoiceChange(
        JSON.stringify({ invoice: innerInvoice, endpoints: 'rpc://proxy' })
      )
    })

    expect(result.current.disabled).toBe(false)
    await act(async () => {
      await result.current.onClickNext()
    })
    expect(wallet.createRgbSendBegin).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice: `${innerInvoice}&endpoints=${encodeURIComponent('rpc://proxy')}`,
      })
    )
  })

  it('blocks a new send while the same asset is awaiting recipient acknowledgement', async () => {
    const assetId = 'rgb:test-asset'
    const invoice = 'rgb:test-asset/~/~/bc:utxob:test?endpoints=rpc://proxy'
    const { wrapper, wallet } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: { assetId, ticker: 'RGB', precision: 8, spendable: '1000000000' },
      },
    })
    wallet.getRgbTransfers.mockResolvedValue({
      list: [
        {
          id: 'local-send:pending-transfer',
          assetId,
          type: 'send',
          status: 'waiting_ack',
          local: true,
        },
      ],
      total: 1,
    })
    wallet.createRgbSendBegin = vi.fn()

    const { result } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    act(() => {
      result.current.onInvoiceChange(invoice)
      result.current.onAmountChange('1')
    })

    await waitFor(() => {
      expect(result.current.blockingSendMessage).not.toBe('')
      expect(result.current.disabled).toBe(true)
      expect(result.current.spendable).toBe('0')
    })

    await act(async () => {
      await result.current.onClickNext()
    })

    expect(wallet.createRgbSendBegin).not.toHaveBeenCalled()
    expect(result.current.error).toBe(result.current.blockingSendMessage)
  })

  it('localizes an invoice-unavailable error returned after signing', async () => {
    const assetId = 'rgb:test-asset'
    const invoice = 'rgb:test-asset/~/~/bc:utxob:test?endpoints=rpc://proxy'
    const { wrapper, wallet, navigation } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: { assetId, ticker: 'RGB', precision: 8, spendable: '1000000000' },
      },
    })
    wallet.createRgbSendBegin = vi.fn().mockResolvedValue({
      txid: 'transfer-1',
      toSignData: {},
    })
    wallet.createRgbSendEnd = vi.fn().mockRejectedValue(new Error('RGB_INVOICE_UNAVAILABLE'))
    const { result } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    act(() => {
      result.current.onInvoiceChange(invoice)
      result.current.onAmountChange('1')
    })
    await act(async () => {
      await result.current.onClickNext()
      await result.current.onSignPsbtHandleConfirm([{ psbtHex: 'signed-psbt' }] as any)
    })

    expect(navigation.navigate).toHaveBeenCalledWith('TxFailScreen', {
      error: 'rgb_invoice_unavailable',
    })
  })
})
