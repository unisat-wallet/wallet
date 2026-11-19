import { describe, expect, it, vi } from 'vitest'
import { toRgbDisplayAmount } from '@unisat/wallet-shared'

import { RgbTransferQuery } from '../src/rgb/RgbTransferQuery'

describe('RgbTransferQuery', () => {
  it('does not expose a buy-swap receipt as an ordinary acceptance action', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([{
        recipientId: 'recipient',
        proxyRecipientId: 'proxy-recipient',
        createdAt: 1,
        acceptancePolicy: 'buy_swap_backend_commit',
        pendingAccept: {
          txid: 'c'.repeat(64),
          discoveredAt: 2,
          assetId: 'rgb:asset',
          amount: '1',
          precision: 0,
          payload: 'consignment',
        },
      }]),
      getSnapshot: vi.fn().mockReturnValue({ utxos: [] }),
      getLocalAssetDetail: vi.fn().mockReturnValue({}),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })

    expect(result.list).toEqual([
      expect.objectContaining({
        transferId: 'proxy-recipient',
        status: 'waiting_swap_commit',
      }),
    ])
  })

  it('scopes remote and local activity to one token', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([
        { id: 'selected', request: { assetId: 'rgb:selected', amount: '1' },
          prepared: { lockedOutpoints: [] }, createdAt: 2 },
        { id: 'other', request: { assetId: 'rgb:other', amount: '1' },
          prepared: { lockedOutpoints: [] }, createdAt: 3 },
      ]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
      getSnapshot: vi.fn().mockReturnValue({ utxos: [] }),
      getLocalAssetDetail: vi.fn().mockReturnValue({}),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const getRemoteActivity = vi.fn().mockResolvedValue({
      // Defend against an older replica ignoring the scoped endpoint/query.
      total: 2,
      list: [
        { id: 'remote', assetId: 'rgb:selected', type: 'send', status: 'confirmed' },
        { id: 'remote-other', assetId: 'rgb:other', type: 'send', status: 'confirmed' },
      ],
    })
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity, warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, {
      skipSync: true, assetId: 'rgb:selected', type: 'send',
    })

    expect(getRemoteActivity).toHaveBeenCalledWith(
      'funding', 1, 20, { assetId: 'rgb:selected', type: 'send' }
    )
    expect(result.list.map(item => item.id)).toEqual(['local-send:selected', 'remote'])
    expect(result.list[0]).toEqual(expect.objectContaining({ status: 'incomplete' }))
    expect(result.total).toBe(2)
  })

  it('polls exact pending activity statuses without downloading an address page', async () => {
    const txid = 'c'.repeat(64)
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([{
        id: 'transfer-1',
        request: { assetId: 'rgb:asset', amount: '1', precision: 0 },
        prepared: { lockedOutpoints: [] },
        delivery: { completed: { txid } },
        createdAt: 1,
      }]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
      getSnapshot: vi.fn().mockReturnValue({ utxos: [] }),
      getLocalAssetDetail: vi.fn().mockReturnValue({}),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const getRemoteActivity = vi.fn()
    const getRemoteActivityStatuses = vi.fn().mockResolvedValue({
      total: 1,
      list: [{
        id: 'transfer-1', assetId: 'rgb:asset', type: 'send', amount: '1',
        txid, status: 'confirmed', createdAt: 1,
      }],
    })
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity, getRemoteActivityStatuses, warn: vi.fn(),
    })

    await query.getTransfers(1, 20, { skipSync: true, statusOnly: true })

    expect(getRemoteActivity).not.toHaveBeenCalled()
    expect(getRemoteActivityStatuses).toHaveBeenCalledWith(context.wallet, [
      { id: 'transfer-1', txid },
    ])
  })

  it('does not label a non-batch ACK recovery as waiting for other recipients', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([{
        recipientId: 'recipient', proxyRecipientId: 'proxy-recipient', createdAt: 1,
        receivedConsignment: {
          txid: 'c'.repeat(64), receivedAt: 2, acknowledgementPending: true,
          assetId: 'rgb:asset', amount: '1', precision: 0, batch: false,
          payload: 'consignment',
        },
      }]),
      getLocalAssetDetail: vi.fn().mockReturnValue({ name: 'Token', ticker: 'TKN' }),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }), warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })

    expect(result.list).toEqual([
      expect.objectContaining({ transferId: 'proxy-recipient', status: 'confirming' }),
    ])
  })

  it('reconciles and renders one indexed broadcast for a stale prepared send', async () => {
    let pending = [{
      id: 'transfer-1',
      request: { assetId: 'rgb:asset', amount: '1', precision: 0 },
      prepared: { lockedOutpoints: [{ txid: 'b'.repeat(64), vout: 0 }] },
      createdAt: 1,
    }]
    const service = {
      getPendingTransfers: vi.fn().mockImplementation(() => pending),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const indexed = {
      id: 'transfer-1', assetId: 'rgb:asset', type: 'send', amount: '1',
      txid: 'c'.repeat(64), status: 'mempool', createdAt: 2,
    }
    const reconcileIndexedBroadcasts = vi.fn().mockImplementation(async () => {
      pending = []
    })
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(),
      syncPendingTransfers: vi.fn(),
      reconcileIndexedBroadcasts,
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 1, list: [indexed] }),
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20)

    expect(reconcileIndexedBroadcasts).toHaveBeenCalledWith(service, context, [indexed])
    expect(result.list).toEqual([
      expect.objectContaining({ id: 'transfer-1', status: 'mempool', txid: 'c'.repeat(64) }),
    ])
    expect(result.total).toBe(1)
  })

  it('reuses a recent first-page activity read across repeated page mounts', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([{ recipientId: 'invoice-1' }]),
    }
    const context = { service, wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' } }
    const getRemoteActivity = vi.fn().mockResolvedValue({ total: 0, list: [] })
    let receiveChangedOnSync = false
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn().mockImplementation(async () => {
        if (receiveChangedOnSync) {
          service.getPendingReceiveHistory.mockReturnValue([{
            transferId: 'received-1', assetId: 'rgb:asset', amount: '1',
            createdAt: 1, status: 'settled',
          }])
          receiveChangedOnSync = false
        }
      }),
      syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity, warn: vi.fn(),
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    try {
      await query.getTransfers(1, 20, { skipSync: true })
      await query.getTransfers(1, 20)
      expect(getRemoteActivity).toHaveBeenCalledTimes(1)

      receiveChangedOnSync = true
      await query.getTransfers(1, 20)
      expect(getRemoteActivity).toHaveBeenCalledTimes(2)
      await query.getTransfers(1, 20, { skipSync: true })
      expect(getRemoteActivity).toHaveBeenCalledTimes(2)

      now.mockReturnValue(3_001)
      await query.getTransfers(1, 20, { skipSync: true })
      expect(getRemoteActivity).toHaveBeenCalledTimes(3)
    } finally {
      now.mockRestore()
    }
  })

  it('reports the full reserved allocation for a smaller pending send', async () => {
    const txid = 'a'.repeat(64)
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([{
        id: 'send-1', request: { assetId: 'rgb:asset', amount: '1', precision: 0 },
        prepared: { lockedOutpoints: [{ txid, vout: 2 }] },
        delivery: { acknowledgedAt: 2, completed: { txid: 'b'.repeat(64) } },
        createdAt: 1,
      }]),
      getSnapshot: vi.fn().mockReturnValue({ utxos: [{
        outpoint: { txid, vout: 2 }, chainStatus: 'confirmed',
        allocations: [{ assetId: 'rgb:asset', amount: '2', settled: true, spendable: true }],
      }] }),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
      getLocalAssetDetail: vi.fn().mockReturnValue({ name: 'Token', ticker: 'TKN' }),
    }
    const context = { service, wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' } }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })
    expect(result.list).toEqual([expect.objectContaining({
      id: 'local-send:send-1', status: 'ready_to_broadcast', amount: '1', lockedAmount: '2',
    })])
  })

  it('waits for receiver broadcast propagation before offering the sender fallback', async () => {
    const acknowledgedAt = 1_000_000
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([{
        id: 'send-1', request: { assetId: 'rgb:asset', amount: '1', precision: 0 },
        prepared: { lockedOutpoints: [] },
        delivery: { acknowledgedAt, completed: { txid: 'b'.repeat(64) } },
        createdAt: 1,
      }]),
      getSnapshot: vi.fn().mockReturnValue({ utxos: [] }),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
      getLocalAssetDetail: vi.fn().mockReturnValue({ name: 'Token', ticker: 'TKN' }),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'signet' },
    }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      warn: vi.fn(),
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(acknowledgedAt + 1_000)
    try {
      await expect(query.getTransfers(1, 20, { skipSync: true })).resolves.toMatchObject({
        list: [expect.objectContaining({ status: 'broadcasting' })],
      })

      now.mockReturnValue(acknowledgedAt + 15_000)
      await expect(query.getTransfers(1, 20, { skipSync: true })).resolves.toMatchObject({
        list: [expect.objectContaining({ status: 'ready_to_broadcast' })],
      })
    } finally {
      now.mockRestore()
    }
  })

  it('reports reserved allocations from migrated snapshots without chain status', async () => {
    const txid = 'a'.repeat(64)
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([{
        id: 'send-1', request: { assetId: 'rgb:asset', amount: '1', precision: 0 },
        prepared: { lockedOutpoints: [{ txid, vout: 2 }] },
        createdAt: 1,
      }]),
      getSnapshot: vi.fn().mockReturnValue({ utxos: [{
        outpoint: { txid, vout: 2 },
        allocations: [{ assetId: 'rgb:asset', amount: '2', settled: true, spendable: true }],
      }] }),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
      getLocalAssetDetail: vi.fn().mockReturnValue({ name: 'Token', ticker: 'TKN' }),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })

    expect(result.list).toEqual([
      expect.objectContaining({ id: 'local-send:send-1', lockedAmount: '2' }),
    ])
  })

  it('reports a dApp-finalized swap as waiting for the app instead of broadcasting', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([
        {
          id: 'swap-1', request: { assetId: 'rgb:asset', amount: '1', precision: 0 },
          prepared: { lockedOutpoints: [] },
          delivery: {
            externalBroadcast: true,
            acknowledgedAt: 2,
            completed: { txid: 'b'.repeat(64) },
          },
          createdAt: 2,
        },
        {
          id: 'swap-2', request: { assetId: 'rgb:asset', amount: '1', precision: 0 },
          prepared: { lockedOutpoints: [] },
          delivery: {
            externalBroadcast: true,
            externalBroadcastController: 'backend',
            acknowledgedAt: 2,
            completed: { txid: 'c'.repeat(64) },
          },
          createdAt: 1,
        },
      ]),
      getSnapshot: vi.fn().mockReturnValue({ utxos: [] }),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
      getLocalAssetDetail: vi.fn().mockReturnValue({ name: 'Token', ticker: 'TKN' }),
    }
    const context = { service, wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'signet' } }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })
    expect(result.list).toEqual([
      expect.objectContaining({ id: 'local-send:swap-1', status: 'ready_for_dapp_finalize' }),
      expect.objectContaining({ id: 'local-send:swap-2', status: 'ready_for_external_broadcast' }),
    ])
  })

  it('uses the issuance order transaction for an issue activity link', async () => {
    const anchorTxid = 'a'.repeat(64)
    const issuanceTxid = 'b'.repeat(64)
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([{
        assetId: 'rgb:issued', amount: '100', txid: anchorTxid, issuanceTxid,
        createdAt: 1, chainStatus: 'confirmed',
        asset: { ticker: 'ISS', name: 'Issued', precision: 0 },
      }]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 1, list: [{
        id: 'remote-issue', assetId: 'rgb:issued', type: 'issue', txid: anchorTxid,
        amount: '100', timestamp: 1, status: 'confirmed',
      }] }),
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })

    expect(result.list).toEqual([
      expect.objectContaining({ type: 'issue', txid: issuanceTxid }),
    ])
  })

  it('keeps rejection unavailable until backend review explicitly allows it', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([{
        recipientId: 'recipient', createdAt: 1,
        pendingValidationFailure: {
          reason: 'No matching blind assignment was found',
          discoveredAt: 2,
        },
      }]),
    }
    const context = { service, wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' } }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })
    expect(result.list).toEqual([expect.objectContaining({
      id: 'local-receive:recipient', status: 'validation_failed',
      rejectionReason: 'No matching blind assignment was found', canReject: false, rejectLocally: true,
    })])
  })

  it('allows rejection after backend review confirms the receive is invalid', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([{
        recipientId: 'recipient', createdAt: 1,
        pendingValidationFailure: {
          reason: 'No matching blind assignment was found', discoveredAt: 2,
          reviewStatus: 'rejection_allowed',
        },
      }]),
    }
    const context = { service, wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' } }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }), warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })
    expect(result.list[0]).toMatchObject({ status: 'validation_failed', canReject: true })
  })

  it('shows rejected recovery tombstones only through their non-sensitive history row', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([{
        transferId: 'receive:recipient', assetId: '', amount: '', txid: 'c'.repeat(64),
        createdAt: 2, status: 'rejected', rejectionReason: 'Rejected by you',
      }]),
      getPendingReceives: vi.fn().mockReturnValue([{
        recipientId: 'recipient', createdAt: 1, invoice: 'sensitive-invoice',
        proxyPrivateKey: '44'.repeat(32),
        rejection: { kind: 'local_donation_reject', rejectedAt: 2, reason: 'Rejected by you' },
      }]),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }), warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })

    expect(result.list).toEqual([
      expect.objectContaining({ id: 'receive:recipient', status: 'rejected' }),
    ])
    expect(JSON.stringify(result)).not.toContain('sensitive-invoice')
    expect(JSON.stringify(result)).not.toContain('44444444')
  })

  it('keeps a burn proof visible and confirms it from Bitcoin status', async () => {
    const txid = 'b'.repeat(64)
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([{
        transferId: 'burn-1', assetId: 'rgb:bfa', amount: '25', txid,
        createdAt: 10, status: 'broadcasted', burn: true,
      }]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
      getLocalAssetDetail: vi.fn().mockReturnValue({ name: 'BFA', ticker: 'BFA' }),
      getBurnTransactionStatus: vi.fn().mockResolvedValue('confirmed'),
      markSendHistoryConfirmed: vi.fn(),
    }
    const context = { service, wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' } }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      warn: vi.fn(),
    })
    const result = await query.getTransfers(1, 20, { skipSync: true })
    expect(result.list).toEqual([expect.objectContaining({
      transferId: 'burn-1', burn: true, txid, status: 'confirmed',
    })])
    expect(service.markSendHistoryConfirmed).not.toHaveBeenCalled()
  })

  it('shows a late receiver rejection while retaining the broadcast transaction', async () => {
    const send = {
      transferId: 'send-1', assetId: 'rgb:asset', amount: '50',
      txid: 'a'.repeat(64), createdAt: 10, status: 'broadcasted',
      donation: true, recipientAckExpected: true, recipientAck: false,
    }
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([send]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
      getLocalAssetDetail: vi.fn().mockReturnValue({ name: 'Token', ticker: 'TKN' }),
      markSendHistoryConfirmed: vi.fn(),
    }
    const context = { service, wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' } }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 1, list: [{
        id: 'remote', type: 'send', txid: send.txid, assetId: send.assetId,
        amount: '50', timestamp: 10, status: 'confirmed',
      }] }),
      warn: vi.fn(),
    })
    const result = await query.getTransfers(1, 20)
    expect(result.list).toEqual([expect.objectContaining({
      transferId: 'send-1', status: 'rejected', broadcasted: true, txid: send.txid,
    })])
    expect(service.markSendHistoryConfirmed).not.toHaveBeenCalled()

    delete (send as { recipientAck?: boolean }).recipientAck
    const awaiting = await query.getTransfers(1, 20, { skipSync: true })
    expect(awaiting.list).toEqual([expect.objectContaining({
      transferId: 'send-1', status: 'confirmed', awaitingRecipientAck: true,
    })])
    expect(service.markSendHistoryConfirmed).not.toHaveBeenCalled()
  })

  it('includes local asset metadata on a broadcasted send', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([{
        transferId: 'send-1',
        assetId: 'rgb:asset',
        amount: '10',
        createdAt: 1,
        status: 'broadcasted',
      }]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
      getLocalAssetDetail: vi.fn().mockReturnValue({ name: 'Example Token', ticker: 'EXM' }),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context),
      syncReceiveHistory: vi.fn(),
      syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })

    expect(result.list[0]).toMatchObject({
      id: 'local-send:send-1',
      status: 'broadcasted',
      name: 'Example Token',
      ticker: 'EXM',
    })
    expect(service.getLocalAssetDetail).toHaveBeenCalledWith('rgb:asset')
  })

  it('reads shared local asset metadata only once per transfer query', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([
        { transferId: 'send-1', assetId: 'rgb:asset', amount: '10', createdAt: 1, status: 'broadcasted' },
        { transferId: 'send-2', assetId: 'rgb:asset', amount: '20', createdAt: 2, status: 'broadcasted' },
      ]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
      getLocalAssetDetail: vi.fn().mockReturnValue({ name: 'Token', ticker: 'TKN' }),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context),
      syncReceiveHistory: vi.fn(),
      syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      warn: vi.fn(),
    })

    await query.getTransfers(1, 20, { skipSync: true })
    expect(service.getLocalAssetDetail).toHaveBeenCalledTimes(1)

    await query.getTransfers(1, 20, { skipSync: true })
    expect(service.getLocalAssetDetail).toHaveBeenCalledTimes(2)
  })

  it('does not create a second page when local history overlaps all remote activity', async () => {
    const localHistory = Array.from({ length: 18 }, (_, index) => ({
      transferId: `receive-${index}`,
      assetId: 'rgb:asset',
      amount: '1',
      txid: String(index).padStart(64, '0'),
      createdAt: index,
      status: 'settled',
    }))
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue(localHistory),
      getPendingReceives: vi.fn().mockReturnValue([]),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const remoteHistory = localHistory.slice(0, 13).map(item => ({
      id: item.transferId,
      assetId: item.assetId,
      type: 'receive',
      amount: item.amount,
      txid: item.txid,
      timestamp: item.createdAt,
      status: 'settled',
    }))
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context),
      syncReceiveHistory: vi.fn(),
      syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 13, list: remoteHistory }),
      warn: vi.fn(),
    })

    const firstPage = await query.getTransfers(1, 20, { skipSync: true })

    expect(firstPage.list).toHaveLength(18)
    expect(firstPage.total).toBe(18)
  })

  it('keeps a rejected invoice separate from a confirmed receive sharing its Bitcoin txid', async () => {
    const txid = 'a'.repeat(64)
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([{
        transferId: 'receive:rejected-invoice', assetId: 'rgb:asset', amount: '10',
        txid, createdAt: 1, status: 'rejected', rejectionReason: 'Rejected by you',
      }]),
      getPendingReceives: vi.fn().mockReturnValue([]),
    }
    const context = { service, wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' } }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(), syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 2, list: [
        { id: 'receive:rejected-invoice', type: 'receive', status: 'confirmed', txid, amount: '10' },
        { id: 'receive:accepted-invoice', type: 'receive', status: 'confirmed', txid, amount: '10' },
      ] }),
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })

    expect(result.list).toHaveLength(2)
    expect(result.list).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'receive:accepted-invoice', status: 'confirmed' }),
      expect.objectContaining({ id: 'receive:rejected-invoice', status: 'rejected', rejectionReason: 'Rejected by you' }),
    ]))
  })

  it('reads remote receive history after publishing a pending local outcome', async () => {
    let published = false
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([{ transferId: 'receive:invoice' }]),
      getPendingReceives: vi.fn().mockReturnValue([]),
    }
    const context = { service, wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' } }
    const getRemoteActivity = vi.fn(async () => ({
      total: 1,
      list: [{ id: 'receive:invoice', type: 'receive', status: published ? 'rejected' : 'confirmed',
        txid: 'a'.repeat(64), rejectionReason: published ? 'Rejected by you' : undefined }],
    }))
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context as never),
      syncReceiveHistory: vi.fn(async () => { published = true; service.getPendingReceiveHistory.mockReturnValue([]) }),
      syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context as never),
      getRemoteActivity,
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20)

    expect(result.list).toEqual([expect.objectContaining({
      id: 'receive:invoice', status: 'rejected', rejectionReason: 'Rejected by you',
    })])
  })

  it('keeps the total stable across pages when a local transfer appears only on page one', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([{
        id: 'local-send',
        request: { assetId: 'rgb:asset', amount: '1', precision: 0 },
        createdAt: 1,
      }]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const remoteItems = Array.from({ length: 21 }, (_, index) => ({
      id: `remote-${index}`,
      type: 'receive',
      amount: '1',
      timestamp: index,
      status: 'settled',
    }))
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context),
      syncReceiveHistory: vi.fn(),
      syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context),
      getRemoteActivity: vi.fn().mockImplementation((_address, page, pageSize) =>
        Promise.resolve({ total: remoteItems.length, list: remoteItems.slice((page - 1) * pageSize, page * pageSize) })
      ),
      warn: vi.fn(),
    })

    const firstPage = await query.getTransfers(1, 20, { skipSync: true })
    const secondPage = await query.getTransfers(2, 20, { skipSync: true })

    expect(firstPage.total).toBe(22)
    expect(secondPage.total).toBe(firstPage.total)
    expect(firstPage.list).toHaveLength(21)
    expect(secondPage.list).toHaveLength(1)
    expect(secondPage.list[0]?.id).toBe('remote-20')
  })

  it('keeps the sender precision for a witness invoice with any asset and amount', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([{
        id: 'local-send',
        request: { assetId: 'rgb:asset', amount: '1001111111', precision: 7 },
        createdAt: 1,
      }]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context),
      syncReceiveHistory: vi.fn(),
      syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })

    expect(result.list[0]).toMatchObject({ amount: '1001111111', precision: 7 })
    expect(toRgbDisplayAmount(result.list[0]?.amount, result.list[0]?.precision ?? 0))
      .toBe('100.1111111')
  })

  it('uses the unique proxy recipient for witness receive actions', async () => {
    const sharedWitnessRecipient = 'bc:wvout:shared-script'
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue([]),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue(
        ['first', 'second'].map((suffix, index) => ({
          recipientId: sharedWitnessRecipient,
          proxyRecipientId: `proxy-${suffix}`,
          recipientType: 'witness',
          createdAt: index + 1,
          pendingAccept: {
            payload: `consignment-${suffix}`,
            txid: String(index + 1).repeat(64),
            assetId: 'rgb:asset',
            amount: String(index + 1),
            precision: 0,
            discoveredAt: index + 1,
          },
        }))
      ),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context),
      syncReceiveHistory: vi.fn(),
      syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })

    expect(result.list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local-receive:proxy-first',
          transferId: 'proxy-first',
        }),
        expect.objectContaining({
          id: 'local-receive:proxy-second',
          transferId: 'proxy-second',
        }),
      ])
    )
  })

  it('includes the receiver acceptance time for each pending send', async () => {
    const service = {
      getPendingTransfers: vi.fn().mockReturnValue(
        ['first', 'second'].map((id, index) => ({
          id,
          request: { assetId: `rgb:${id}`, amount: '1', precision: 0 },
          createdAt: index + 1,
          delivery: {
            acknowledgedAt: index === 0 ? 40 : 30,
            completed: { txid: String(index + 1).repeat(64) },
          },
        }))
      ),
      getPendingSendHistory: vi.fn().mockReturnValue([]),
      getIssueHistory: vi.fn().mockReturnValue([]),
      getPendingReceiveHistory: vi.fn().mockReturnValue([]),
      getPendingReceives: vi.fn().mockReturnValue([]),
    }
    const context = {
      service,
      wallet: { walletId: 'wallet', fundingAddress: 'funding', network: 'mainnet' },
    }
    const query = new RgbTransferQuery({
      getContext: vi.fn().mockResolvedValue(context),
      syncReceiveHistory: vi.fn(),
      syncPendingTransfers: vi.fn(),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context),
      getRemoteActivity: vi.fn().mockResolvedValue({ total: 0, list: [] }),
      warn: vi.fn(),
    })

    const result = await query.getTransfers(1, 20, { skipSync: true })

    expect(result.list).toEqual(expect.arrayContaining([
      expect.objectContaining({ transferId: 'first', acknowledgedAt: 40 }),
      expect.objectContaining({ transferId: 'second', acknowledgedAt: 30 }),
    ]))
  })
})
