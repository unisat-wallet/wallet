import { describe, expect, it, vi } from 'vitest'
import { RgbBfaValidationUnavailableError, RgbMissingAncestorError } from '../src/errors'
import { bfaMintLockId, cacheBfaBitcoinStatus, cacheBfaEvmRpc, cacheConfirmedBfaWitnesses, pruneConfirmedBfaWitnesses, selectBfaSpendHistory, validateCurrentBfaBurnConservation, validateCurrentBfaMintLockRecord } from '../src/protocol/bfa-validator'

describe('BFA mint lock ID', () => {
  it('commits to the operation ID and internal-order witness txid like rgb-ops', () => {
    expect(bfaMintLockId(
      Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join(''),
      Array.from({ length: 32 }, (_, index) => (63 - index).toString(16).padStart(2, '0')).join('')
    )).toBe('1ce683c92fdfb3ef54e39c7b461e731dad02cd240b366441f34a2c2e849a9876')
    expect(bfaMintLockId(
      '6c2ace88bc04cce7d108f6cf1535a46564ba938db9e870325f11ebf8a8d23e27',
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
    )).toBe('a0f145a18cd58a42232653004cae6fe518a206a1459d0fbaa605def8c392c61b')
  })
})

describe('current BFA mint lock deadline', () => {
  const operationId = 'ab'.repeat(32)

  it('keeps a missing lock retryable while an eligible block is not finalized', () => {
    expect(() => validateCurrentBfaMintLockRecord(operationId, 100n, 98n, 0n))
      .toThrow(RgbBfaValidationUnavailableError)
  })

  it.each([99n, 100n, 101n])(
    'rejects a missing lock permanently at finalized block %s',
    finalizedBlock => {
      expect(() => validateCurrentBfaMintLockRecord(
        operationId, 100n, finalizedBlock, 0n
      )).toThrow(`Finalized BFA FundsIn event is missing for mint ${operationId}`)
    }
  )

  it('accepts a lock before the exclusive deadline and rejects one at the deadline', () => {
    expect(() => validateCurrentBfaMintLockRecord(operationId, 100n, 100n, 100n))
      .not.toThrow()
    expect(() => validateCurrentBfaMintLockRecord(operationId, 100n, 100n, 101n))
      .toThrow(`BFA FundsIn event was recorded after the mint deadline for ${operationId}`)
  })
})

describe('current BFA burn conservation', () => {
  const valid = {
    mintInputs: 0, linkInputs: 0, assetInputs: 1, outputAssignments: 0,
    burnedAmount: 100n, inputAmount: 100n,
  }

  it('accepts a non-zero terminal burn funded only by asset inputs', () => {
    expect(() => validateCurrentBfaBurnConservation(valid)).not.toThrow()
  })

  it.each([
    ['mint-right only', { ...valid, mintInputs: 1, assetInputs: 0, burnedAmount: 0n, inputAmount: 0n }],
    ['link-right only', { ...valid, linkInputs: 1, assetInputs: 0, burnedAmount: 0n, inputAmount: 0n }],
    ['asset and mint-right', { ...valid, mintInputs: 1 }],
    ['asset and link-right', { ...valid, linkInputs: 1 }],
    ['no asset input', { ...valid, assetInputs: 0, inputAmount: 0n }],
    ['missing burned amount', { ...valid, burnedAmount: 0n }],
    ['an output assignment', { ...valid, outputAssignments: 1 }],
    ['a mismatched amount', { ...valid, burnedAmount: 99n }],
  ])('rejects %s', (_name, input) => {
    expect(() => validateCurrentBfaBurnConservation(input))
      .toThrow('invalid burn conservation')
  })
})

describe('BFA EVM validation RPC cache', () => {
  it('shares identical in-flight and completed reads within one operation', async () => {
    const rpc = vi.fn(async () => '0x1')
    const cache = new Map<string, Promise<unknown>>()
    const first = cacheBfaEvmRpc(rpc, cache, 'https://evm.example')
    const second = cacheBfaEvmRpc(rpc, cache, 'https://evm.example')

    await expect(Promise.all([
      first('eth_chainId', []),
      second('eth_chainId', []),
    ])).resolves.toEqual(['0x1', '0x1'])
    await second('eth_chainId', [])
    expect(rpc).toHaveBeenCalledTimes(1)

    await second('eth_getLogs', [{ fromBlock: '0x1' }])
    await second('eth_getLogs', [{ fromBlock: '0x2' }])
    expect(rpc).toHaveBeenCalledTimes(3)
  })

  it('does not reuse results across operations or keep failed requests', async () => {
    const rpc = vi.fn()
      .mockRejectedValueOnce(new Error('temporarily unavailable'))
      .mockResolvedValue('0x1')
    const cache = new Map<string, Promise<unknown>>()
    const current = cacheBfaEvmRpc(rpc, cache, 'https://evm.example')

    await expect(current('eth_chainId', [])).rejects.toThrow('temporarily unavailable')
    await expect(current('eth_chainId', [])).resolves.toBe('0x1')
    await cacheBfaEvmRpc(rpc, new Map(), 'https://evm.example')('eth_chainId', [])
    expect(rpc).toHaveBeenCalledTimes(3)
  })
})

