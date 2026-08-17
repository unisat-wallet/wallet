import { Transaction } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import { serializeNiaOpretWitnessBundle, serializeRgbTransferPrefix } from '../src'

describe('RGB transfer container primitives', () => {
  it('serializes an Opret WitnessBundle with a locally derived bundle ID', () => {
    const transaction = new Transaction()
    transaction.addInput(Buffer.alloc(32), 0)
    transaction.addOutput(Buffer.from('6a', 'hex'), 0)
    const transitionId = Uint8Array.from(Buffer.from('bb'.repeat(32), 'hex'))
    const result = serializeNiaOpretWitnessBundle({
      witnessTx: transaction.toBuffer(),
      contractId: '11'.repeat(32),
      transitionId,
      transition: Uint8Array.from([1, 2, 3]),
      inputs: [{ opId: 'aa'.repeat(32), assignmentType: 4000, assignmentIndex: 0 }],
      entropy: 1n,
    })

    expect(result.bundleId).toHaveLength(32)
    expect(result.strict[0]).toBe(1)
    expect(Buffer.from(result.strict).subarray(-35, -3)).toEqual(Buffer.from(transitionId))
  })

  it('strict-encodes blind transfer terminals as a sorted map', () => {
    const prefix = serializeRgbTransferPrefix([
      {
        bundleId: Uint8Array.from(Buffer.from('bb'.repeat(32), 'hex')),
        secretSeals: [Uint8Array.from(Buffer.from('22'.repeat(32), 'hex'))],
      },
    ])
    expect(prefix).toHaveLength(70)
    expect([...prefix.slice(0, 4)]).toEqual([0, 1, 1, 0])
  })
})
