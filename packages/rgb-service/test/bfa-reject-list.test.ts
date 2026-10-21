import { describe, expect, it } from 'vitest'
import { verifyBfaRejectList } from '../src/protocol/bfa-reject-list'

const parent = '11'.repeat(32)
const child = '22'.repeat(32)
const word = (value: number | string) => typeof value === 'number'
  ? value.toString(16).padStart(64, '0') : value.padStart(64, '0')

function fixture(entries: Array<{ opId: string; reject: boolean }>, finalizedCount = entries.length) {
  const calls: Array<{ method: string; params: unknown[] }> = []
  const rpc = async (method: string, params: unknown[]): Promise<unknown> => {
    calls.push({ method, params })
    if (method === 'eth_chainId') return '0x1'
    if (method === 'eth_getBlockByNumber') return { number: '0x9' }
    if (method === 'eth_blockNumber') return '0xa'
    if (method === 'eth_call') {
      const data = (params[0] as { data: string }).data
      if (data === '0x1f7b6d32') return `0x${word(params[1] === '0x9' ? finalizedCount : entries.length)}`
      if (data.startsWith('0x17b937e6')) return `0x${word(32)}${word(entries.length)}${entries.map(entry =>
        `${word(entry.opId)}${word(4000)}${word(0)}${word(entry.reject ? 1 : 0)}`
      ).join('')}`
    }
    throw new Error(`unexpected RPC ${method}`)
  }
  return {
    chainId: 1n, address: `0x${'33'.repeat(20)}`, rpc, calls,
    operations: [
      { id: parent, inputs: [], assignments: [{ type: 4000, index: 0, secret: 'parent' }] },
      { id: child, inputs: [{ opId: parent, type: 4000, index: 0 }],
        assignments: [{ type: 4000, index: 0, secret: 'recipient' }] },
    ],
    terminalSecrets: new Map([[child, new Set(['recipient'])]]),
  }
}

describe('BFA EVM reject list', () => {
  it('accepts an empty list and queries the committed EVM contract', async () => {
    const input = fixture([])
    await expect(verifyBfaRejectList(input)).resolves.toBeUndefined()
    expect(input.calls.filter(call => call.method === 'eth_call')).toEqual([
      { method: 'eth_call', params: [{ to: input.address, data: '0x1f7b6d32' }, '0x9'] },
      { method: 'eth_call', params: [{ to: input.address, data: '0x1f7b6d32' }, '0xa'] },
    ])
  })

  it('rejects a recipient when an ancestor is on the finalized list', async () => {
    await expect(verifyBfaRejectList(fixture([{ opId: parent, reject: true }]))).rejects.toThrow('ancestor is rejected')
  })

  it('lets a finalized allow decision shield a rejected ancestor', async () => {
    await expect(verifyBfaRejectList(fixture([
      { opId: parent, reject: true }, { opId: child, reject: false },
    ]))).resolves.toBeUndefined()
  })

  it('does not trust a pending allow and applies a pending reject', async () => {
    await expect(verifyBfaRejectList(fixture([
      { opId: parent, reject: true }, { opId: child, reject: false },
    ], 1))).rejects.toThrow('ancestor is rejected')
    await expect(verifyBfaRejectList(fixture([
      { opId: parent, reject: false }, { opId: child, reject: true },
    ], 1))).rejects.toThrow('ancestor is rejected')
  })
})
