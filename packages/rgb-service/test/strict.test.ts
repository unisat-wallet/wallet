import { describe, expect, it } from 'vitest'
import { StrictWriter, strictLengthWidth } from '../src'

describe('StrictWriter', () => {
  it('uses little-endian fixed-size integer encoding', () => {
    const writer = new StrictWriter()
      .writeU16(0x1234)
      .writeU24(0x56789a)
      .writeU64(0x0102030405060708n)
    expect(writer.toHex()).toBe('34129a78560807060504030201')
  })

  it('uses the maximum collection size to choose the length prefix width', () => {
    expect(strictLengthWidth(0xff)).toBe(1)
    expect(strictLengthWidth(0x100)).toBe(2)
    expect(strictLengthWidth(0x10000)).toBe(3)

    const tiny = new StrictWriter().writeConfinedBytes(Uint8Array.from([0xaa]), 0xff)
    const small = new StrictWriter().writeConfinedBytes(Uint8Array.from([0xaa]), 0x100)
    expect(tiny.toHex()).toBe('01aa')
    expect(small.toHex()).toBe('0100aa')
  })

  it('rejects values outside their declared strict ranges', () => {
    expect(() => new StrictWriter().writeU16(0x10000)).toThrow('u16')
    expect(() => new StrictWriter().writeConfinedBytes(Uint8Array.from([1, 2]), 1)).toThrow(
      'exceeds maximum length'
    )
  })
})
