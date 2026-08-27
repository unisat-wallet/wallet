import { RgbServiceError } from '../errors'

const BAID64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_~'
const BAID64_DECODER = new Map(BAID64_ALPHABET.split('').map((char, index) => [char, index]))

function encodeBaid64(value: Uint8Array): string {
  let buffer = 0
  let bits = 0
  let result = ''
  for (const byte of value) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 6) {
      bits -= 6
      result += BAID64_ALPHABET[(buffer >>> bits) & 0x3f]
    }
  }
  if (bits) result += BAID64_ALPHABET[(buffer << (6 - bits)) & 0x3f]
  return result
}

function decodeBaid64(value: string): Uint8Array {
  const compact = value.replace(/-/g, '')
  if (
    compact.length !== 43 ||
    !compact ||
    compact.split('').some(char => !BAID64_DECODER.has(char))
  ) {
    throw new RgbServiceError('RGB Contract ID BAID64 encoding is invalid')
  }

  let buffer = 0
  let bits = 0
  const bytes: number[] = []
  for (const char of compact) {
    buffer = (buffer << 6) | BAID64_DECODER.get(char)!
    bits += 6
    while (bits >= 8) {
      bits -= 8
      bytes.push((buffer >>> bits) & 0xff)
    }
  }
  if (bits && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new RgbServiceError('RGB Contract ID BAID64 padding is invalid')
  }
  return Uint8Array.from(bytes)
}

function formatBaid64(value: string): string {
  return `${value.slice(0, 8)}${value.slice(8).replace(/.{1,7}/g, chunk => `-${chunk}`)}`
}

/** Encode the 32-byte ContractId using RGB's canonical BAID64 representation. */
export function encodeRgbContractId(value: Uint8Array): string {
  if (value.length !== 32) throw new RgbServiceError('RGB Contract ID must be 32 bytes')
  return `rgb:${formatBaid64(encodeBaid64(value))}`
}

/** Decode either an RGB hex ContractId or its canonical BAID64 representation. */
export function decodeRgbContractId(value: string): Uint8Array {
  const payload = value.trim().replace(/^rgb:/i, '')
  if (/^[0-9a-fA-F]{64}$/.test(payload)) {
    return Uint8Array.from(Buffer.from(payload, 'hex'))
  }
  const decoded = decodeBaid64(payload)
  if (decoded.length !== 32) throw new RgbServiceError('RGB Contract ID must be 32 bytes')
  return decoded
}

export function rgbContractIdBytes(value: string): Uint8Array {
  return decodeRgbContractId(value)
}

export function rgbContractIdHex(value: string): string {
  return Buffer.from(decodeRgbContractId(value)).toString('hex')
}

/** Normalize legacy hex IDs and official BAID64 IDs to the RGB display form. */
export function normalizeRgbAssetId(value: string): string {
  const payload = value.trim().replace(/^rgb:/i, '')
  if (/^[0-9a-fA-F]{64}$/.test(payload)) {
    return encodeRgbContractId(Uint8Array.from(Buffer.from(payload, 'hex')))
  }
  const compact = payload.replace(/-/g, '')
  if (compact.length === 43 && /^[A-Za-z0-9_~]+$/.test(compact)) {
    return encodeRgbContractId(decodeBaid64(payload))
  }
  // Keep test doubles and non-ContractId placeholders usable at protocol boundaries.
  return `rgb:${payload}`
}
