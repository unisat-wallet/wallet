import { describe, expect, it } from 'vitest'

import { deriveContextHash, parseHexContext, validateAppName } from '../src/keyrings/derive-context-hash'

describe('deriveContextHash', () => {
  const APP_NAME = 'test-app'

  describe('output format', () => {
    it('returns a 64-character hex string (32 bytes)', () => {
      const ctx = parseHexContext('deadbeef')
      const key = new Uint8Array(32).fill(0xab)
      const result = deriveContextHash(key, APP_NAME, ctx)
      expect(result).toHaveLength(64)
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('determinism', () => {
    it('produces identical results for same key + appName + context', () => {
      const ctx = parseHexContext('deadbeef')
      const key = new Uint8Array(32).fill(0xab)
      const a = deriveContextHash(key, APP_NAME, ctx)
      const b = deriveContextHash(key, APP_NAME, ctx)
      expect(a).toBe(b)
    })
  })

  describe('context differentiation', () => {
    it('produces different results for different contexts', () => {
      const key = new Uint8Array(32).fill(0xab)
      const a = deriveContextHash(key, APP_NAME, parseHexContext('01'))
      const b = deriveContextHash(key, APP_NAME, parseHexContext('02'))
      expect(a).not.toBe(b)
    })

    it('produces different results for different appNames', () => {
      const key = new Uint8Array(32).fill(0xab)
      const ctx = parseHexContext('deadbeef')
      const a = deriveContextHash(key, 'app-one', ctx)
      const b = deriveContextHash(key, 'app-two', ctx)
      expect(a).not.toBe(b)
    })
  })

  describe('input validation', () => {
    it('rejects key material that is not 32 bytes', () => {
      const ctx = parseHexContext('deadbeef')
      expect(() => deriveContextHash(new Uint8Array(16), APP_NAME, ctx)).toThrow(
        'Input key material must be 32 bytes, got 16'
      )
      expect(() => deriveContextHash(new Uint8Array(64), APP_NAME, ctx)).toThrow(
        'Input key material must be 32 bytes, got 64'
      )
    })

    it('rejects invalid appName', () => {
      const key = new Uint8Array(32).fill(0xab)
      const ctx = parseHexContext('deadbeef')
      expect(() => deriveContextHash(key, '', ctx)).toThrow('non-empty string')
      expect(() => deriveContextHash(key, 'UPPER', ctx)).toThrow('lowercase')
      expect(() => deriveContextHash(key, 'has space', ctx)).toThrow('lowercase')
    })
  })

  describe('known-answer tests (spec vectors)', () => {
    // Spec test vectors use BIP-39 mnemonic "abandon...about" (no passphrase)
    // IKM = BIP-32 private key at m/73681862'
    const IKM_HEX = '391cdb922097ec9c96fc13cadb01d5745ccf31f5dbec3a38103440714779ec85'
    const ikm = new Uint8Array(Buffer.from(IKM_HEX, 'hex'))

    it('vector 1: context=deadbeef', () => {
      const result = deriveContextHash(ikm, 'test-app', parseHexContext('deadbeef'))
      expect(result).toBe('3b0e2d90a01122eed8a520648073892f6b2d8f4419216023d63cdbd49500fca3')
    })

    it('vector 2: context=00', () => {
      const result = deriveContextHash(ikm, 'test-app', parseHexContext('00'))
      expect(result).toBe('50775126782c1a5e4d60daa4666b2c7590f0b5a445a4115b0abd411467c92597')
    })

    it('vector 3: context=64 zero bytes', () => {
      const context128zeros = '00'.repeat(64) // 64 zero bytes = 128 hex chars
      const result = deriveContextHash(ikm, 'test-app', parseHexContext(context128zeros))
      expect(result).toBe('d81e4a91f32eabd34df0e55ca36f26f211af65dfe575b7201c95baaa6608cdd9')
    })
  })
})

describe('validateAppName', () => {
  it('accepts valid appNames', () => {
    expect(() => validateAppName('test-app')).not.toThrow()
    expect(() => validateAppName('babylon-vault')).not.toThrow()
    expect(() => validateAppName('a')).not.toThrow()
    expect(() => validateAppName('a-b-c-123')).not.toThrow()
  })

  it('rejects empty', () => {
    expect(() => validateAppName('')).toThrow('non-empty string')
  })

  it('rejects uppercase', () => {
    expect(() => validateAppName('Test-App')).toThrow('lowercase')
  })

  it('rejects spaces', () => {
    expect(() => validateAppName('test app')).toThrow('lowercase')
  })

  it('rejects underscores', () => {
    expect(() => validateAppName('test_app')).toThrow('lowercase')
  })

  it('rejects > 64 bytes', () => {
    const longName = 'a'.repeat(65)
    expect(() => validateAppName(longName)).toThrow('64 bytes')
  })

  it('accepts exactly 64 bytes', () => {
    const name64 = 'a'.repeat(64)
    expect(() => validateAppName(name64)).not.toThrow()
  })
})

describe('parseHexContext', () => {
  it('parses valid lowercase hex string', () => {
    const result = parseHexContext('deadbeef')
    expect(result).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
  })

  it('rejects uppercase hex', () => {
    expect(() => parseHexContext('DEADBEEF')).toThrow('lowercase')
  })

  it('rejects mixed case hex', () => {
    expect(() => parseHexContext('DeAdBeEf')).toThrow('lowercase')
  })

  it('rejects empty string', () => {
    expect(() => parseHexContext('')).toThrow('non-empty')
  })

  it('rejects odd-length hex', () => {
    expect(() => parseHexContext('abc')).toThrow('even-length')
  })

  it('rejects non-hex characters', () => {
    expect(() => parseHexContext('xyz123')).toThrow('lowercase hex')
  })

  it('rejects 0x prefix', () => {
    expect(() => parseHexContext('0xdeadbeef')).toThrow('0x prefix')
  })

  it('rejects 0X prefix', () => {
    expect(() => parseHexContext('0Xdeadbeef')).toThrow('0x prefix')
  })

  it('rejects context exceeding 2048 hex chars', () => {
    const longHex = 'ab'.repeat(1025) // 2050 hex chars
    expect(() => parseHexContext(longHex)).toThrow('2048')
  })

  it('accepts context of exactly 2048 hex chars', () => {
    const maxHex = 'ab'.repeat(1024) // 2048 hex chars
    expect(() => parseHexContext(maxHex)).not.toThrow()
  })
})
