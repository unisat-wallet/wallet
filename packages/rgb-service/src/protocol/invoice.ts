import { sha256 } from '@noble/hashes/sha256'
import { RgbServiceError } from '../errors'
import type { RgbNetwork } from '../types'
import { NIA_V1_SCHEMA_ID, isBfaSchemaId } from './bfa-consignment'
import { normalizeRgbAssetId } from './contract-id'
import { decodeRgbInvoiceAmountState, encodeRgbInvoiceAmountState } from './invoice-amount'

export type RgbInvoiceRecipientType = 'blind' | 'witness'
export type RgbWitnessAddressType = 'p2pkh' | 'p2sh' | 'p2wpkh' | 'p2wsh' | 'p2tr'
export type RgbInvoiceEncryption = 'required' | 'unsupported' | 'optional'

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
  /** Proxy v1 invoice signing key; distinct from the Bitcoin funding key. */
  proxyPublicKey?: string
  proxyInvoiceId?: string
  assetId?: string
  amount?: string
  schema?: 'NIA' | 'BFA'
  assignmentName?: 'assetOwner'
  encryption: RgbInvoiceEncryption
  recipientId: string
  /** Per-invoice proxy key: v1 invoice ID, legacy nonce key, or beneficiary. */
  proxyRecipientId: string
  recipientType: RgbInvoiceRecipientType
  seal: RgbInvoiceSeal
  network?: RgbNetwork
  expirationTimestamp?: number
  transportEndpoints: string[]
}

const OMITTED = '~'
const PROXY_INVOICE_ID_PREFIX = 'rgb-proxy-server/invoice/v1'
const BAID64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_~'
const SECP256K1_FIELD_PRIME = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn
const baid64Decoder = new Map(BAID64_ALPHABET.split('').map((char, index) => [char, index]))

function hex(value: Uint8Array) {
  return Buffer.from(value).toString('hex')
}

export function rgbProxyInvoiceId(recipientId: string, publicKey: string) {
  if (!/^[0-9a-f]{64}$/.test(publicKey)) {
    throw new RgbServiceError('RGB proxy invoice public key is invalid')
  }
  return hex(sha256(new TextEncoder().encode(PROXY_INVOICE_ID_PREFIX + recipientId + publicKey)))
}

