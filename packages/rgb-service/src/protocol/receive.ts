import { sha256 } from '@noble/hashes/sha256'
import { RgbServiceError } from '../errors'
import type { RgbNetwork } from '../types'
import { normalizeRgbAssetId } from './contract-id'

const BAID64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_~'
const TAG_SECRET_SEAL = 'urn:lnp-bp:seals:secret#2024-02-03'

export interface RgbBlindSeal {
  txid: string
  vout: number
  blinding: bigint
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function taggedHash(tag: string, value: Uint8Array) {
  const tagHash = sha256(new TextEncoder().encode(tag))
  return sha256(concat(tagHash, tagHash, value))
}

function hex32(value: string, name: string) {
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new RgbServiceError(`${name} must be a 32-byte hexadecimal value`)
  return Uint8Array.from(Buffer.from(value, 'hex'))
}

function u32(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new RgbServiceError('RGB seal vout is invalid')
  return Uint8Array.from([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ])
}

function u64(value: bigint) {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn)
    throw new RgbServiceError('RGB seal blinding is invalid')
  const bytes = new Uint8Array(8)
  for (let index = 0n; index < 8n; index++)
    bytes[Number(index)] = Number((value >> (index * 8n)) & 0xffn)
  return bytes
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
  const key = sha256(new TextEncoder().encode(hri))
  const digest = sha256(concat(key, payload))
  const encoded = baid64Encode(
    concat(payload, Uint8Array.from([digest[0]!, digest[1]!, digest[1]!, digest[2]!]))
  )
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

export function concealBlindSeal(seal: RgbBlindSeal) {
  // TxPtr::Txid is strict tag 1, followed by txid, vout and blinding.
  return taggedHash(
    TAG_SECRET_SEAL,
    concat(
      Uint8Array.from([1]),
      // Bitcoin txid strings are display-order; strict Txid bytes are little-endian.
      Uint8Array.from(hex32(seal.txid, 'RGB seal txid')).reverse(),
      u32(seal.vout),
      u64(seal.blinding)
    )
  )
}

export function blindRgbInvoiceRecipientId(network: RgbNetwork, seal: RgbBlindSeal) {
  return `${networkPrefix(network)}:${baid64WithChecksum('utxob', concealBlindSeal(seal))}`
}

export function encodeBlindRgbInvoice(input: {
  network: RgbNetwork
  seal: RgbBlindSeal
  assetId?: string
  amount?: string
  expirationTimestamp?: number
  transportEndpoints?: string[]
}) {
  if (input.amount !== undefined && !/^(0|[1-9][0-9]*)$/.test(input.amount))
    throw new RgbServiceError('RGB invoice amount is invalid')
  if (input.amount !== undefined && BigInt(input.amount) > 0xffff_ffff_ffff_ffffn)
    throw new RgbServiceError('RGB invoice amount exceeds the maximum u64 value')
  const recipientId = blindRgbInvoiceRecipientId(input.network, input.seal)
  const assetId = input.assetId ? normalizeRgbAssetId(input.assetId).replace(/^rgb:/, '') : '~'
  const query = new URLSearchParams()
  if (input.amount !== undefined) query.set('amount', input.amount)
  if (input.expirationTimestamp !== undefined)
    query.set('expirationTimestamp', String(input.expirationTimestamp))
  if (input.transportEndpoints?.length)
    query.set('endpoints', input.transportEndpoints.join(','))
  // Expo's URLSearchParams polyfill supports serialization but has no size property.
  const queryString = query.toString()
  return `rgb:${assetId}/~/${input.amount === undefined ? '~' : '~'}/${recipientId}${queryString ? `?${queryString}` : ''}`
}
