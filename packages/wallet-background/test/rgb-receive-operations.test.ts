import { describe, expect, it, vi } from 'vitest'

import { RgbReceiveOperations } from '../src/rgb/RgbReceiveOperations'

describe('RgbReceiveOperations', () => {
  it('cancels a witness invoice by its unique proxy recipient ID', async () => {
    const pendingReceives = [
      {
        recipientId: 'shared-witness-recipient',
        proxyRecipientId: 'proxy-witness-first',
        recipientType: 'witness' as const,
      },
      {
        recipientId: 'shared-witness-recipient',
        proxyRecipientId: 'proxy-witness-second',
        recipientType: 'witness' as const,
      },
    ]
    const removePendingReceive = vi.fn().mockResolvedValue({ cancelled: true })
    const context = {
      service: {
        getPendingReceives: vi.fn().mockReturnValue(pendingReceives),
        removePendingReceive,
      },
    }
    const operations = new RgbReceiveOperations({
      getContext: vi.fn().mockResolvedValue(context),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context),
    } as never)

    await expect(operations.cancelReceiveInvoice(1)).resolves.toEqual({ changed: true })
    expect(removePendingReceive).toHaveBeenCalledWith('proxy-witness-second')
  })
})
