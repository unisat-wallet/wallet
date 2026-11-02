import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useRGBTransferDetailLogic } from '../../src/ui-hooks/useRGBTransferDetailLogic'
import { settingsActions } from '../../src/reducers/settings'
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

    expect(wallet.acceptRgbReceive).toHaveBeenCalledWith({ recipientId: 'recipient-id' })
    expect(result.current.transfer?.status).toBe('waiting_receive')
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
    wallet.rejectRgbReceive.mockResolvedValue({ rejected: true })

    const { result } = renderHook(() => useRGBTransferDetailLogic(), { wrapper })

    await waitFor(() => expect(result.current.canAcceptReceive).toBe(true))
    await act(async () => {
      await result.current.onRejectReceive()
    })

    expect(wallet.rejectRgbReceive).toHaveBeenCalledWith({ recipientId: 'recipient-id' })
    expect(result.current.transfer?.status).toBe('rejected')
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
