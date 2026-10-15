import { describe, expect, it, vi } from 'vitest'

import { RgbIssueOperations } from '../src/rgb/RgbIssueOperations'

const wallet = {
  walletId: 'rgb-wallet-1',
  fundingAddress: 'bc1p-rgb-funding',
  network: 'mainnet' as const,
}

function fundingUtxo(txid: string, vout: number) {
  return {
    outpoint: { txid, vout },
    satoshis: 330,
    scriptPubKey: `5120${'11'.repeat(32)}`,
    publicKey: `02${'22'.repeat(32)}`,
    chainStatus: 'confirmed' as const,
    allocations: [],
  }
}

describe('RgbIssueOperations', () => {
  it('returns the existing asset when a paid web order is retried', async () => {
    const service = {
      sync: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({ syncedAt: 1, utxos: [] }),
      getIssueHistory: vi.fn().mockReturnValue([{
        orderId: 'f7f0e1f0-0000-4000-8000-000000000001',
        assetId: 'rgb:existing',
        chainStatus: 'confirmed',
      }]),
      getPendingIssues: vi.fn().mockReturnValue([]),
      getAvailableIssueUtxos: vi.fn(),
      queueIssue: vi.fn(),
    }
    const operation = new RgbIssueOperations({
      getContext: vi.fn().mockResolvedValue({ service, wallet }),
      syncIndexerOutbox: vi.fn(),
      now: () => 1_700_000_000_000,
    })
    const result = await operation.issueNia({
      orderId: 'f7f0e1f0-0000-4000-8000-000000000001',
      ticker: 'TOK', name: 'Token', precision: 0, amounts: ['1'],
    })
    expect(result.assetId).toBe('rgb:existing')
    expect(service.getAvailableIssueUtxos).not.toHaveBeenCalled()
    expect(service.queueIssue).not.toHaveBeenCalled()
  })

  it('rejects an issuance whose combined supply exceeds u64 before queuing it', async () => {
    const service = {
      sync: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({ syncedAt: 1, utxos: [] }),
      getAvailableIssueUtxos: vi.fn(),
      queueIssue: vi.fn(),
    }
    const operation = new RgbIssueOperations({
      getContext: vi.fn().mockResolvedValue({ service, wallet }),
      syncIndexerOutbox: vi.fn(),
      now: () => 1_700_000_000_000,
    })

    await expect(
      operation.issueNia({
        ticker: 'TOK',
        name: 'Token',
        precision: 0,
        amounts: ['18446744073709551615', '1'],
      })
    ).rejects.toThrow('RGB issuance total supply exceeds the maximum u64 value')
    expect(service.getAvailableIssueUtxos).not.toHaveBeenCalled()
    expect(service.queueIssue).not.toHaveBeenCalled()
  })

  it('uses only issue funding UTXOs that the service has excluded from active invoice reservations', async () => {
    const invoiceReserved = fundingUtxo('a'.repeat(64), 0)
    const issueFunding = fundingUtxo('b'.repeat(64), 1)
    const service = {
      sync: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({
        syncedAt: 1,
        utxos: [invoiceReserved, issueFunding],
      }),
      getAvailableIssueUtxos: vi.fn().mockReturnValue([issueFunding]),
      queueIssue: vi.fn(),
    }
    const operation = new RgbIssueOperations({
      getContext: vi.fn().mockResolvedValue({ service, wallet }),
      syncIndexerOutbox: vi.fn().mockResolvedValue(true),
      now: () => 1_700_000_000_000,
    })

    await operation.issueNia({
      ticker: 'TOK',
      name: 'Token',
      precision: 0,
      amounts: ['1'],
    })

    expect(service.getAvailableIssueUtxos).toHaveBeenCalledOnce()
    expect(service.queueIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        utxoSync: expect.objectContaining({
          outpoints: expect.arrayContaining([
            expect.objectContaining({
              outpoint: issueFunding.outpoint,
              allocations: [expect.objectContaining({ amount: '1' })],
            }),
            expect.objectContaining({ outpoint: invoiceReserved.outpoint, allocations: [] }),
          ]),
        }),
      })
    )
  })
})
