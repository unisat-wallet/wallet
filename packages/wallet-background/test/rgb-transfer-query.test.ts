import { describe, expect, it, vi } from 'vitest'
import { toRgbDisplayAmount } from '@unisat/wallet-shared'

import { RgbTransferQuery } from '../src/rgb/RgbTransferQuery'

describe('RgbTransferQuery', () => {
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
    const remoteHistory = localHistory.slice(0, 13).map((item, index) => ({
      id: `remote-${index}`,
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
