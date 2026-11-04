import { describe, expect, it, vi } from 'vitest'

import { RgbReceiveOperations } from '../src/rgb/RgbReceiveOperations'

describe('RgbReceiveOperations', () => {
  it('reports the shared receive invoice capacity with the pending list', async () => {
    const context = {
      service: {
        hasStoredPendingReceives: vi.fn().mockReturnValue(false),
        getReceiveInvoiceCapacity: vi.fn().mockReturnValue({
          count: 10,
          limit: 10,
          available: false,
        }),
        getPendingReceives: vi.fn().mockReturnValue([]),
        getSnapshot: vi.fn().mockReturnValue({ utxos: [] }),
      },
    }
    const operations = new RgbReceiveOperations({
      getContext: vi.fn().mockResolvedValue(context),
      getReadContext: vi.fn().mockResolvedValue(context),
      syncReceivedAllocations: vi.fn().mockResolvedValue(context),
    } as never)

    await expect(operations.getPendingReceiveInvoices()).resolves.toEqual({
      list: [],
      receiveInvoiceCount: 10,
      receiveInvoiceLimit: 10,
      canCreateReceiveInvoice: false,
    })
  })

  it('cancels a witness invoice by its unique proxy recipient ID', async () => {
    const pendingReceives = [
      {
        recipientId: 'rejected-recipient',
        rejection: { kind: 'proxy_nack' as const, rejectedAt: 1, reason: 'Rejected by you' },
      },
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
