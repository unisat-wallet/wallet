import { RgbServiceError } from '../errors'

export interface PsbtKeyValue {
  key: Uint8Array
  value: Uint8Array
}

export const RGB_PSBT_PREFIX = {
  MPC: Uint8Array.from([0x4d, 0x50, 0x43]),
  OPRET: Uint8Array.from([0x4f, 0x50, 0x52, 0x45, 0x54]),
  TAPRET: Uint8Array.from([0x54, 0x41, 0x50, 0x52, 0x45, 0x54]),
  RGB: Uint8Array.from([0x52, 0x47, 0x42]),
} as const

export const RGB_PSBT_SUBTYPE = {
  OPRET_HOST: 0x00,
  OPRET_COMMITMENT: 0x01,
  RGB_TRANSITION: 0x01,
  RGB_CLOSE_METHOD: 0x02,
  RGB_TAPRET_HOST_CHANGE: 0x03,
  RGB_CONSUMED_BY: 0x04,
} as const

function concat(...parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

/** Bitcoin CompactSize, used by BIP174 PSBT key/value framing only. */
export function encodeCompactSize(value: bigint) {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RgbServiceError('PSBT CompactSize value is out of range')
  }
  if (value < 0xfdn) return Uint8Array.from([Number(value)])
  if (value <= 0xffffn)
    return Uint8Array.from([0xfd, Number(value & 0xffn), Number((value >> 8n) & 0xffn)])
  if (value <= 0xffff_ffffn) {
    return Uint8Array.from([
      0xfe,
      Number(value & 0xffn),
      Number((value >> 8n) & 0xffn),
      Number((value >> 16n) & 0xffn),
      Number((value >> 24n) & 0xffn),
    ])
  }
  return Uint8Array.from([
    0xff,
    Number(value & 0xffn),
    Number((value >> 8n) & 0xffn),
    Number((value >> 16n) & 0xffn),
    Number((value >> 24n) & 0xffn),
    Number((value >> 32n) & 0xffn),
    Number((value >> 40n) & 0xffn),
    Number((value >> 48n) & 0xffn),
    Number((value >> 56n) & 0xffn),
  ])
}

/**
 * BIP174 proprietary key: 0xFC || CompactSize(prefix length) || prefix ||
 * subtype || key data. The returned key does not include its outer map length.
 */
export function encodeProprietaryPsbtKey(input: {
  prefix: Uint8Array
  subtype: number
  keyData?: Uint8Array
}) {
  if (!Number.isInteger(input.subtype) || input.subtype < 0 || input.subtype > 0xff) {
    throw new RgbServiceError('PSBT proprietary subtype is invalid')
  }
  return concat(
    Uint8Array.from([0xfc]),
    encodeCompactSize(BigInt(input.prefix.length)),
    input.prefix,
    Uint8Array.from([input.subtype]),
    input.keyData || new Uint8Array()
  )
}

/** Encode a complete BIP174 key-value record for an unknown/proprietary map. */
export function encodePsbtKeyValue(record: PsbtKeyValue) {
  return concat(
    encodeCompactSize(BigInt(record.key.length)),
    record.key,
    encodeCompactSize(BigInt(record.value.length)),
    record.value
  )
}

function rgbRecord(
  prefix: Uint8Array,
  subtype: number,
  value: Uint8Array,
  keyData?: Uint8Array
): PsbtKeyValue {
  return { key: encodeProprietaryPsbtKey({ prefix, subtype, keyData }), value }
}

/** PSBT output record declaring an OP_RETURN output as an RGB Opret host. */
export function opretHostRecord() {
  return rgbRecord(RGB_PSBT_PREFIX.OPRET, RGB_PSBT_SUBTYPE.OPRET_HOST, new Uint8Array())
}

/** PSBT output record holding the 32-byte final Opret commitment. */
export function opretCommitmentRecord(commitment: Uint8Array) {
  if (commitment.length !== 32) throw new RgbServiceError('RGB Opret commitment must be 32 bytes')
  return rgbRecord(RGB_PSBT_PREFIX.OPRET, RGB_PSBT_SUBTYPE.OPRET_COMMITMENT, commitment)
}

/** PSBT global record holding a strict-serialized RGB transition under its 32-byte operation ID. */
export function rgbTransitionRecord(operationId: Uint8Array, transition: Uint8Array) {
  if (operationId.length !== 32) throw new RgbServiceError('RGB operation ID must be 32 bytes')
  return rgbRecord(RGB_PSBT_PREFIX.RGB, RGB_PSBT_SUBTYPE.RGB_TRANSITION, transition, operationId)
}
