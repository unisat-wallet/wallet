import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  ANY_RGB_ASSET,
  isCancelableRgbPendingInvoice,
  isDeletableRgbWitnessInvoice,
  isRgbPendingInvoiceAwaitingAcceptance,
  useRGBReceiveScreenLogic,
} from '../../src/ui-hooks/useRGBReceiveScreenLogic'
import { createHookTestHarness } from './testHelpers'

describe('useRGBReceiveScreenLogic', () => {
  it('does not offer release for an accepted receipt awaiting settlement', () => {
    expect(
      isCancelableRgbPendingInvoice({
        invoice: 'rgb:invoice',
        kind: 'ReceiveBlind',
        status: 'WaitingCounterparty',
        batchTransferIdx: 0,
        canCancel: false,
      })
    ).toBe(false)
  })

  it('does not offer release for an invoice awaiting receipt acceptance', () => {
    const invoice = {
      invoice: 'rgb:invoice',
      kind: 'ReceiveBlind',
      status: 'PendingAccept',
      batchTransferIdx: 0,
      canCancel: false,
    }

    expect(isRgbPendingInvoiceAwaitingAcceptance(invoice)).toBe(true)
    expect(isCancelableRgbPendingInvoice(invoice)).toBe(false)
  })

  it('only allows deleting an unused witness invoice', () => {
    expect(
      isDeletableRgbWitnessInvoice({
        invoice: 'rgb:witness',
        kind: 'ReceiveWitness',
        status: 'WaitingCounterparty',
        batchTransferIdx: 0,
        canCancel: true,
      })
    ).toBe(true)
    expect(
      isDeletableRgbWitnessInvoice({
        invoice: 'rgb:witness',
        kind: 'ReceiveWitness',
        status: 'PendingAccept',
        batchTransferIdx: 0,
        canCancel: false,
      })
    ).toBe(false)
  })

  it('only shows a fixed amount error after the user enters an invalid amount', async () => {
    const assetId = 'rgb:test-asset'
    const { wrapper } = createHookTestHarness({
      routeState: { assetId, tokenBalance: { assetId, ticker: 'RGB', precision: 8 } },
    })
    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await act(async () => {
      result.current.setMode('fixed')
    })

    expect(result.current.isAmountValid).toBe(false)
    expect(result.current.amountInvalidVisible).toBe(false)

    await act(async () => {
      result.current.onAmountChange('0')
    })

    expect(result.current.amountInvalidVisible).toBe(true)
  })

  it('allows Any Asset invoices only with an unspecified amount', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    expect(result.current.canSetFixedAmount).toBe(false)

    await act(async () => {
      result.current.setMode('fixed')
      result.current.onAmountChange('1000')
    })

    expect(result.current.mode).toBe('any')
    expect(result.current.amount).toBe('')
    expect(result.current.normalizedAmount).toBe('')

    await act(async () => {
      await result.current.onCreateInvoice()
    })

    expect(wallet.createRgbBlindReceive).toHaveBeenCalledWith({
      durationSeconds: 86_400,
      skipSync: true,
    })
  })

  it('uses the selected invoice type and remembers the selected expiry', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    expect(result.current.recipientType).toBe('blind')
    await act(async () => {
      result.current.setRecipientType('witness')
    })
    await act(async () => {
      await result.current.onCreateInvoice()
    })
    expect(wallet.createRgbWitnessReceive).toHaveBeenCalledWith({ durationSeconds: 86_400, skipSync: true })
    expect(wallet.setRgbInvoiceExpirySeconds).not.toHaveBeenCalled()

    await act(async () => {
      result.current.setInvoiceExpirySeconds(7 * 24 * 60 * 60)
    })
    expect(wallet.setRgbInvoiceExpirySeconds).toHaveBeenCalledWith(7 * 24 * 60 * 60)
    await act(async () => {
      await result.current.onCreateInvoice()
    })
  })

  it('clears a fixed amount when switching back to Any Asset', async () => {
    const assetId = 'rgb:test-asset'
    const { wrapper } = createHookTestHarness()
    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await act(async () => {
      result.current.onSelectAsset({ assetId, ticker: 'RGB', precision: 2 })
    })
    await act(async () => {
      result.current.setMode('fixed')
      result.current.onAmountChange('10.25')
    })
    expect(result.current.normalizedAmount).toBe('1025')

    await act(async () => {
      result.current.onSelectAsset(ANY_RGB_ASSET)
    })

    expect(result.current.canSetFixedAmount).toBe(false)
    expect(result.current.mode).toBe('any')
    expect(result.current.amount).toBe('')
  })

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
        durationSeconds: 86_400,
        skipSync: true,
      })
    })
  })

  it('encodes an integer fixed amount using the asset precision', async () => {
    const assetId = 'rgb:test-asset'
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { assetId, tokenBalance: { assetId, ticker: 'RGB', precision: 8 } },
    })
    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await act(async () => {
      result.current.setMode('fixed')
    })
    await act(async () => {
      result.current.onAmountChange('50')
    })
    await act(async () => {
      await result.current.onCreateInvoice()
    })

    expect(wallet.createRgbBlindReceive).toHaveBeenCalledWith({
      assetId,
      amount: '5000000000',
      durationSeconds: 86_400,
      skipSync: true,
    })
  })

  it('uses the expiry selected for the current invoice', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await waitFor(() => expect(result.current.invoiceExpirySeconds).toBe(86_400))
    act(() => result.current.setInvoiceExpirySeconds(0))

    await act(async () => {
      await result.current.onCreateInvoice()
    })

    expect(wallet.createRgbBlindReceive).toHaveBeenCalledWith({ skipSync: true })
  })

  it('does not poll pending consignments immediately after creating an invoice', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(wallet.getRgbPendingReceiveInvoices).toHaveBeenCalledTimes(2)
    })
    expect(wallet.getRgbPendingReceiveInvoices).toHaveBeenNthCalledWith(1, { skipSync: true })
    expect(wallet.getRgbPendingReceiveInvoices).toHaveBeenNthCalledWith(2)

    await act(async () => {
      await result.current.onCreateInvoice()
    })

    expect(wallet.getRgbPendingReceiveInvoices).toHaveBeenCalledTimes(2)
  })

  it('keeps a newly created invoice in the creation flow for the completion step', async () => {
    const waitingInvoice = {
      invoice: 'rgb:invoice',
      recipientId: 'recipient-id',
      status: 'WaitingConfirmations',
    }
    const { wrapper, wallet, navigation } = createHookTestHarness()
    wallet.createRgbBlindReceive.mockResolvedValue(waitingInvoice)

    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await act(async () => {
      await result.current.onCreateInvoice()
    })

    expect(result.current.invoice).toBe('rgb:invoice')
    expect(result.current.selectedPendingInvoice).toEqual(waitingInvoice)
    expect(navigation.navigate).not.toHaveBeenCalledWith(
      'RGBInvoiceDetailScreen',
      expect.anything()
    )
  })

  it('opens a reusable pending invoice in the dedicated detail screen', () => {
    const pendingInvoice = {
      invoice: 'rgb:pending-invoice',
      recipientId: 'pending-recipient-id',
      status: 'WaitingConfirmations',
      kind: 'ReceiveBlind',
    }
    const { wrapper, navigation } = createHookTestHarness()
    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    act(() => {
      result.current.onSelectPendingInvoice(pendingInvoice)
    })

    expect(navigation.navigate).toHaveBeenCalledWith('RGBInvoiceDetailScreen', {
      recipientId: 'pending-recipient-id',
      invoice: 'rgb:pending-invoice',
      initialInvoice: pendingInvoice,
    })
  })

  it('opens pending invoices as a separate screen', () => {
    const assetId = 'rgb:test-asset'
    const tokenBalance = { ticker: 'RGB', precision: 8 }
    const { wrapper, navigation } = createHookTestHarness({
      routeState: { assetId, tokenBalance },
    })
    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    act(() => {
      result.current.onOpenPendingInvoices()
    })

    expect(navigation.navigate).toHaveBeenCalledWith('RGBInvoiceListScreen', {
      assetId,
      tokenBalance,
    })
  })

  it('polls pending invoices awaiting confirmation even when none is selected', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const waitingInvoice = {
      invoice: 'rgb:invoice',
      recipientId: 'recipient-id',
      status: 'WaitingConfirmations',
    }
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbPendingReceiveInvoices.mockResolvedValue({ list: [waitingInvoice] })

    renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await waitFor(() => {
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10_000)
    })

    setIntervalSpy.mockRestore()
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

    expect(result.current.error).toBe(
      'amount must be an unsigned integer or unsigned integer string'
    )
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

  it('creates an unavailable invoice after broadcasting a RGB UTXO', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    wallet.createRgbBlindReceive.mockResolvedValue({
      invoice: 'rgb:invoice',
      status: 'WaitingConfirmations',
    })
    wallet.getRgbAllocationSummary.mockResolvedValue({ available: false })
    wallet.createRgbUtxosBegin.mockResolvedValue({
      toSignData: {
        psbtHex: '00',
        toSignInputs: [],
      },
    })

    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await act(async () => {
      await result.current.onCreateInvoice()
    })

    await act(async () => {
      await result.current.onSignRgbUtxoHandleConfirm([{ psbtHex: 'signed-psbt' }] as any)
    })

    expect(wallet.createRgbUtxosEnd).toHaveBeenCalledWith({ signedPsbt: 'signed-psbt' })
    expect(wallet.createRgbBlindReceive).toHaveBeenCalled()
    expect(result.current.invoice).toBe('rgb:invoice')
    expect(result.current.selectedPendingInvoice).toMatchObject({
      status: 'WaitingConfirmations',
    })
  })

  it('reuses an unreserved mempool RGB UTXO for the next invoice', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbAllocationSummary.mockResolvedValue({
      available: false,
      availableAllocationCount: 0,
      pendingConfirmation: true,
      pendingAllocationCount: 4,
    })
    wallet.createRgbBlindReceive.mockResolvedValue({ invoice: 'rgb:invoice' })

    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await act(async () => {
      await result.current.onCreateInvoice()
    })

    expect(wallet.createRgbBlindReceive).toHaveBeenCalled()
    expect(wallet.createRgbUtxosBegin).not.toHaveBeenCalled()
  })

  it('shows the RGB invoice funding hint when creating a UTXO fails for insufficient BTC', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbAllocationSummary.mockResolvedValue({ available: false })
    wallet.createRgbUtxosBegin.mockRejectedValue(new Error('Insufficient balance.'))

    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    expect(result.current.insufficientBtcForInvoice).toBe(false)

    await act(async () => {
      await result.current.onCreateInvoice()
    })

    expect(result.current.insufficientBtcForInvoice).toBe(true)
    expect(result.current.error).toBe('')
  })

  it('creates a new funding UTXO when existing unconfirmed funding is reserved by another invoice', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbAllocationSummary.mockResolvedValue({ available: false })
    wallet.createRgbUtxosBegin.mockResolvedValue({
      toSignData: {
        psbtHex: '00',
        toSignInputs: [],
      },
    })

    const { result } = renderHook(() => useRGBReceiveScreenLogic(), { wrapper })

    await act(async () => {
      await result.current.onCreateInvoice()
    })

    expect(wallet.createRgbUtxosBegin).toHaveBeenCalledWith(
      expect.objectContaining({ num: 5, upTo: true })
    )
    expect(result.current.error).toBe('')
  })
})
