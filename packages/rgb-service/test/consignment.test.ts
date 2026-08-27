import { Transaction } from 'bitcoinjs-lib'
import { describe, expect, it } from 'vitest'
import {
  serializeNiaOpretWitnessBundle,
  serializeRgbTransferPrefix,
  serializeStrictBitcoinTransaction,
  serializeMpcMerkleProof,
  unwrapRgbTransferConsignment,
  wrapRgbTransferConsignment,
} from '../src'

describe('RGB transfer container primitives', () => {
  it('wraps and unwraps standard RGB Transfer consignments', () => {
    const body = Uint8Array.from([0, 1, 1, 0])
    const wrapped = wrapRgbTransferConsignment(body)

    expect([...wrapped.slice(0, 7)]).toEqual([0x52, 0x47, 0x42, 0, 0x54, 0x46, 0x52])
    expect(unwrapRgbTransferConsignment(wrapped)).toEqual(body)
    expect(unwrapRgbTransferConsignment(body)).toEqual(body)
  })

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
    const contractId = Uint8Array.from(Buffer.from('11'.repeat(32), 'hex'))
    const proof = serializeMpcMerkleProof(
      [{ protocolId: contractId, message: result.bundleId }],
      1n,
      contractId
    )
    const witnessTxStrict = serializeStrictBitcoinTransaction(transaction.toBuffer())
    expect(result.strict[1 + witnessTxStrict.length + proof.length]).toBe(2)
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
