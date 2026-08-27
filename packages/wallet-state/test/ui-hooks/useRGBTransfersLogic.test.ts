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
    wallet.getRgbTransfers.mockResolvedValue({ list: [confirmingReceive], total: 1 })

    const { result } = renderHook(() => useRGBTransfersLogic(), { wrapper })

    await waitFor(() => expect(result.current.items[0]?.status).toBe('confirming'))
    wallet.getRgbTransfers.mockResolvedValue({
      list: [{ ...confirmingReceive, status: 'confirmed' }],
      total: 1,
    })
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
