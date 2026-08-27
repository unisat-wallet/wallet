import { describe, expect, it, vi } from 'vitest'

import { RgbService } from '../src/services/rgb'

describe('RgbService', () => {
  it('sends consumed funding outpoints in the authenticated broadcast sync', async () => {
    const httpClient = {
      post: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
    }
    const service = new RgbService(httpClient as any)
    service.setRequestAuthenticator(
      vi.fn().mockResolvedValue({
        fundingAddress: 'bc1p-funding',
        nonce: 'a'.repeat(32),
        expiresAt: 1,
        signature: 'signature',
      })
    )

    await service.syncRgbTransfer({
      wallet: { fundingAddress: 'bc1p-funding' },
      transferId: 'transfer-1',
      txid: 'b'.repeat(64),
      amount: '60',
      createdAt: 1_786_688_361_585,
      to: 'bc1p-recipient',
      spentOutpoints: [{ txid: 'c'.repeat(64), vout: 1 }],
      consignments: [],
    })

    expect(httpClient.post).toHaveBeenCalledWith('/v5/rgb/transfers/sync', {
      wallet: { fundingAddress: 'bc1p-funding' },
      transferId: 'transfer-1',
      txid: 'b'.repeat(64),
      amount: '60',
      createdAt: 1_786_688_361_585,
      to: 'bc1p-recipient',
      spentOutpoints: [{ txid: 'c'.repeat(64), vout: 1 }],
      consignments: [],
      auth: expect.objectContaining({ fundingAddress: 'bc1p-funding' }),
    })
  })

  it('sends a confirmed receive activity through the authenticated API', async () => {
    const httpClient = {
      post: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
    }
    const service = new RgbService(httpClient as any)
    service.setRequestAuthenticator(
      vi.fn().mockResolvedValue({
        fundingAddress: 'bc1p-funding',
        nonce: 'a'.repeat(32),
        expiresAt: 1,
        signature: 'signature',
      })
    )

    await service.syncRgbReceiveTransfer({
      wallet: { fundingAddress: 'bc1p-funding' },
      transferId: 'receive:invoice-1',
      assetId: `rgb:${'ab'.repeat(32)}`,
      amount: '2',
      txid: 'b'.repeat(64),
      createdAt: 1_786_688_361_585,
      from: 'bc1p-sender',
    })

    expect(httpClient.post).toHaveBeenCalledWith('/v5/rgb/transfers/receive', {
      wallet: { fundingAddress: 'bc1p-funding' },
      transferId: 'receive:invoice-1',
      assetId: `rgb:${'ab'.repeat(32)}`,
      amount: '2',
      txid: 'b'.repeat(64),
      createdAt: 1_786_688_361_585,
      from: 'bc1p-sender',
      auth: expect.objectContaining({ fundingAddress: 'bc1p-funding' }),
    })
  })
})
