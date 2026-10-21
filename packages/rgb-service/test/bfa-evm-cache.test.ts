import { describe, expect, it, vi } from 'vitest'
import { cacheBfaEvmRpc } from '../src/protocol/bfa-validator'

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
