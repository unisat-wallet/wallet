import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BUS_METHODS } from '@unisat/wallet-shared'

import { useRGBTransferDetailLogic } from '../../src/ui-hooks/useRGBTransferDetailLogic'
import { settingsActions } from '../../src/reducers/settings'
import { uiEventBus } from '../../src/utils/eventBus'
import { createHookTestHarness } from './testHelpers'

const pendingReceive = {
  id: 'local-receive:recipient-id',
  transferId: 'recipient-id',
  assetId: 'rgb:asset-id',
  type: 'receive' as const,
  amount: '10',
  timestamp: Date.now(),
  status: 'pending_accept',
  local: true,
}

const failedSend = {
  id: 'local-send:transfer-id',
  transferId: 'transfer-id',
  assetId: 'rgb:asset-id',
  type: 'send' as const,
  amount: '10',
  timestamp: Date.now(),
  status: 'broadcast_failed',
  local: true,
}

const waitingSend = {
  ...failedSend,
  status: 'waiting_ack',
}

const externalBroadcastSend = {
  ...failedSend,
  txid: 'b'.repeat(64),
  status: 'ready_for_dapp_finalize',
}

const confirmingReceive = {
  ...pendingReceive,
  txid: 'a'.repeat(64),
  status: 'confirming',
}

