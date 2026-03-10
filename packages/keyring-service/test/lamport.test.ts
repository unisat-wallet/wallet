import * as bip39 from 'bip39'
import { describe, expect, it } from 'vitest'

import { deriveLamportKeypair, LAMPORT_BITS, lamportPublicKey, lamportSign } from '../src/keyrings/lamport'

const KNOWN_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

function freshSeed(): Uint8Array {
  const seed = bip39.mnemonicToSeedSync(KNOWN_MNEMONIC)
  return new Uint8Array(seed)
}

const context = Buffer.from('test-context', 'utf-8')

describe('lamport', () => {
  describe('deriveLamportKeypair', () => {
    it('generates 508 preimage and hash slots per branch', () => {
      const keypair = deriveLamportKeypair(freshSeed(), context)
      expect(keypair.falsePreimages).toHaveLength(LAMPORT_BITS)
      expect(keypair.truePreimages).toHaveLength(LAMPORT_BITS)
      expect(keypair.falseHashes).toHaveLength(LAMPORT_BITS)
      expect(keypair.trueHashes).toHaveLength(LAMPORT_BITS)
    })

    it('produces 16-byte preimages and 20-byte hashes', () => {
      const keypair = deriveLamportKeypair(freshSeed(), context)
      keypair.falsePreimages.forEach(p => expect(p.length).toBe(16))
      keypair.truePreimages.forEach(p => expect(p.length).toBe(16))
      keypair.falseHashes.forEach(h => expect(h.length).toBe(20))
      keypair.trueHashes.forEach(h => expect(h.length).toBe(20))
    })

    it('is deterministic for the same inputs', () => {
      const a = deriveLamportKeypair(freshSeed(), context)
      const b = deriveLamportKeypair(freshSeed(), context)
      expect(a.falsePreimages).toEqual(b.falsePreimages)
      expect(a.truePreimages).toEqual(b.truePreimages)
      expect(a.falseHashes).toEqual(b.falseHashes)
      expect(a.trueHashes).toEqual(b.trueHashes)
    })

    it('produces different keys for different contexts', () => {
      const ctx1 = Buffer.from('context-1', 'utf-8')
      const ctx2 = Buffer.from('context-2', 'utf-8')
      const a = deriveLamportKeypair(freshSeed(), ctx1)
      const b = deriveLamportKeypair(freshSeed(), ctx2)
      expect(a.falsePreimages[0]).not.toEqual(b.falsePreimages[0])
    })

    it('rejects invalid seed length', () => {
      expect(() => deriveLamportKeypair(new Uint8Array(32), context)).toThrow('Seed must be 64 bytes')
    })
  })

  describe('lamportPublicKey', () => {
    it('converts hashes to hex strings', () => {
      const keypair = deriveLamportKeypair(freshSeed(), context)
      const pubkey = lamportPublicKey(keypair)
      expect(pubkey.falseHashes).toHaveLength(LAMPORT_BITS)
      expect(pubkey.trueHashes).toHaveLength(LAMPORT_BITS)
      pubkey.falseHashes.forEach(h => expect(h).toMatch(/^[0-9a-f]{40}$/))
      pubkey.trueHashes.forEach(h => expect(h).toMatch(/^[0-9a-f]{40}$/))
    })
  })

  describe('lamportSign', () => {
    it('returns 508 hex-encoded preimages', () => {
      const proofBits = Array.from({ length: LAMPORT_BITS }, (_, i) => i % 2)
      const preimages = lamportSign(freshSeed(), context, proofBits)
      expect(preimages).toHaveLength(LAMPORT_BITS)
      preimages.forEach(p => expect(p).toMatch(/^[0-9a-f]{32}$/))
    })

    it('returns false preimage when bit is 0, true preimage when bit is 1', () => {
      const keypair = deriveLamportKeypair(freshSeed(), context)
      const proofBits = Array.from({ length: LAMPORT_BITS }, () => 0)
      proofBits[0] = 1
      proofBits[7] = 1

      const preimages = lamportSign(freshSeed(), context, proofBits)
      const pubkey = lamportPublicKey(keypair)

      // bit 0 is 1 → should match truePreimage[0]
      expect(preimages[0]).toBe(
        Array.from(keypair.truePreimages[0]!)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
      )
      // bit 1 is 0 → should match falsePreimage[1]
      expect(preimages[1]).toBe(
        Array.from(keypair.falsePreimages[1]!)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
      )
    })

    it('rejects wrong number of proof bits', () => {
      expect(() => lamportSign(freshSeed(), context, [0, 1])).toThrow('508 elements')
    })

    it('rejects invalid proof bit values', () => {
      const bits = Array.from({ length: LAMPORT_BITS }, () => 0)
      bits[100] = 2
      expect(() => lamportSign(freshSeed(), context, bits)).toThrow('must be 0 or 1')
    })

    it('end-to-end verify: Hash160(preimage) matches pubkey hash for every bit', () => {
      const { ripemd160 } = require('@noble/hashes/ripemd160')
      const { sha256 } = require('@noble/hashes/sha256')
      const hash160 = (data: Uint8Array) => ripemd160(sha256(data))
      const toHex = (bytes: Uint8Array) =>
        Array.from(bytes)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')

      const proofBits = Array.from({ length: LAMPORT_BITS }, (_, i) => i % 2)
      const keypair = deriveLamportKeypair(freshSeed(), context)
      const pubkey = lamportPublicKey(keypair)
      const preimages = lamportSign(freshSeed(), context, proofBits)

      for (let i = 0; i < LAMPORT_BITS; i++) {
        const preimageBytes = Buffer.from(preimages[i]!, 'hex')
        const expectedHash = proofBits[i] === 0 ? pubkey.falseHashes[i] : pubkey.trueHashes[i]
        expect(toHex(hash160(preimageBytes))).toBe(expectedHash)
      }
    })

    it('known-answer test: preimages are stable across versions', () => {
      // Pin preimage values for the known mnemonic + 'test-context'
      // to detect accidental derivation changes (e.g. library upgrades)
      const proofBits = Array.from({ length: LAMPORT_BITS }, () => 0)
      const preimages = lamportSign(freshSeed(), context, proofBits)
      expect(preimages[0]).toBe('49e17e850d0340c57954de03e6481745')
      expect(preimages[507]).toBe('4f0d118feae1b229c1ea1c32480fa2c2')
    })
  })
})
