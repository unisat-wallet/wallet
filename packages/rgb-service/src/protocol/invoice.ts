import { sha256 } from '@noble/hashes/sha256'
import { RgbServiceError } from '../errors'
import type { RgbNetwork } from '../types'
import { normalizeRgbAssetId } from './contract-id'

export type RgbInvoiceRecipientType = 'blind' | 'witness'
export type RgbWitnessAddressType = 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr'

export type RgbInvoiceSeal =
  | {
      type: 'confidential'
      /** The 32-byte SecretSeal committed by a blind RGB invoice. */
      secretSeal: Uint8Array
    }
  | {
      type: 'witness'
      /** The complete 33-byte Pay2Vout encoding from the invoice. */
      pay2vout: Uint8Array
      addressType: RgbWitnessAddressType
      /** The address payload selected by Pay2Vout. */
      addressPayload: Uint8Array
      /** Optional x-only key used for Taproot key-path receive. */
      internalPubkey?: Uint8Array
    }

export interface RgbInvoice {
  raw: string
  assetId?: string
  amount?: string
  recipientId: string
  /** Per-invoice transport key. Equals recipientId unless the invoice carries rid_nonce. */
  proxyRecipientId: string
  recipientType: RgbInvoiceRecipientType
  seal: RgbInvoiceSeal
  network?: RgbNetwork
  expirationTimestamp?: number
  transportEndpoints: string[]
}

const OMITTED = '~'
const AMOUNT_ALPHABET = 'abcdefghkmnABCDEFGHKMNPQRSTVWXYZ'
const BAID64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_~'
const SECP256K1_FIELD_PRIME = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn
const amountDecoder = new Map(AMOUNT_ALPHABET.split('').map((char, index) => [char, index]))
const baid64Decoder = new Map(BAID64_ALPHABET.split('').map((char, index) => [char, index]))

function hex(value: Uint8Array) {
  return Buffer.from(value).toString('hex')
}

