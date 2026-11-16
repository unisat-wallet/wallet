import { describe, expect, it, vi } from 'vitest'

import { RgbSendOperations } from '../src/rgb/RgbSendOperations'

describe('RgbSendOperations backend-controlled seller swap', () => {
  it('delegates ACK synchronization without accepting or returning transaction bytes', async () => {
    const result = {
      transferId: 'transfer-1',
      txid: 'ab'.repeat(32),
      status: 'receiver_acked' as const,
    }
    const service = {
      syncPublishedSwapAcknowledgement: vi.fn().mockResolvedValue(result),
    }
    const ensureWriteLease = vi.fn()
    const operations = new RgbSendOperations({
      getContext: vi.fn().mockResolvedValue({ service, wallet: { fundingAddress: 'wallet' } }),
      ensureWriteLease,
    } as any)

    await expect(operations.syncSellSwapAcknowledgement('transfer-1')).resolves.toEqual(result)
    expect(ensureWriteLease).toHaveBeenCalledWith(
      expect.objectContaining({ service }),
      { forceRenew: true }
    )
    expect(service.syncPublishedSwapAcknowledgement).toHaveBeenCalledWith('transfer-1')
  })
})
