import { describe, expect, it } from 'vitest'
import {
  encodeCompactSize,
  encodePsbtKeyValue,
  opretCommitmentRecord,
  opretHostRecord,
  rgbTransitionRecord,
} from '../src'

function hex(bytes: Uint8Array) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

describe('RGB PSBT proprietary records', () => {
  it('uses BIP174 proprietary key framing for an OPRET host', () => {
    const record = opretHostRecord()
    expect(hex(record.key)).toBe('fc054f5052455400')
    expect(hex(encodePsbtKeyValue(record))).toBe('08fc054f505245540000')
  })

  it('encodes a 32-byte OPRET commitment under the reference namespace', () => {
    const record = opretCommitmentRecord(Uint8Array.from(new Array(32).fill(0xab)))
    expect(hex(record.key)).toBe('fc054f5052455401')
    expect(record.value).toHaveLength(32)
  })

  it('uses the RGB transition subtype and operation ID as proprietary key data', () => {
    const record = rgbTransitionRecord(
      Uint8Array.from(new Array(32).fill(1)),
      Uint8Array.from([0xaa, 0xbb])
    )
    expect(hex(record.key)).toBe(`fc0352474201${'01'.repeat(32)}`)
    expect(hex(encodePsbtKeyValue(record))).toBe(`26fc0352474201${'01'.repeat(32)}02aabb`)
  })

  it('uses Bitcoin CompactSize for PSBT framing', () => {
    expect(hex(encodeCompactSize(0xfcn))).toBe('fc')
    expect(hex(encodeCompactSize(0xfdn))).toBe('fdfd00')
  })
})