function decodePart(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

function getAllQueryValues(query: string, key: string) {
  return query
    .split('&')
    .map(part => part.split('='))
    .filter(([queryKey]) => decodePart(queryKey || '') === key)
    .map(([, ...value]) => decodePart(value.join('=')))
}

function getQueryValues(query: string, key: string) {
  return getAllQueryValues(query, key).filter(Boolean)
}

function normalizeAssetId(value?: string) {
  if (!value || value === OMITTED) return undefined
  return normalizeRgbAssetId(value)
}

function decodeInvoiceSchema(value: string): RgbInvoice['schema'] {
  if (value === OMITTED) return undefined
  let schemaId: string
  try {
    schemaId = hex(decodeBaid64(value, 'rgb:sch', 32))
  } catch {
    throw new RgbServiceError('RGB invoice schema is invalid')
  }
  if (schemaId === NIA_V1_SCHEMA_ID) return 'NIA'
  if (isBfaSchemaId(schemaId)) return 'BFA'
  throw new RgbServiceError('RGB invoice schema is not supported')
}

function invoiceNetwork(recipientId: string): RgbNetwork | undefined {
  const prefix = recipientId.split(':', 1)[0]
  switch (prefix) {
    case 'bc':
      return 'mainnet'
    case 'tb':
      return 'testnet'
    case 'sb':
    case 'tbs': // Read invoices created by older wallet versions.
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
      return 'sb'
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
  const segments = path.split('/')
  if (segments.length !== 4 || segments.some(segment => !segment)) {
    throw new Error('Invalid RGB invoice payload')
  }

  const recipientId = segments[3]!
  const seal = decodeInvoiceSeal(recipientId)
  const [queryAmount] = getQueryValues(query, 'amount')
  const [queryAssetId] = getQueryValues(query, 'assetId')
  const expirations = getAllQueryValues(query, 'expiry')
  const legacyExpirations = getAllQueryValues(query, 'expirationTimestamp')
  if (expirations.length + legacyExpirations.length > 1) {
    throw new RgbServiceError('RGB invoice expiry is ambiguous')
  }
  const [expiration] = expirations.length ? expirations : legacyExpirations
  if (expiration !== undefined &&
    (!/^(0|[1-9][0-9]*)$/.test(expiration) || !Number.isSafeInteger(Number(expiration)))) {
    throw new RgbServiceError('RGB invoice expiry is invalid')
  }
  const [proxyPublicKey] = getQueryValues(query, 'pk')
  if (proxyPublicKey && !/^[0-9a-f]{64}$/.test(proxyPublicKey)) {
    throw new RgbServiceError('RGB proxy invoice public key is invalid')
  }
  const transportEndpoints = getQueryValues(query, 'endpoints').flatMap(value =>
    value
      .split(',')
      .map(endpoint => endpoint.trim())
      .filter(Boolean)
  )
  const amount = queryAmount || decodeRgbInvoiceAmountState(segments[2])
  if (amount !== undefined && !/^(0|[1-9][0-9]*)$/.test(amount)) {
    throw new Error('Invalid RGB invoice amount')
  }
  const assignmentNames = getAllQueryValues(query, 'assignment_name')
  if (assignmentNames.length > 1) throw new RgbServiceError('RGB invoice assignment is ambiguous')
  const assignmentName = assignmentNames[0]
  if (assignmentName !== undefined && assignmentName !== 'assetOwner') {
    throw new RgbServiceError('RGB invoice assignment is not supported')
  }
  const supportedAssignmentName = assignmentName as 'assetOwner' | undefined
  const encryptions = getAllQueryValues(query, 'enc')
  if (encryptions.length > 1) throw new RgbServiceError('RGB invoice encryption is ambiguous')
  const encryption: RgbInvoiceEncryption = encryptions[0] === undefined
    ? 'required'
    : encryptions[0] === '0'
      ? 'unsupported'
      : encryptions[0] === '1'
        ? 'optional'
        : (() => { throw new RgbServiceError('RGB invoice encryption preference is invalid') })()
  const schema = decodeInvoiceSchema(segments[1]!)

  return {
    raw,
    ...(proxyPublicKey ? { proxyPublicKey, proxyInvoiceId: rgbProxyInvoiceId(recipientId, proxyPublicKey) } : {}),
    assetId: normalizeAssetId(queryAssetId || segments[0]),
    amount,
    schema,
    ...(supportedAssignmentName ? { assignmentName: supportedAssignmentName } : {}),
    encryption,
    recipientId,
    proxyRecipientId: proxyPublicKey
      ? rgbProxyInvoiceId(recipientId, proxyPublicKey)
      : rgbInvoiceProxyRecipientId(recipientId, transportEndpoints),
    recipientType: seal.type === 'confidential' ? 'blind' : 'witness',
    seal,
    network: invoiceNetwork(recipientId),
    expirationTimestamp: expiration === undefined ? undefined : Number(expiration),
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
  proxyPublicKey?: string
}) {
  if (!/^(0|[1-9][0-9]*)$/.test(input.amount ?? '0'))
    throw new RgbServiceError('RGB invoice amount is invalid')
  if (input.amount !== undefined && BigInt(input.amount) > 0xffff_ffff_ffff_ffffn)
    throw new RgbServiceError('RGB invoice amount exceeds the maximum u64 value')
  if (!input.transportEndpoints.length)
    throw new RgbServiceError('RGB proxy endpoint is not configured')
  const recipientId = witnessRgbInvoiceRecipientId(input.network, input.scriptPubKey)
  const assetId = input.assetId ? normalizeRgbAssetId(input.assetId).replace(/^rgb:/, '') : '~'
  const query = new URLSearchParams()
  if (input.expirationTimestamp !== undefined)
    query.set('expiry', String(input.expirationTimestamp))
  query.set('endpoints', input.transportEndpoints.join(','))
  // Without an amount or schema, `assetOwner` is ambiguous between fungible
  // and non-fungible state. Leave the assignment open so standards-compliant
  // senders decode it as Assignment::Any and narrow it using the chosen asset.
  if (input.amount !== undefined) query.set('assignment_name', 'assetOwner')
  if (input.proxyPublicKey) {
    rgbProxyInvoiceId(recipientId, input.proxyPublicKey)
    query.set('pk', input.proxyPublicKey)
  }
  const assignmentState = input.amount === undefined ? '~' : encodeRgbInvoiceAmountState(input.amount)
  return `rgb:${assetId}/~/${assignmentState}/${recipientId}?${query}`
}

export function witnessRgbInvoiceRecipientId(network: RgbNetwork, scriptPubKey: string) {
  if (!/^(5120)[0-9a-f]{64}$/i.test(scriptPubKey)) {
    throw new RgbServiceError('RGB witness invoices currently require a P2TR funding script')
  }
  const pay2vout = Uint8Array.from([5, ...Buffer.from(scriptPubKey.slice(4), 'hex')])
  return `${networkPrefix(network)}:${baid64WithChecksum('wvout', pay2vout)}`
}
