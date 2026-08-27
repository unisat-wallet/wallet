import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useRGBTransfersLogic } from '../../src/ui-hooks/useRGBTransfersLogic'
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

  it('does not notify for a broadcast that completed before the list was opened', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbTransfers.mockResolvedValue({
      list: [{ ...confirmingReceive, type: 'send', status: 'broadcasted' }],
      total: 1,
    })

    const { result } = renderHook(() => useRGBTransfersLogic(), { wrapper })

    await waitFor(() => expect(result.current.items[0]?.status).toBe('broadcasted'))
    expect(result.current.notification).toBeUndefined()
  })

  it('queues a receive-confirmed notification after settlement', async () => {
    const { wrapper, wallet } = createHookTestHarness()
    wallet.getRgbTransfers
      .mockResolvedValueOnce({ list: [confirmingReceive], total: 1 })
      .mockResolvedValueOnce({ list: [{ ...confirmingReceive, status: 'confirmed' }], total: 1 })

    const { result } = renderHook(() => useRGBTransfersLogic(), { wrapper })

    await waitFor(() => expect(result.current.items[0]?.status).toBe('confirming'))
    await act(async () => {
      await result.current.onRefresh()
    })

    await waitFor(() => {
      expect(result.current.notification).toEqual(
        expect.objectContaining({ kind: 'receive_confirmed' })
      )
    })
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
      await waitFor(() => expect(wallet.getRgbTransfers).toHaveBeenCalledTimes(page))
    }

    expect(result.current.items).toHaveLength(101)
    expect(result.current.hasMore).toBe(false)
  })
})
