import { describe, expect, it } from 'vitest'
import {
  BFA_SCHEMA_ID,
  LEGACY_BFA_SCHEMA_ID,
  encodeBfaTransferConsignment,
  isBfaTransferConsignment,
  normalizeLegacyV1Consignment,
} from '../src/protocol/bfa-consignment'
import { encodeBfaBurnTransition } from '../src/protocol/nia'
import {
  createBfaBurnDestinationV1,
  hashBfaBurnDestinationV1,
  normalizeBfaBurnDestination,
} from '../src/protocol/bfa-burn-destination'
import { StrictReader } from '../src/protocol/strict'

describe('BFA burn encoding', () => {
  it('matches the official V1 burn destination routes and vectors', () => {
    const arbitrum = createBfaBurnDestinationV1(42161, '0x' + '11'.repeat(20))
    expect(arbitrum).toEqual({
      version: 1, destinationChainId: 42161, dstEid: 0, recipient: '11'.repeat(20),
    })
    expect(hashBfaBurnDestinationV1(arbitrum)).toMatch(/^[0-9a-f]{64}$/)
    const ethereum = createBfaBurnDestinationV1(1, '0x' + '22'.repeat(20))
    expect(ethereum).toEqual({
      version: 1, destinationChainId: 1, dstEid: 30101, recipient: '22'.repeat(20),
    })
    expect(hashBfaBurnDestinationV1(ethereum)).toBe(
      '9274beba7130d3f8a4ef95c5c4c555616718050c688f8478e23f8131762a9537'
    )
    const tron = createBfaBurnDestinationV1(728126428, '41' + '33'.repeat(20))
    expect(hashBfaBurnDestinationV1(tron)).toBe(
      '60c369ce30870783c2a8cee9e6018e78650ad4787c2e898c05c35cb85179eac0'
    )
    expect(() => createBfaBurnDestinationV1(1, '0x' + '00'.repeat(20))).toThrow()
    expect(() => createBfaBurnDestinationV1(1, '0x' + 'a'.repeat(41))).toThrow()
    expect(() => createBfaBurnDestinationV1(728126428, '41' + '00'.repeat(20))).toThrow()
    expect(() => hashBfaBurnDestinationV1({ ...ethereum, dstEid: 0 })).toThrow()
  })
  it('requires a destination and pads a 20-byte EVM address to bytes32', () => {
    expect(normalizeBfaBurnDestination('0xf39FD6e51aad88f6f4ce6ab8827279cfffb92266')).toBe(
      '000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266'
    )
    expect(() => normalizeBfaBurnDestination(undefined)).toThrow('requires an EVM address')
    expect(() => normalizeBfaBurnDestination('0x' + '00'.repeat(20))).toThrow('requires an EVM address')
  })

  it('decodes Tron Base58Check addresses and rejects damaged checksums', () => {
    const tron = createBfaBurnDestinationV1(728126428, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
    expect(tron.recipient).toMatch(/^41[0-9a-f]{40}$/)
    expect(hashBfaBurnDestinationV1(tron)).toMatch(/^[0-9a-f]{64}$/)
    expect(() => createBfaBurnDestinationV1(728126428, 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'))
      .toThrow('checksum')
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
      genesis, validatedWitnessBundles: [], witnessBundle: Uint8Array.from([1]),
    })
    expect(Buffer.from(proof.slice(0, 9)).toString('hex')).toBe('524742005446520101')
    expect(proof[9]).toBe(0)
    expect(proof[10]).toBe(0)
    expect(Buffer.from(proof.slice(11, 43)).toString('hex')).toBe(BFA_SCHEMA_ID)
    expect(isBfaTransferConsignment(proof)).toBe(true)
  })

  it('emits the Wallet 1.8.2 terminals-map layout for a legacy burn proof', () => {
    const genesis = Uint8Array.from([0, 0, ...Buffer.from(LEGACY_BFA_SCHEMA_ID, 'hex')])
    const witnessBundle = Uint8Array.from([1])
    const legacy = encodeBfaTransferConsignment({
      genesis,
      validatedWitnessBundles: [],
      witnessBundle,
      legacyTerminals: [],
    })
    const current = encodeBfaTransferConsignment({
      genesis,
      validatedWitnessBundles: [],
      witnessBundle,
    })
    expect(Buffer.from(legacy.slice(7, 11)).toString('hex')).toBe('01010000')
    expect(normalizeLegacyV1Consignment(legacy)).toEqual(current)
    expect(isBfaTransferConsignment(legacy)).toBe(true)
  })
})
