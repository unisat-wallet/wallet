import { RgbServiceError } from '../errors'

const AMOUNT_ALPHABET = 'abcdefghkmnABCDEFGHKMNPQRSTVWXYZ'
const amountDecoder = new Map(AMOUNT_ALPHABET.split('').map((char, index) => [char, index]))

export function decodeRgbInvoiceAmountState(value?: string) {
  if (!value || value === '~') return undefined
  let buffer = 0
  let bits = 0
  const bytes: number[] = []
  for (const char of value) {
    const decoded = amountDecoder.get(char)
    if (decoded === undefined) return undefined
    buffer = (buffer << 5) | decoded
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  if (!bytes.length || bytes.length > 8) return undefined

  return bytes
    .reduce((amount, byte, index) => amount + (BigInt(byte) << BigInt(index * 8)), 0n)
    .toString()
}

/** Encode RGB invoice fungible state using Amount's trimmed LE u64 Fast32 format. */
export function encodeRgbInvoiceAmountState(value: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new RgbServiceError('RGB invoice amount is invalid')
  let amount = BigInt(value)
  if (amount > 0xffff_ffff_ffff_ffffn)
    throw new RgbServiceError('RGB invoice amount exceeds the maximum u64 value')
  const bytes: number[] = []
  do {
    bytes.push(Number(amount & 0xffn))
    amount >>= 8n
  } while (amount > 0n)

  let buffer = 0
  let bits = 0
  let encoded = ''
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      encoded += AMOUNT_ALPHABET[(buffer >> bits) & 0x1f]
    }
  }
  if (bits) encoded += AMOUNT_ALPHABET[(buffer << (5 - bits)) & 0x1f]
  return encoded
}