function decodePart(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

function getQueryValues(query: string, key: string) {
  return query
    .split('&')
    .map(part => part.split('='))
    .filter(([queryKey]) => decodePart(queryKey || '') === key)
    .map(([, ...value]) => decodePart(value.join('=')))
    .filter(Boolean)
}

function decodeFast32Amount(value?: string) {
  if (!value || value === OMITTED) return undefined
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

function normalizeAssetId(value?: string) {
  if (!value || value === OMITTED) return undefined
  return normalizeRgbAssetId(value)
}

function invoiceNetwork(recipientId: string): RgbNetwork | undefined {
  const prefix = recipientId.split(':', 1)[0]
  switch (prefix) {
    case 'bc':
      return 'mainnet'
    case 'tb':
      return 'testnet'
    case 'tbs':
      return 'signet'
    default:
      return undefined
  }
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function baid64Checksum(hri: string, payload: Uint8Array) {
  const key = sha256(new TextEncoder().encode(hri))
  const digest = sha256(concat(key, payload))
  return Uint8Array.from([digest[0]!, digest[1]!, digest[1]!, digest[2]!])
}

function baid64Encode(value: Uint8Array) {
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

function baid64WithChecksum(hri: string, payload: Uint8Array) {
  const checksum = baid64Checksum(hri, payload)
  const encoded = baid64Encode(concat(payload, checksum))
  return `${hri}:${encoded.slice(0, 8)}${encoded.slice(8).replace(/.{1,7}/g, value => `-${value}`)}`
}

function networkPrefix(network: RgbNetwork) {
  switch (network) {
    case 'mainnet':
    case 'fractal-mainnet':
    case 'fractal-test':
      return 'bc'
    case 'signet':
      return 'tbs'
    case 'testnet':
    case 'testnet4':
      return 'tb'
  }
}

function recipientNonce(endpoints: string[]) {
  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint.replace(/^rpcs:/, 'https:'))
      const value = url.searchParams.get('rid_nonce')
      if (value && /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0) {
        return Uint8Array.from(Buffer.from(value, 'hex'))
      }
    } catch {
      // Endpoint validation is performed by the transport adapter. An invalid
      // optional nonce must not make a normal invoice undecodable.
    }
  }
  return undefined
}

/** Unique proxy storage key for an invoice. The beneficiary remains unchanged. */
export function rgbInvoiceProxyRecipientId(recipientId: string, endpoints: string[]) {
  const nonce = recipientNonce(endpoints)
  if (!nonce?.length) return recipientId
  return hex(sha256(concat(new TextEncoder().encode(recipientId), nonce)))
}

/** Add the per-invoice nonce to an endpoint without changing its proxy path. */
export function appendRgbInvoiceRecipientNonce(endpoint: string, nonce: Uint8Array) {
  if (!nonce.length) throw new RgbServiceError('RGB invoice recipient nonce is required')
  const separator = endpoint.includes('?') ? '&' : '?'
  return `${endpoint}${separator}rid_nonce=${hex(nonce)}`
}

/** Decode BAID64 without padding, accepting its optional chunk separators. */
function decodeBaid64(value: string, hri: string, length: number) {
  const [encoded, mnemonic] = value.split('#', 2)
  if (mnemonic !== undefined) {
    throw new RgbServiceError('RGB invoice mnemonic checksums are not supported')
  }
  const compact = encoded!.replace(/-/g, '')
  if (!compact || compact.length % 4 === 1)
    throw new RgbServiceError(`Invalid ${hri} BAID64 encoding`)

  let buffer = 0
  let bits = 0
  const bytes: number[] = []
  for (const char of compact) {
    const digit = baid64Decoder.get(char)
    if (digit === undefined) throw new RgbServiceError(`Invalid ${hri} BAID64 encoding`)
    buffer = (buffer << 6) | digit
    bits += 6
    while (bits >= 8) {
      bits -= 8
      bytes.push((buffer >>> bits) & 0xff)
    }
  }
  if (bits && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new RgbServiceError(`Invalid ${hri} BAID64 encoding`)
  }

  const decoded = Uint8Array.from(bytes)
  if (decoded.length !== length && decoded.length !== length + 4) {
    throw new RgbServiceError(`Invalid ${hri} BAID64 length`)
  }
  const payload = decoded.slice(0, length)
  if (
    decoded.length === length + 4 &&
    !equalBytes(decoded.slice(length), baid64Checksum(hri, payload))
  ) {
    throw new RgbServiceError(`Invalid ${hri} BAID64 checksum`)
  }
  return payload
}

function bytesToBigInt(bytes: Uint8Array) {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

function modularPower(base: bigint, exponent: bigint, modulo: bigint) {
  let result = 1n
  let value = base % modulo
  let power = exponent
  while (power > 0n) {
    if (power & 1n) result = (result * value) % modulo
    value = (value * value) % modulo
    power >>= 1n
  }
  return result
}

function isValidXOnlyPublicKey(value: Uint8Array) {
  if (value.length !== 32) return false
  const x = bytesToBigInt(value)
  if (x >= SECP256K1_FIELD_PRIME) return false
  const ySquared = (x * x * x + 7n) % SECP256K1_FIELD_PRIME
  return modularPower(ySquared, (SECP256K1_FIELD_PRIME - 1n) / 2n, SECP256K1_FIELD_PRIME) === 1n
}

function decodeHex32(value: string, name: string) {
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new RgbServiceError(`${name} must be a 32-byte hexadecimal key`)
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  if (!isValidXOnlyPublicKey(bytes))
    throw new RgbServiceError(`${name} is not a valid x-only public key`)
  return bytes
}

function decodeInvoiceSeal(recipientId: string): RgbInvoiceSeal {
  const separator = recipientId.indexOf(':')
  if (separator <= 0) throw new RgbServiceError('RGB invoice beneficiary is missing a network')
  const beneficiary = recipientId.slice(separator + 1)
  if (beneficiary.startsWith('utxob:')) {
    if (beneficiary.includes('+'))
      throw new RgbServiceError('RGB blind beneficiary cannot include an internal key')
    return { type: 'confidential', secretSeal: decodeBaid64(beneficiary.slice(6), 'utxob', 32) }
  }

  const [encodedPay2Vout, internalKey, ...rest] = beneficiary.split('+')
  if (rest.length || !encodedPay2Vout?.startsWith('wvout:')) {
    throw new RgbServiceError('RGB invoice beneficiary must be a utxob or wvout seal')
  }
  if (internalKey === '')
    throw new RgbServiceError('RGB witness beneficiary has an empty internal key')
  const pay2vout = decodeBaid64(encodedPay2Vout.slice(6), 'wvout', 33)
  const addressTypes: Record<number, RgbWitnessAddressType> = {
    1: 'p2pkh',
    2: 'p2sh',
    3: 'p2wpkh',
    4: 'p2wsh',
    5: 'p2tr',
  }
  const addressType = addressTypes[pay2vout[0]!]
  if (!addressType)
    throw new RgbServiceError('RGB witness beneficiary has an unsupported address type')
  const addressPayload = pay2vout.slice(
    1,
    addressType === 'p2pkh' || addressType === 'p2sh' || addressType === 'p2wpkh' ? 21 : 33
  )
  if (addressType === 'p2tr' && !isValidXOnlyPublicKey(addressPayload)) {
    throw new RgbServiceError('RGB witness beneficiary has an invalid Taproot output key')
  }
  return {
    type: 'witness',
    pay2vout,
    addressType,
    addressPayload,
    ...(internalKey === undefined
      ? {}
      : { internalPubkey: decodeHex32(internalKey, 'RGB witness beneficiary internal key') }),
  }
}

/**
 * Decode the stable RGB invoice fields needed before constructing a transfer.
 * Transition and consignment decoding stays in the local protocol encoder.
 */
export function decodeRgbInvoice(invoice: string): RgbInvoice {
  const raw = invoice.trim()
  const match = raw.match(/^rgb:(.*)$/i)
  if (!match) throw new Error('Invalid RGB invoice scheme')

  const [path, query = ''] = match[1]!.split('?', 2)
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 4) throw new Error('Invalid RGB invoice payload')

  const recipientId = segments[3]!
  const seal = decodeInvoiceSeal(recipientId)
  const [queryAmount] = getQueryValues(query, 'amount')
  const [queryAssetId] = getQueryValues(query, 'assetId')
  const [expiration] = getQueryValues(query, 'expirationTimestamp')
  const transportEndpoints = getQueryValues(query, 'endpoints').flatMap(value =>
    value
      .split(',')
      .map(endpoint => endpoint.trim())
      .filter(Boolean)
  )
  const amount = queryAmount || decodeFast32Amount(segments[2])
  if (amount !== undefined && !/^(0|[1-9][0-9]*)$/.test(amount)) {
    throw new Error('Invalid RGB invoice amount')
  }

  return {
    raw,
    assetId: normalizeAssetId(queryAssetId || segments[0]),
    amount,
    recipientId,
    proxyRecipientId: rgbInvoiceProxyRecipientId(recipientId, transportEndpoints),
    recipientType: seal.type === 'confidential' ? 'blind' : 'witness',
    seal,
    network: invoiceNetwork(recipientId),
    expirationTimestamp:
      expiration && /^(0|[1-9][0-9]*)$/.test(expiration) ? Number(expiration) : undefined,
    transportEndpoints,
  }
}

/**
 * Build a witness invoice for a P2TR script controlled by the RGB funding
 * key. A witness beneficiary is a script, never an outpoint: its txid/vout
 * are created later by the sender's transaction.
 */
export function encodeWitnessRgbInvoice(input: {
  network: RgbNetwork
  scriptPubKey: string
  assetId?: string
  amount?: string
  expirationTimestamp?: number
  transportEndpoints: string[]
}) {
  if (!/^(0|[1-9][0-9]*)$/.test(input.amount ?? '0'))
    throw new RgbServiceError('RGB invoice amount is invalid')
  if (input.amount !== undefined && BigInt(input.amount) > 0xffff_ffff_ffff_ffffn)
    throw new RgbServiceError('RGB invoice amount exceeds the maximum u64 value')
  if (!/^(5120)[0-9a-f]{64}$/i.test(input.scriptPubKey)) {
    throw new RgbServiceError('RGB witness invoices currently require a P2TR funding script')
  }
  if (!input.transportEndpoints.length) throw new RgbServiceError('RGB proxy endpoint is not configured')
  const pay2vout = Uint8Array.from([5, ...Buffer.from(input.scriptPubKey.slice(4), 'hex')])
  const recipientId = `${networkPrefix(input.network)}:${baid64WithChecksum('wvout', pay2vout)}`
  const assetId = input.assetId ? normalizeRgbAssetId(input.assetId).replace(/^rgb:/, '') : '~'
  const query = new URLSearchParams()
  if (input.amount !== undefined) query.set('amount', input.amount)
  if (input.expirationTimestamp !== undefined)
    query.set('expirationTimestamp', String(input.expirationTimestamp))
  query.set('endpoints', input.transportEndpoints.join(','))
  return `rgb:${assetId}/~/${input.amount === undefined ? '~' : '~'}/${recipientId}?${query}`
}
