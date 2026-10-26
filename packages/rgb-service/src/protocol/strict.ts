import { RgbServiceError } from '../errors'

/**
 * RGB strict-encoding chooses a collection length width from the collection's
 * declared maximum size, not from the actual size (and not Bitcoin CompactSize).
 */
export function strictLengthWidth(maxLength: number) {
  if (!Number.isSafeInteger(maxLength) || maxLength < 0) {
    throw new RgbServiceError('Strict encoding maximum length must be a non-negative integer')
  }
  if (maxLength <= 0xff) return 1
  if (maxLength <= 0xffff) return 2
  if (maxLength <= 0xffffff) return 3
  if (maxLength <= 0xffffffff) return 4
  return 8
}

function assertUnsigned(value: number, max: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new RgbServiceError(`${name} must be an unsigned integer in range`)
  }
}

/** Minimal deterministic writer for primitives used by RGB strict encoding. */
export class StrictWriter {
  private readonly chunks: number[] = []

  writeU8(value: number) {
    assertUnsigned(value, 0xff, 'u8')
    this.chunks.push(value)
    return this
  }

  writeU16(value: number) {
    assertUnsigned(value, 0xffff, 'u16')
    this.chunks.push(value & 0xff, (value >>> 8) & 0xff)
    return this
  }

  writeU24(value: number) {
    assertUnsigned(value, 0xffffff, 'u24')
    this.chunks.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff)
    return this
  }

  writeU32(value: number) {
    assertUnsigned(value, 0xffffffff, 'u32')
    this.chunks.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff
    )
    return this
  }

  writeU64(value: bigint) {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
      throw new RgbServiceError('u64 must be an unsigned integer in range')
    }
    for (let index = 0n; index < 8n; index++) {
      this.chunks.push(Number((value >> (index * 8n)) & 0xffn))
    }
    return this
  }

  writeFixedBytes(bytes: Uint8Array, length: number) {
    if (bytes.length !== length) {
      throw new RgbServiceError(`Strict fixed byte array must have length ${length}`)
    }
    this.chunks.push(...bytes)
    return this
  }

  writeConfinedBytes(bytes: Uint8Array, maxLength: number) {
    if (bytes.length > maxLength) {
      throw new RgbServiceError(`Strict byte collection exceeds maximum length ${maxLength}`)
    }
    this.writeLength(bytes.length, maxLength)
    this.chunks.push(...bytes)
    return this
  }

  writeConfinedString(value: string, maxLength: number) {
    return this.writeConfinedBytes(new TextEncoder().encode(value), maxLength)
  }

  writeConfinedCollection<T>(items: readonly T[], maxLength: number, encode: (item: T) => void) {
    if (items.length > maxLength) {
      throw new RgbServiceError(`Strict collection exceeds maximum length ${maxLength}`)
    }
    this.writeLength(items.length, maxLength)
    items.forEach(encode)
    return this
  }

  toBytes() {
    return Uint8Array.from(this.chunks)
  }

  toHex() {
    return [...this.toBytes()].map(byte => byte.toString(16).padStart(2, '0')).join('')
  }

  private writeLength(length: number, maxLength: number) {
    assertUnsigned(length, maxLength, 'Strict collection length')
    switch (strictLengthWidth(maxLength)) {
      case 1:
        return this.writeU8(length)
      case 2:
        return this.writeU16(length)
      case 3:
        return this.writeU24(length)
      case 4:
        return this.writeU32(length)
      default:
        return this.writeU64(BigInt(length))
    }
  }
}

/** Bounds-checked reader for the strict primitives used by local RGB parsing. */
export class StrictReader {
  private offset = 0

  constructor(private readonly value: Uint8Array) {}

  get position() {
    return this.offset
  }

  get remaining() {
    return this.value.length - this.offset
  }

  readU8() {
    return this.readFixedBytes(1)[0]!
  }

  readU16() {
    const value = this.readFixedBytes(2)
    return value[0]! | (value[1]! << 8)
  }

  readU32() {
    const value = this.readFixedBytes(4)
    return (value[0]! + value[1]! * 0x100 + value[2]! * 0x1_0000 + value[3]! * 0x1_000000) >>> 0
  }

  readU64() {
    const value = this.readFixedBytes(8)
    return value.reduce((total, byte, index) => total | (BigInt(byte) << BigInt(index * 8)), 0n)
  }

  readFixedBytes(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || this.remaining < length) {
      throw new RgbServiceError('Unexpected end of strict RGB data')
    }
    // Buffer.slice() returns a shared-memory view, unlike Uint8Array.slice().
    // Always copy so callers may safely reverse or otherwise transform fields
    // without mutating the source consignment between validation passes.
    const result = Uint8Array.from(this.value.subarray(this.offset, this.offset + length))
    this.offset += length
    return result
  }

  readConfinedBytes(maxLength: number) {
    const width = strictLengthWidth(maxLength)
    const length =
      width === 1
        ? this.readU8()
        : width === 2
          ? this.readU16()
          : width === 3
            ? this.readU24()
            : width === 4
              ? this.readU32()
              : Number(this.readU64())
    if (length > maxLength)
      throw new RgbServiceError('Strict RGB collection exceeds its declared maximum')
    return this.readFixedBytes(length)
  }

  slice(start: number, end = this.offset) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.value.length
    ) {
      throw new RgbServiceError('Strict RGB slice is out of range')
    }
    return this.value.slice(start, end)
  }

  private readU24() {
    const value = this.readFixedBytes(3)
    return value[0]! | (value[1]! << 8) | (value[2]! << 16)
  }
}