describe('BFA Bitcoin witness status cache', () => {
  it('checks each transaction once across repeated validations in an operation', async () => {
    const isConfirmed = vi.fn(async () => true)
    const cache = new Map<string, Promise<boolean>>()
    const first = cacheBfaBitcoinStatus(isConfirmed, cache)
    const second = cacheBfaBitcoinStatus(isConfirmed, cache)
    const txid = 'ab'.repeat(32)

    await expect(Promise.all([first(txid), second(txid.toUpperCase())])).resolves.toEqual([true, true])
    await second(txid)
    expect(isConfirmed).toHaveBeenCalledTimes(1)
    await cacheBfaBitcoinStatus(isConfirmed, new Map())(txid)
    expect(isConfirmed).toHaveBeenCalledTimes(2)
  })

  it('retries a failed status query', async () => {
    const isConfirmed = vi.fn()
      .mockRejectedValueOnce(new Error('backend unavailable'))
      .mockResolvedValue(false)
    const check = cacheBfaBitcoinStatus(isConfirmed, new Map())
    const txid = 'ab'.repeat(32)

    await expect(check(txid)).rejects.toThrow('backend unavailable')
    await expect(check(txid)).resolves.toBe(false)
    expect(isConfirmed).toHaveBeenCalledTimes(2)
  })
})

describe('persisted v1 witness observations', () => {
  const txid = 'ab'.repeat(32)
  it('keeps old valid entries and removes malformed entries on wallet open', () => {
    const malformed = 'cd'.repeat(32)
    const observations = {
      [txid]: { checkedAt: 100_000_000, confirmations: 3 },
      [malformed]: { checkedAt: 100_000_000, confirmations: 2 },
    }
    pruneConfirmedBfaWitnesses(observations)
    expect(observations).toHaveProperty(txid)
    expect(observations).not.toHaveProperty(malformed)
  })
  it('reuses a three-confirmation witness across restarts without a time limit', async () => {
    let time = 100_000_000
    const observations: Record<string, { checkedAt: number; confirmations: number }> = {}
    const getStatus = vi.fn(async () => ({ status: 'confirmed', confirmations: 3 }))
    const check = cacheConfirmedBfaWitnesses(getStatus, observations, () => time)
    await expect(check(txid)).resolves.toBe(true)
    const restored = JSON.parse(JSON.stringify(observations))
    const afterRestart = cacheConfirmedBfaWitnesses(getStatus, restored, () => time)
    await expect(afterRestart(txid)).resolves.toBe(true)
    expect(getStatus).toHaveBeenCalledTimes(1)
    time += 365 * 24 * 60 * 60 * 1000
    await expect(afterRestart(txid)).resolves.toBe(true)
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  it('rechecks witnesses below three confirmations and never caches a failed check', async () => {
    const observations: Record<string, { checkedAt: number; confirmations: number }> = {}
    const getStatus = vi.fn()
      .mockResolvedValueOnce({ status: 'confirmed', confirmations: 2 })
      .mockResolvedValueOnce({ status: 'replaced', confirmations: 0 })
      .mockResolvedValueOnce({ status: 'confirmed', confirmations: 3 })
    const check = cacheConfirmedBfaWitnesses(getStatus, observations, () => 100_000_000)
    await expect(check(txid)).resolves.toBe(true)
    expect(observations[txid]).toBeUndefined()
    await expect(check(txid)).resolves.toBe(false)
    expect(observations[txid]).toBeUndefined()
    await expect(check(txid)).resolves.toBe(true)
    expect(observations[txid]?.confirmations).toBe(3)
  })

  it('evicts the oldest entry when the local limit is reached', () => {
    const observations: Record<string, { checkedAt: number; confirmations: number }> = {}
    for (let index = 0; index < 4097; index++) {
      observations[index.toString(16).padStart(64, '0')] = { checkedAt: index, confirmations: 3 }
    }
    pruneConfirmedBfaWitnesses(observations)
    expect(Object.keys(observations)).toHaveLength(4096)
    expect(observations['0'.repeat(64)]).toBeUndefined()
  })
})

describe('outgoing v1 history selection', () => {
  it('keeps the selected allocation ancestry and drops an unrelated branch', () => {
    const root = '11'.repeat(32)
    const parent = '22'.repeat(32)
    const unrelated = '33'.repeat(32)
    const selected = '44'.repeat(32)
    const bundle = (id: string, operationId: string, parentId: string, marker: number) => ({
      id, txid: id, strict: Uint8Array.of(marker),
      operationIds: [operationId], parentOpIds: [parentId],
    })
    const history = {
      assetId: `rgb:${root}`,
      genesis: Uint8Array.of(0),
      witnessBundles: [Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3)],
      allocations: [],
      bundles: [
        bundle('aa'.repeat(32), parent, root, 1),
        bundle('bb'.repeat(32), unrelated, root, 2),
        bundle('cc'.repeat(32), selected, parent, 3),
      ],
    }
    const selectedHistory = selectBfaSpendHistory(history, [selected])
    expect(selectedHistory.witnessBundles.map(bytes => bytes[0])).toEqual([1, 3])
    expect(() => selectBfaSpendHistory(history, ['55'.repeat(32)]))
      .toThrow(RgbMissingAncestorError)
  })
})
