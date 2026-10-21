import { describe, expect, it, vi } from 'vitest'
import type { RgbPendingUtxoSync, RgbService } from '@unisat/rgb-service'
import { RgbIndexerOutbox } from '../src/rgb/RgbIndexerOutbox'

describe('RgbIndexerOutbox', () => {
  it('publishes a settled allocation after an earlier empty witness registration', async () => {
    const empty = { txid: 'a'.repeat(64), outpoints: [{ allocations: [] }] } as RgbPendingUtxoSync
    const settled = { txid: empty.txid, outpoints: [{ allocations: [{ amount: '100' }] }] } as RgbPendingUtxoSync
    let pending: RgbPendingUtxoSync | undefined = empty
    let releaseFirst: (() => void) | undefined
    let notifyFirst: (() => void) | undefined
    const firstStarted = new Promise<void>(resolve => { notifyFirst = resolve })
    const published: RgbPendingUtxoSync[] = []
    const replaceUtxos = vi.fn(async (sync: RgbPendingUtxoSync) => {
      published.push(sync)
      if (sync === empty) {
        notifyFirst!()
        await new Promise<void>(resolve => { releaseFirst = resolve })
      }
    })
    const service = {
      getPendingUtxoSync: () => pending,
      markUtxoSyncCompleted: vi.fn(async (_txid: string, completed: RgbPendingUtxoSync) => {
        if (pending === completed) pending = undefined
      }),
    } as unknown as RgbService
    const outbox = new RgbIndexerOutbox({
      syncIssue: vi.fn(),
      syncAssetMetadata: vi.fn(),
      replaceUtxos,
      syncReceiveHistory: vi.fn(),
      warn: vi.fn(),
    })
    const wallet = { walletId: 'wallet', fundingAddress: 'address', network: 'mainnet' } as any
    const first = outbox.sync(service, wallet)
    await firstStarted
    expect(replaceUtxos).toHaveBeenCalledTimes(1)
    pending = settled
    const second = outbox.sync(service, wallet)
    expect(published).toEqual([empty])
    releaseFirst!()
    await Promise.all([first, second])
    expect(published).toEqual([empty, settled])
    expect(pending).toBeUndefined()
  })
})
