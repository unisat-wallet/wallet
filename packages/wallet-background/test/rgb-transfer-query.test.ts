import { describe, expect, it, vi } from 'vitest'
import { toRgbDisplayAmount } from '@unisat/wallet-shared'

import { RgbTransferQuery } from '../src/rgb/RgbTransferQuery'

describe('RgbTransferQuery', () => {
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
})
