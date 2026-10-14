import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  getSendErrorMessage,
  SendRGBScreenStep,
  useSendRGBScreenLogic,
} from '../../src/ui-hooks/useSendRGBScreenLogic'
import { createHookTestHarness } from './testHelpers'

describe('useSendRGBScreenLogic', () => {
  it('discards the unsigned RGB send when signing is rejected', async () => {
    const assetId = 'rgb:test-asset'
    const invoice = 'rgb:test-asset/~/~/bc:utxob:test?amount=1&endpoints=rpc://proxy'
    const { wrapper, wallet } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: { assetId, ticker: 'RGB', precision: 8, spendable: '150000000' },
      },
    })
    wallet.createRgbSendBegin = vi.fn().mockResolvedValue({
      txid: 'prepared-transfer',
      toSignData: { psbtHex: 'unsigned-psbt' },
    })
    wallet.abortRgbVanillaTx = vi.fn().mockResolvedValue({ aborted: true, status: 'discarded' })
    const { result } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    act(() => result.current.onInvoiceChange(invoice))
    await act(async () => result.current.onClickNext())
    expect(result.current.step).toBe(SendRGBScreenStep.SIGN_TX)

    await act(async () => result.current.onSignPsbtHandleCancel())

    expect(wallet.abortRgbVanillaTx).toHaveBeenCalledWith({
      txid: 'prepared-transfer',
      discardUnsigned: true,
    })
    expect(result.current.step).toBe(SendRGBScreenStep.CREATE_TX)
  })

  it('checks a pasted RGB invoice silently while keeping Next disabled', async () => {
    vi.useFakeTimers()
    const assetId = 'rgb:test-asset'
    const invoice = 'rgb:test-asset/~/~/bc:utxob:test?amount=1&endpoints=rpc://proxy'
    const { wrapper, wallet } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: { assetId, ticker: 'RGB', precision: 8, spendable: '150000000' },
      },
    })
    wallet.checkRgbInvoiceAvailability = vi.fn(() => new Promise<void>(() => undefined))
    const { result, unmount } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    act(() => result.current.onInvoiceChange(invoice))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(result.current.invoiceAvailability).toBe('checking')
    expect(result.current.invoiceValidationMessage).toBe('')
    expect(result.current.invoiceReadyForAmount).toBe(true)
    expect(result.current.disabled).toBe(true)

    unmount()
    vi.useRealTimers()
  })

  it('blocks signing when the pasted RGB invoice recipient ID is unavailable', async () => {
    const assetId = 'rgb:test-asset'
    const invoice = 'rgb:test-asset/~/~/bc:utxob:test?amount=1&endpoints=rpc://proxy'
    const { wrapper, wallet } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: { assetId, ticker: 'RGB', precision: 8, spendable: '150000000' },
      },
    })
    wallet.checkRgbInvoiceAvailability = vi.fn().mockRejectedValue({ code: 'RGB_INVOICE_UNAVAILABLE' })
    wallet.createRgbSendBegin = vi.fn()
    const { result } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    act(() => result.current.onInvoiceChange(invoice))
    await act(async () => result.current.onClickNext())

    expect(wallet.createRgbSendBegin).not.toHaveBeenCalled()
    expect(result.current.invoiceValidationMessage).toBe('rgb_invoice_unavailable')
  })

  it('shows the required, available, and missing BTC for an RGB fee-pool top-up', () => {
    const t = vi.fn((key: string, substitutions?: Record<string, string>) =>
      `${key}:${substitutions?.required}:${substitutions?.available}:${substitutions?.missing}`
    )

    expect(
      getSendErrorMessage(
        {
          code: 'RGB_FEE_POOL_INSUFFICIENT_BTC',
          data: {
            requiredSatoshis: 30_500,
            availableSatoshis: 10_000,
            missingSatoshis: 20_500,
            topUpSatoshis: 30_000,
            estimatedFeeSatoshis: 500,
            feePoolUtxoCount: 3,
          },
        },
        'fallback',
        'invoice unavailable',
        t
      )
    ).toBe('rgb_fee_pool_insufficient_btc:30500:10000:20500')
  })

  it('opens the fee-pool explanation when funding BTC is insufficient', async () => {
    const assetId = 'rgb:test-asset'
    const invoice = 'rgb:test-asset/~/~/bc:utxob:test?endpoints=rpc://proxy'
    const { wrapper, wallet } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: { assetId, ticker: 'RGB', precision: 8, spendable: '150000000' },
      },
    })
    wallet.getRgbFeePoolStatus = vi.fn().mockResolvedValue({ ready: false })
    wallet.createRgbFeePoolTopUpBegin = vi.fn().mockRejectedValue({
      code: 'RGB_FEE_POOL_INSUFFICIENT_BTC',
      data: {
        requiredSatoshis: 30_500,
        availableSatoshis: 10_000,
        missingSatoshis: 20_500,
        topUpSatoshis: 30_000,
        estimatedFeeSatoshis: 500,
        feePoolUtxoCount: 3,
      },
    })
    const { result } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    act(() => {
      result.current.onInvoiceChange(invoice)
      result.current.onAmountChange('1')
    })
    await act(async () => {
      await result.current.onClickNext()
    })

    expect(result.current.error).toBe('')
    expect(result.current.feePoolRequirement).toMatchObject({
      topUpSatoshis: 30_000,
      estimatedFeeSatoshis: 500,
      availableSatoshis: 10_000,
      missingSatoshis: 20_500,
      feePoolUtxoCount: 3,
    })
  })

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

  it.each([
    ['blind, any asset', '~', 'bc:utxob:test'],
    ['blind, fixed asset', 'test-asset', 'bc:utxob:test'],
    ['witness, any asset', '~', 'bc:txout:test'],
    ['witness, fixed asset', 'test-asset', 'bc:txout:test'],
  ])('uses 18-digit asset precision for %s any-amount invoices', async (_case, invoiceAsset, recipientId) => {
    const assetId = 'rgb:test-asset'
    const invoice = `rgb:${invoiceAsset}/~/~/${recipientId}?endpoints=rpc://proxy`
    const { wrapper, wallet } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: {
          assetId,
          ticker: 'RGB',
          precision: 18,
          spendable: '1000000000000000000',
        },
      },
    })
    wallet.createRgbSendBegin = vi.fn().mockResolvedValue({ toSignData: {} })
    const { result, unmount } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    act(() => {
      result.current.onInvoiceChange(invoice)
      result.current.onAmountChange('0.123456789012345678')
    })

    expect(result.current.assetPrecision).toBe(18)
    expect(result.current.requiresAmount).toBe(true)
    expect(result.current.isAmountValid).toBe(true)
    expect(result.current.disabled).toBe(false)

    await act(async () => {
      await result.current.onClickNext()
    })
    expect(wallet.createRgbSendBegin).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '123456789012345678', precision: 18 })
    )

    act(() => result.current.onAmountChange('0.1234567890123456789'))
    expect(result.current.isAmountValid).toBe(false)
    unmount()
  })

  it('reports an amount that exceeds the RGB token precision', async () => {
    const assetId = 'rgb:test-asset'
    const invoice = 'rgb:test-asset/~/~/bc:utxob:test?endpoints=rpc://proxy'
    const { wrapper } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: { assetId, ticker: 'RGB', precision: 1, spendable: '150' },
      },
    })
    const { result, unmount } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    await act(async () => {
      await Promise.resolve()
    })

    act(() => {
      result.current.onInvoiceChange(invoice)
      result.current.onAmountChange('1.01')
    })

    expect(result.current.isAmountValid).toBe(false)
    expect(result.current.amountValidationMessage).toBe('rgb_amount_precision_invalid')

    unmount()
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

  it('funds the RGB fee pool before preparing a send when no fee UTXO is available', async () => {
    const assetId = 'rgb:test-asset'
    const invoice = 'rgb:test-asset/~/~/bc:utxob:test?endpoints=rpc://proxy'
    const { wrapper, wallet } = createHookTestHarness({
      routeState: {
        assetId,
        tokenBalance: { assetId, ticker: 'RGB', precision: 8, spendable: '150000000' },
      },
    })
    wallet.getRgbFeePoolStatus = vi.fn().mockResolvedValue({ ready: false })
    wallet.createRgbFeePoolTopUpBegin = vi.fn().mockResolvedValue({ toSignData: { psbtHex: 'top-up' } })
    wallet.createRgbFeePoolTopUpEnd = vi.fn().mockResolvedValue({ txid: 'fee-pool-tx' })
    wallet.createRgbSendBegin = vi.fn().mockResolvedValue({ toSignData: { psbtHex: 'rgb-send' } })
    const { result } = renderHook(() => useSendRGBScreenLogic(), { wrapper })

    act(() => {
      result.current.onInvoiceChange(invoice)
      result.current.onAmountChange('1')
    })
    await act(async () => {
      await result.current.onClickNext()
    })

    expect(wallet.createRgbFeePoolTopUpBegin).toHaveBeenCalled()
    expect(wallet.createRgbSendBegin).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.onSignPsbtHandleConfirm([{ psbtHex: 'signed-top-up' }] as any)
    })

    expect(wallet.createRgbFeePoolTopUpEnd).toHaveBeenCalledWith({ signedPsbt: 'signed-top-up' })
    await waitFor(() => {
      expect(wallet.createRgbSendBegin).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '100000000' })
      )
      expect(result.current.step).toBe(SendRGBScreenStep.SIGN_TX)
    })

    expect(result.current.signPsbtParams.data.toSignDatas[0]?.psbtHex).toBe('rgb-send')
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
