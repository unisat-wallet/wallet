import * as bip39 from 'bip39'
import { describe, expect, it } from 'vitest'

import { deriveContextHash, parseHexContext } from '../src/keyrings/derive-context-hash'

const KNOWN_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const SAMPLE_MNEMONIC =
  'finish oppose decorate face calm tragic certain desk hour urge dinosaur mango'

function freshSeed(): Uint8Array {
  const seed = bip39.mnemonicToSeedSync(KNOWN_MNEMONIC)
  return new Uint8Array(seed.buffer, seed.byteOffset, seed.byteLength)
}

describe('deriveContextHash', () => {
  describe('output format', () => {
    it('returns a 64-character hex string (32 bytes) for 64-byte seed', () => {
      const ctx = Buffer.from('test-context', 'utf-8')
      const result = deriveContextHash(freshSeed(), ctx)
      expect(result).toHaveLength(64)
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('returns a 64-character hex string (32 bytes) for 32-byte key', () => {
      const ctx = Buffer.from('test-context', 'utf-8')
      const key = new Uint8Array(32).fill(0xab)
      const result = deriveContextHash(key, ctx)
      expect(result).toHaveLength(64)
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('determinism', () => {
    it('produces identical results for same seed + context', () => {
      const ctx = Buffer.from('test-context', 'utf-8')
      const a = deriveContextHash(freshSeed(), ctx)
      const b = deriveContextHash(freshSeed(), ctx)
      expect(a).toBe(b)
    })

    it('produces identical results for same 32-byte key + context', () => {
      const ctx = Buffer.from('test-context', 'utf-8')
      const key = new Uint8Array(32).fill(0xab)
      const a = deriveContextHash(key, ctx)
      const b = deriveContextHash(key, ctx)
      expect(a).toBe(b)
    })
  })

  describe('context differentiation', () => {
    it('produces different results for different contexts', () => {
      const ctx1 = Buffer.from('context-1', 'utf-8')
      const ctx2 = Buffer.from('context-2', 'utf-8')
      const a = deriveContextHash(freshSeed(), ctx1)
      const b = deriveContextHash(freshSeed(), ctx2)
      expect(a).not.toBe(b)
    })

    it('produces different results for empty vs non-empty context', () => {
      const empty = new Uint8Array(0)
      const nonempty = Buffer.from('x', 'utf-8')
      const a = deriveContextHash(freshSeed(), empty)
      const b = deriveContextHash(freshSeed(), nonempty)
      expect(a).not.toBe(b)
    })
  })

  describe('input validation', () => {
    it('rejects key material that is not 32 or 64 bytes', () => {
      const ctx = Buffer.from('test', 'utf-8')
      expect(() => deriveContextHash(new Uint8Array(16), ctx)).toThrow(
        'Input key material must be 32 or 64 bytes, got 16'
      )
      expect(() => deriveContextHash(new Uint8Array(48), ctx)).toThrow(
        'Input key material must be 32 or 64 bytes, got 48'
      )
      expect(() => deriveContextHash(new Uint8Array(128), ctx)).toThrow(
        'Input key material must be 32 or 64 bytes, got 128'
      )
    })
  })

  describe('seed vs private key isolation', () => {
    it('32-byte key and 64-byte seed produce different results for same context', () => {
      const ctx = Buffer.from('test-context', 'utf-8')
      const seed = freshSeed()
      const key32 = seed.slice(0, 32) // first 32 bytes of seed
      const a = deriveContextHash(seed, ctx)
      const b = deriveContextHash(key32, ctx)
      expect(a).not.toBe(b)
    })
  })

  describe('binary context edge cases', () => {
    it('handles all-zero context', () => {
      const ctx = new Uint8Array(32)
      const result = deriveContextHash(freshSeed(), ctx)
      expect(result).toHaveLength(64)
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('handles all-0xff context', () => {
      const ctx = new Uint8Array(32).fill(0xff)
      const result = deriveContextHash(freshSeed(), ctx)
      expect(result).toHaveLength(64)
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('handles large context (10KB)', () => {
      const ctx = new Uint8Array(10240).fill(0xab)
      const result = deriveContextHash(freshSeed(), ctx)
      expect(result).toHaveLength(64)
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('all-zero and all-0xff contexts produce different results', () => {
      const zeros = deriveContextHash(freshSeed(), new Uint8Array(32))
      const ones = deriveContextHash(freshSeed(), new Uint8Array(32).fill(0xff))
      expect(zeros).not.toBe(ones)
    })
  })

  describe('different mnemonics', () => {
    it('produces different results for different seeds with same context', () => {
      const ctx = Buffer.from('test-context', 'utf-8')
      const seed1 = freshSeed()
      const seed2Buf = bip39.mnemonicToSeedSync(SAMPLE_MNEMONIC)
      const seed2 = new Uint8Array(seed2Buf.buffer, seed2Buf.byteOffset, seed2Buf.byteLength)
      const a = deriveContextHash(seed1, ctx)
      const b = deriveContextHash(seed2, ctx)
      expect(a).not.toBe(b)
    })
  })

  describe('known-answer tests (HKDF-SHA-256)', () => {
    it('produces a stable output for regression detection', () => {
      const ctx = Buffer.from('babylon-vault-test', 'utf-8')
      const result = deriveContextHash(freshSeed(), ctx)
      // Pinned value — if this changes, the derivation scheme has changed
      expect(result).toBe('fb9046c540159d2a3f2ff36c79da7079b9f65b9e231dcc47eaf780e57122359b')
    })

    it('produces a stable output for a second context', () => {
      const ctx = Buffer.from('babylon-htlc-preimage', 'utf-8')
      const result = deriveContextHash(freshSeed(), ctx)
      // Second pinned value for broader regression coverage
      expect(result).toBe('31cf9bf4e4311b944414deac608a908ec85dd82b240bea0d5a362f24ff49dc62')
    })

    it('produces a stable output for 32-byte private key', () => {
      const privKey = Buffer.from('69f477943dd1591f0261cabade0839e2ffc0c13d8fa1ce0d69f6c6c251163b34', 'hex')
      const ctx = Buffer.from('deadbeef', 'hex')
      const result = deriveContextHash(new Uint8Array(privKey), ctx)
      expect(result).toBe('b86b70d096cbb96f290ad04b45734a4fdd232ab846c1d675802150065856fb30')
    })
  })
})

// Note: HdKeyring integration tests are in hd-keyring.test.ts
// because HdKeyring imports @unisat/wallet-bitcoin which requires the package to be built first.
// SimpleKeyring integration tests are in simple-keyring.test.ts.

describe('parseHexContext', () => {
  it('parses valid hex string', () => {
    const result = parseHexContext('deadbeef')
    expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
  })

  it('handles uppercase hex', () => {
    const result = parseHexContext('DEADBEEF')
    expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
  })

  it('handles mixed case hex', () => {
    const result = parseHexContext('DeAdBeEf')
    expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
  })

  it('rejects empty string', () => {
    expect(() => parseHexContext('')).toThrow('non-empty')
  })

  it('rejects odd-length hex', () => {
    expect(() => parseHexContext('abc')).toThrow('even-length')
  })

  it('rejects non-hex characters', () => {
    expect(() => parseHexContext('xyz123')).toThrow('valid hex')
  })
})
