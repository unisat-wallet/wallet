import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useRGBTransfersLogic } from '../../src/ui-hooks/useRGBTransfersLogic'
import { accountActions } from '../../src/reducers/accounts'
import { settingsActions } from '../../src/reducers/settings'
import { createHookTestHarness } from './testHelpers'

const confirmingReceive = {
  id: 'local-receive:recipient-id',
  transferId: 'recipient-id',
  assetId: 'rgb:asset-id',
  type: 'receive' as const,
  amount: '10',
  txid: 'a'.repeat(64),
  timestamp: Date.now(),
  status: 'confirming',
  local: true,
}

describe('useRGBTransfersLogic', () => {
  it('normalizes configured USDT metadata in RGB history', async () => {
    const { wrapper, wallet, store } = createHookTestHarness()
    store.dispatch(settingsActions.updateSettings({
      walletConfig: {
        ...store.getState().settings.walletConfig,
        rgbUsdtAssetId: confirmingReceive.assetId,
      },
    }))
    wallet.getRgbTransfers.mockResolvedValue({
      list: [{ ...confirmingReceive, name: 'Tether USD', ticker: 'USDT0' }],
      total: 1,
    })
    wallet.getRGBAssetDetail.mockResolvedValue({
      assetId: confirmingReceive.assetId,
      name: 'Tether USD',
      ticker: 'USDT0',
      precision: 6,
    })

    const { result } = renderHook(
      () => useRGBTransfersLogic({ initialFullSync: true, pollingEnabled: false }),
      { wrapper }
    )

    await waitFor(() => {
      expect(result.current.items[0]).toMatchObject({ name: 'USDT', ticker: 'USDT' })
    })
  })

  it('polls an outstanding invoice even before it has a transfer row', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbPendingReceiveInvoices.mockResolvedValue({ list: [{ invoice: 'rgb:witness-invoice' }] })
    wallet.getRgbTransfers
      .mockResolvedValueOnce({ list: [], total: 0 })
      .mockResolvedValue({
        list: [{ ...confirmingReceive, status: 'pending_accept' }],
        total: 1,
      })
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    try {
      const { result, unmount } = renderHook(
        () => useRGBTransfersLogic({ initialFullSync: true }),
        { wrapper }
      )
      await waitFor(() => expect(result.current.isCurrentAccountLoaded).toBe(true))
      await waitFor(() => expect(result.current.loading).toBe(false))
      await waitFor(() => expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10_000))

      const poll = timeoutSpy.mock.calls.find(([, interval]) => interval === 10_000)?.[0]
      expect(poll).toBeTypeOf('function')
      act(() => (poll as () => void)())
      await waitFor(() => expect(result.current.items[0]?.status).toBe('pending_accept'))
      unmount()
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it('reloads RGB activity when the same account changes its Bitcoin address type', async () => {
    const { wrapper, wallet, store } = createHookTestHarness()
    const { result } = renderHook(
      () => useRGBTransfersLogic({ initialFullSync: true, pollingEnabled: false }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.isCurrentAccountLoaded).toBe(true))
    await waitFor(() => expect(wallet.getRgbTransfers).toHaveBeenCalledTimes(1))

    const account = store.getState().accounts.current!
    act(() => {
      store.dispatch(accountActions.setCurrent({ ...account, address: '3nested-segwit-address' }))
    })

    await waitFor(() => expect(wallet.getRgbTransfers).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.isCurrentAccountLoaded).toBe(true))
  })

  it('loads the full activity once when the history screen requests an initial sync', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbTransfers.mockResolvedValue({
      list: [{ ...confirmingReceive, assetId: 'rgb:history-no-poll' }],
      total: 1,
    })
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    try {
      const { result } = renderHook(
        () => useRGBTransfersLogic({ initialFullSync: true, pollingEnabled: false }),
        { wrapper }
      )

      await waitFor(() => expect(result.current.isCurrentAccountLoaded).toBe(true))
      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(wallet.getRgbTransfers).toHaveBeenCalledTimes(1)
      expect(wallet.getRgbTransfers).toHaveBeenCalledWith(1, 20, { skipSync: false })
      expect(timeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 10_000)
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it('skips remote address activity for a hidden global queue with no local pending work', async () => {
    const { wrapper, wallet } = createHookTestHarness()

    const { result } = renderHook(
      () => useRGBTransfersLogic({ foreground: false }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.isCurrentAccountLoaded).toBe(true))
    expect(wallet.getRgbActivityPollingState).toHaveBeenCalledTimes(1)
    expect(wallet.getRgbTransfers).not.toHaveBeenCalled()
  })

  it('loads remote activity for a hidden global queue when local work is pending', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbActivityPollingState.mockResolvedValue({ hasPendingActivity: true })
    wallet.getRgbTransfers.mockResolvedValue({ list: [confirmingReceive], total: 1 })

    const { result } = renderHook(
      () => useRGBTransfersLogic({
        foreground: false,
        initialFullSync: true,
        pollingEnabled: false,
      }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(wallet.getRgbTransfers).toHaveBeenCalledTimes(1)
    expect(wallet.getRgbTransfers).toHaveBeenCalledWith(1, 20, {
      skipSync: false,
      statusOnly: true,
    })
  })

  it('attaches the asset precision needed to display atomic transfer amounts', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbTransfers.mockResolvedValue({ list: [confirmingReceive], total: 1 })
    wallet.getRGBAssetDetail.mockResolvedValue({
      assetId: confirmingReceive.assetId,
      precision: 2,
    })

    const { result } = renderHook(() => useRGBTransfersLogic(), { wrapper })

    await waitFor(() => expect(result.current.items[0]?.precision).toBe(2))
  })

  it('merges transfer metadata and the canonical asset ID from asset details', async () => {
    const hexAssetId = 'rgb:072cd658eb21c9683a226d0507ca2e9a995fe5bbfba2625380196c67f0a6719f'
    const canonicalAssetId = 'rgb:ByzWWOsh-yWg6Im0-FB8oump-lf5bv7o-mJTgBls-Z~CmcZ8'
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbTransfers.mockResolvedValue({
      list: [{ ...confirmingReceive, assetId: hexAssetId }],
      total: 1,
    })
    wallet.getRGBAssetDetail.mockResolvedValue({
      assetId: canonicalAssetId,
      name: 'Received Token',
      ticker: 'TOK',
      precision: 2,
    })

    const { result } = renderHook(() => useRGBTransfersLogic(), { wrapper })

    await waitFor(() => {
      expect(result.current.items[0]).toMatchObject({
        assetId: canonicalAssetId,
        name: 'Received Token',
        ticker: 'TOK',
        precision: 2,
      })
    })
  })

  it('retries asset metadata after a temporary detail lookup failure', async () => {
    const assetId = 'rgb:detail-retry-after-failure'
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbTransfers.mockResolvedValue({
      list: [{ ...confirmingReceive, assetId, type: 'send', status: 'broadcasted' }],
      total: 1,
    })
    wallet.getRGBAssetDetail
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValue({ assetId, name: 'Example Token', ticker: 'EXM', precision: 2 })

    const { result } = renderHook(
      () => useRGBTransfersLogic({ initialFullSync: true, pollingEnabled: false }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.isCurrentAccountLoaded).toBe(true))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items[0]?.name).toBeUndefined()
    await act(async () => {
      await result.current.onRefresh()
    })
    await waitFor(() => expect(result.current.items[0]?.ticker).toBe('EXM'))
    expect(wallet.getRGBAssetDetail).toHaveBeenCalledTimes(2)
  })

  it('retries named asset details until precision becomes available', async () => {
    const assetId = 'rgb:detail-retry-missing-precision'
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbTransfers.mockResolvedValue({
      list: [{ ...confirmingReceive, assetId }],
      total: 1,
    })
    wallet.getRGBAssetDetail
      .mockResolvedValueOnce({ assetId, name: 'Example Token', ticker: 'EXM' })
      .mockResolvedValue({ assetId, name: 'Example Token', ticker: 'EXM', precision: 2 })

    const { result } = renderHook(
      () => useRGBTransfersLogic({ initialFullSync: true, pollingEnabled: false }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.items[0]?.precision).toBe(0))
    await act(async () => {
      await result.current.onRefresh()
    })
    await waitFor(() => expect(result.current.items[0]?.precision).toBe(2))
    expect(wallet.getRGBAssetDetail).toHaveBeenCalledTimes(2)
  })

  it('caches an asset with zero precision', async () => {
    const assetId = 'rgb:detail-zero-precision'
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbTransfers.mockResolvedValue({
      list: [{ ...confirmingReceive, assetId }],
      total: 1,
    })
    wallet.getRGBAssetDetail.mockResolvedValue({ assetId, name: 'Indivisible Token', precision: 0 })

    const { result } = renderHook(
      () => useRGBTransfersLogic({ initialFullSync: true, pollingEnabled: false }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.items[0]?.name).toBe('Indivisible Token'))
    await act(async () => {
      await result.current.onRefresh()
    })
    expect(wallet.getRGBAssetDetail).toHaveBeenCalledTimes(1)
  })

  it('stops loading after the total includes local transfers on the first page', async () => {
    const localTransfer = { ...confirmingReceive, type: 'send' as const }
    const remoteTransfers = Array.from({ length: 100 }, (_, index) => ({
      ...confirmingReceive,
      id: `remote-${index}`,
      transferId: `remote-${index}`,
      local: false,
    }))
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbTransfers.mockImplementation((page: number) => {
      const list =
        page === 1
          ? [localTransfer, ...remoteTransfers.slice(0, 20)]
          : remoteTransfers.slice((page - 1) * 20, page * 20)
      return Promise.resolve({ list, total: 101 })
    })

    const { result } = renderHook(() => useRGBTransfersLogic(), { wrapper })

    await waitFor(() => expect(result.current.items).toHaveLength(21))
    for (let page = 2; page <= 5; page += 1) {
      await act(async () => {
        result.current.onLoadMore()
      })
      await waitFor(() =>
        expect(
          wallet.getRgbTransfers.mock.calls.filter((call: unknown[]) => call[0] === page).length
        ).toBeGreaterThan(0)
      )
    }

    expect(result.current.items).toHaveLength(101)
    expect(result.current.hasMore).toBe(false)
  })
})
