import { describe, expect, it } from 'vitest'

import type { AddressHistorySummaryItem } from '../src/types/history'
import { getHistoryAssetChanges } from '../src/utils/historyAssetChanges'

const base: AddressHistorySummaryItem = {
  txid: 'tx',
  timestamp: 0,
  height: 0,
  confirmations: 1,
  status: 'confirmed',
  direction: 'send',
  feeSatoshis: 200,
  received: [],
  sent: [],
  receivedCount: 0,
  sentCount: 0,
  receivedTruncated: false,
  sentTruncated: false,
}

describe('getHistoryAssetChanges', () => {
  it('omits carrier sats while keeping the transferred asset', () => {
    const result = getHistoryAssetChanges({
      ...base,
      sent: [
        { kind: 'coin', symbol: 'BTC', amount: '0.00000546' },
        { kind: 'runes', symbol: 'PEPE', amount: '100' },
      ],
      sentCount: 2,
    })

    expect(result.changes.map(change => change.asset.symbol)).toEqual(['PEPE'])
    expect(result.total).toBe(1)
  })

  it('retains material BTC changes in a multi-asset transaction', () => {
    const result = getHistoryAssetChanges({
      ...base,
      received: [{ kind: 'runes', symbol: 'PEPE', amount: '100' }],
      sent: [{ kind: 'coin', symbol: 'BTC', amount: '0.1' }],
      receivedCount: 1,
      sentCount: 1,
    })

    expect(result.changes.map(change => `${change.sign}${change.asset.symbol}`)).toEqual(['+PEPE', '-BTC'])
  })

  it('keeps the full asset count when the API truncates its preview', () => {
    const result = getHistoryAssetChanges({
      ...base,
      received: [
        { kind: 'coin', symbol: 'BTC', amount: '0.00000546' },
        { kind: 'brc20', symbol: 'ORDI', amount: '5' },
        { kind: 'runes', symbol: 'PEPE', amount: '100' },
      ],
      receivedCount: 18,
      receivedTruncated: true,
    })

    expect(result.changes).toHaveLength(2)
    expect(result.total).toBe(17)
  })

  it('shows a self-transfer output without reporting it as asset loss', () => {
    const result = getHistoryAssetChanges({
      ...base,
      direction: 'self',
      feeSatoshis: 1000,
      sent: [{ kind: 'coin', symbol: 'BTC', amount: '0.00099' }],
      sentCount: 1,
    })

    expect(result).toEqual({
      changes: [{ asset: { kind: 'coin', symbol: 'BTC', amount: '0.00099' }, sign: '' }],
      total: 1,
    })
  })

  it('hides carrier sats while showing a self-transferred asset', () => {
    const result = getHistoryAssetChanges({
      ...base,
      direction: 'self',
      sent: [
        { kind: 'coin', symbol: 'BTC', amount: '0.00000546' },
        { kind: 'runes', symbol: 'PEPE', amount: '100' },
      ],
      sentCount: 2,
    })

    expect(result.changes.map(change => `${change.sign}${change.asset.symbol}`)).toEqual(['PEPE'])
    expect(result.total).toBe(1)
  })
})