describe('useRGBTransferDetailLogic', () => {
  it('normalizes configured USDT metadata in transfer details', async () => {
    const initialTransfer = { ...confirmingReceive, name: 'Tether USD', ticker: 'USDT0' }
    const { wrapper, wallet, store } = createHookTestHarness({
      routeState: { transferId: 'recipient-id', initialTransfer },
    })
    store.dispatch(settingsActions.updateSettings({
      walletConfig: {
        ...store.getState().settings.walletConfig,
        rgbUsdtAssetId: initialTransfer.assetId,
      },
    }))
    wallet.getRgbTransfers.mockResolvedValue({ list: [initialTransfer], total: 1 })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.transfer).toMatchObject({ name: 'USDT', ticker: 'USDT' })
    })
  })

  it('returns to Assets from the transfer detail screen', async () => {
    const { wrapper, navigation } = createHookTestHarness({
      routeState: { transferId: 'recipient-id', initialTransfer: pendingReceive },
    })
    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await waitFor(() => expect(result.current.transfer).toBeDefined())
    act(() => result.current.onClickDone())

    expect(navigation.navigate).toHaveBeenCalledWith('AssetsTabScreen')
  })

  it('accepts a pending receive using its recipient ID', async () => {
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { transferId: 'recipient-id', initialTransfer: pendingReceive },
    })
    wallet.acceptRgbReceive.mockResolvedValue({ accepted: true, status: 'accepted' })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await waitFor(() => expect(result.current.canAcceptReceive).toBe(true))
    await act(async () => {
      await result.current.onAcceptReceive()
    })

    expect(wallet.acceptRgbReceive).toHaveBeenCalledWith({
      recipientId: 'recipient-id',
      progressId: expect.stringMatching(/^rgb-accept-/),
    })
    expect(result.current.transfer?.status).toBe('waiting_receive')
  })

  it('reports real acceptance phases while validation is running', async () => {
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { transferId: 'recipient-id', initialTransfer: pendingReceive },
    })
    let resolveAccept!: (value: { accepted: true; status: 'accepted' }) => void
    wallet.acceptRgbReceive.mockReturnValue(
      new Promise(resolve => {
        resolveAccept = resolve
      })
    )

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })
    await waitFor(() => expect(result.current.canAcceptReceive).toBe(true))

    let operation!: Promise<boolean>
    act(() => {
      operation = result.current.onAcceptReceive()
    })
    const progressId = wallet.acceptRgbReceive.mock.calls[0]![0].progressId

    act(() => {
      uiEventBus.emit(BUS_METHODS.RGB_ACCEPT_PROGRESS, {
        progressId,
        phase: 'validating',
        recipientId: 'recipient-id',
        completed: 0,
        total: 1,
      })
    })

    expect(result.current.acceptProgress).toMatchObject({
      progressId,
      phase: 'validating',
      completed: 0,
      total: 1,
    })

    resolveAccept({ accepted: true, status: 'accepted' })
    await act(async () => {
      await operation
    })
    expect(result.current.acceptProgress).toBeUndefined()
  })

  it('shows a successful batch wait after ACK is accepted but the transaction is not released', async () => {
    const { wrapper, wallet, tools } = createHookTestHarness({
      routeState: { transferId: 'recipient-id', initialTransfer: pendingReceive },
    })
    wallet.acceptRgbReceive.mockResolvedValue({ accepted: false, status: 'pending' })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await act(async () => {
      await expect(result.current.onAcceptReceive()).resolves.toBe(true)
    })

    expect(tools.toastError).not.toHaveBeenCalled()
    expect(tools.toastSuccess).toHaveBeenCalledWith('rgb_status_waiting_batch_release')
    expect(result.current.transfer?.status).toBe('waiting_batch_release')
  })

  it('opens an explicit sender-canceled notice when Accept discovers cancellation', async () => {
    const { wrapper, wallet, tools } = createHookTestHarness({
      routeState: { transferId: 'recipient-id', initialTransfer: pendingReceive },
    })
    wallet.acceptRgbReceive.mockResolvedValue({ accepted: false, status: 'canceled' })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await act(async () => {
      await expect(result.current.onAcceptReceive()).resolves.toBe(false)
    })

    expect(tools.toastError).not.toHaveBeenCalled()
    expect(result.current.transfer?.status).toBe('canceled')
    expect(result.current.senderCanceledVisible).toBe(true)
    act(() => result.current.dismissSenderCanceled())
    expect(result.current.senderCanceledVisible).toBe(false)
  })

  it('does not offer accept for remote activity without a local consignment', async () => {
    const { wrapper } = createHookTestHarness({
      routeState: {
        transferId: 'recipient-id',
        initialTransfer: { ...pendingReceive, local: false },
      },
    })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await waitFor(() => expect(result.current.transfer).toBeDefined())
    expect(result.current.canAcceptReceive).toBe(false)
  })

  it('shows an error message returned through the extension message bridge', async () => {
    const { wrapper, wallet, tools } = createHookTestHarness({
      routeState: { transferId: 'recipient-id', initialTransfer: pendingReceive },
    })
    wallet.acceptRgbReceive.mockRejectedValue({
      message: 'RGB receive is not awaiting acceptance',
    })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await act(async () => {
      await result.current.onAcceptReceive()
    })

    expect(tools.toastError).toHaveBeenCalledWith('RGB receive is not awaiting acceptance')
  })

  it('rejects a pending receive using its recipient ID', async () => {
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { transferId: 'recipient-id', initialTransfer: pendingReceive },
    })
    wallet.rejectRgbReceive.mockResolvedValue({
      rejected: true,
      rejectionReason: 'Rejected by you',
    })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await waitFor(() => expect(result.current.canAcceptReceive).toBe(true))
    await act(async () => {
      await result.current.onRejectReceive()
    })

    expect(wallet.rejectRgbReceive).toHaveBeenCalledWith({ recipientId: 'recipient-id' })
    expect(result.current.transfer?.status).toBe('rejected')
    expect(result.current.transfer?.rejectionReason).toBe('Rejected by you')
  })

  it('retries a failed send broadcast using the persisted transfer ID', async () => {
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { transferId: 'transfer-id', initialTransfer: failedSend },
    })
    wallet.retryRgbBroadcast.mockResolvedValue({ broadcast: true, status: 'confirming' })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await waitFor(() => expect(result.current.canRetryBroadcast).toBe(true))
    await act(async () => {
      await result.current.onRetryBroadcast()
    })

    expect(wallet.retryRgbBroadcast).toHaveBeenCalledWith({ transferId: 'transfer-id' })
    expect(result.current.transfer?.status).toBe('broadcasted')
  })

  it('hides cancel on the immediate send result page', async () => {
    const { wrapper } = createHookTestHarness({
      routeState: {
        transferId: 'transfer-id',
        initialTransfer: waitingSend,
        source: 'send_result',
      },
    })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await waitFor(() => expect(result.current.transfer).toBeDefined())
    expect(result.current.canCancelSend).toBe(false)
  })

  it('shows cancel when a waiting send is reopened from transfer history', async () => {
    const { wrapper } = createHookTestHarness({
      routeState: {
        transferId: 'transfer-id',
        initialTransfer: waitingSend,
        source: 'history',
      },
    })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await waitFor(() => expect(result.current.canCancelSend).toBe(true))
  })

  it('discards an incomplete burn without retaining canceled history', async () => {
    const signedBurn = {
      ...waitingSend,
      burn: true,
      status: 'incomplete',
      transferId: 'signed-burn',
    }
    const { wrapper, wallet } = createHookTestHarness({
      routeState: {
        transferId: 'signed-burn',
        initialTransfer: signedBurn,
        source: 'history',
      },
    })
    wallet.abortRgbVanillaTx.mockResolvedValue({ aborted: true, status: 'discarded' })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await waitFor(() => expect(result.current.canCancelSend).toBe(true))
    await act(async () => {
      await result.current.onCancelSend()
    })

    expect(wallet.abortRgbVanillaTx).toHaveBeenCalledWith({
      txid: 'signed-burn',
      discardUnsigned: true,
    })
  })

  it('offers the acknowledged abort path for an external swap that was not broadcast', async () => {
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { transferId: 'transfer-id', initialTransfer: externalBroadcastSend },
    })
    wallet.abortRgbAcknowledgedSwap.mockResolvedValue({ aborted: true, status: 'canceled' })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await waitFor(() => expect(result.current.canCancelSend).toBe(true))
    await act(async () => {
      await result.current.onCancelSend()
    })

    expect(wallet.abortRgbAcknowledgedSwap).toHaveBeenCalledWith({ txid: 'transfer-id' })
    expect(wallet.abortRgbVanillaTx).not.toHaveBeenCalled()
    expect(result.current.transfer?.status).toBe('canceled')
  })

  it('hydrates the transfer detail with canonical asset metadata', async () => {
    const hexAssetId = 'rgb:072cd658eb21c9683a226d0507ca2e9a995fe5bbfba2625380196c67f0a6719f'
    const canonicalAssetId = 'rgb:ByzWWOsh-yWg6Im0-FB8oump-lf5bv7o-mJTgBls-Z~CmcZ8'
    const initialTransfer = { ...confirmingReceive, assetId: hexAssetId }
    const { wrapper, wallet } = createHookTestHarness({
      routeState: { transferId: 'recipient-id', initialTransfer },
    })
    wallet.getRgbTransfers.mockResolvedValue({ list: [initialTransfer], total: 1 })
    wallet.getRGBAssetDetail.mockResolvedValue({
      assetId: canonicalAssetId,
      name: 'Received Token',
      ticker: 'TOK',
      precision: 2,
    })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.transfer).toMatchObject({
        assetId: canonicalAssetId,
        name: 'Received Token',
        ticker: 'TOK',
        precision: 2,
      })
    })
  })
})
