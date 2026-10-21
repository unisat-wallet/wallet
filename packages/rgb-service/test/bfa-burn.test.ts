import { describe, expect, it } from 'vitest'
import { BFA_SCHEMA_ID, encodeBfaTransferConsignment, isBfaTransferConsignment } from '../src/protocol/bfa-consignment'
import { encodeBfaBurnTransition } from '../src/protocol/nia'
import { normalizeBfaBurnDestination } from '../src/protocol/bfa-burn-destination'
import { StrictReader } from '../src/protocol/strict'

describe('BFA burn encoding', () => {
  it('requires a destination and pads a 20-byte EVM address to bytes32', () => {
    expect(normalizeBfaBurnDestination('0xf39FD6e51aad88f6f4ce6ab8827279cfffb92266')).toBe(
      '000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266'
    )
    expect(() => normalizeBfaBurnDestination(undefined)).toThrow('requires an EVM address')
    expect(() => normalizeBfaBurnDestination('0x' + '00'.repeat(20))).toThrow('requires an EVM address')
  })

  it('commits the burned amount and reason without a recipient assignment', () => {
    const reason = 'ab'.repeat(32)
    const transition = encodeBfaBurnTransition({
      contractId: '11'.repeat(32), nonce: 7n,
      inputs: [{ opId: '22'.repeat(32), assignmentIndex: 0 }],
      burnedAmount: 100n, burnReason: reason,
    })
    const reader = new StrictReader(transition.strict)
    expect(reader.readU16()).toBe(0)
    reader.readFixedBytes(32)
    expect(reader.readU64()).toBe(7n)
    expect(reader.readU16()).toBe(8010)
    expect(reader.readU8()).toBe(0) // empty metadata
    expect(reader.readU8()).toBe(2) // burnedAsset and burnReason
    expect(reader.readU16()).toBe(2015)
    expect(reader.readU16()).toBe(1)
    expect(new StrictReader(reader.readConfinedBytes(65535)).readU64()).toBe(100n)
    expect(reader.readU16()).toBe(3009)
    expect(reader.readU16()).toBe(1)
    expect(Buffer.from(reader.readConfinedBytes(65535)).toString('hex')).toBe(reason)
    expect(reader.readU16()).toBe(1) // one input
    reader.readFixedBytes(36)
    expect(reader.readU16()).toBe(0) // no remaining assets
    expect(reader.readU8()).toBe(0) // unsigned v1 signature
    expect(reader.remaining).toBe(0)
    expect(transition.opId).toHaveLength(32)
  })

  it('rejects malformed burn reasons and builds a terminal-free v1 proof', () => {
    expect(() => encodeBfaBurnTransition({
      contractId: '11'.repeat(32), nonce: 1n,
      inputs: [{ opId: '22'.repeat(32), assignmentIndex: 0 }],
      burnedAmount: 1n, burnReason: 'deadbeef',
    })).toThrow('burn reason')
    const genesis = Uint8Array.from([0, 0, ...Buffer.from(BFA_SCHEMA_ID, 'hex')])
    const proof = encodeBfaTransferConsignment({
      genesis, validatedWitnessBundles: [], witnessBundle: Uint8Array.from([1]), terminals: [],
    })
    expect(Buffer.from(proof.slice(0, 9)).toString('hex')).toBe('524742005446520101')
    expect(proof[9]).toBe(0)
    expect(proof[10]).toBe(0)
    expect(isBfaTransferConsignment(proof)).toBe(true)
  })
})
