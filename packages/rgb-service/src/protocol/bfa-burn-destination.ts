import { RgbServiceError } from '../errors'
import { keccak_256 } from '@noble/hashes/sha3'
import { sha256 } from '@noble/hashes/sha256'

export type BfaBurnDestinationV1 = {
  version: 1
  destinationChainId: number
  dstEid: number
  /** Hex-encoded chain-native recipient bytes, including Tron's 0x41 prefix. */
  recipient: string
}

export type UtexoBurnExportV1 = {
  format: 'utexo-burn'
  version: 1
  consignment: {
    encoding: 'base64'
    byteLength: number
    data: string
  }
  burnDestination: BfaBurnDestinationV1
}

const TYPEHASH_V1 = 'a1cba9d766975eb04c6a31c3b68dbb2381444a222c9972b6bf3ab26fcb829b00'
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** The routes documented by the UTEXO bridge; dstEid 0 is direct Arbitrum fundsOut. */
export const BFA_BURN_ROUTES = [
  { name: 'Arbitrum One', destinationChainId: 42161, dstEid: 0 },
  { name: 'Ethereum', destinationChainId: 1, dstEid: 30101 },
  { name: 'Polygon PoS', destinationChainId: 137, dstEid: 30109 },
  { name: 'Plasma', destinationChainId: 9745, dstEid: 30383 },
  { name: 'Tron', destinationChainId: 728126428, dstEid: 30420 },
] as const

function decodeTronAddress(value: string): Uint8Array {
  let n = 0n
  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char)
    if (digit < 0) throw new RgbServiceError('Tron burn recipient address is invalid')
    n = n * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  while (n > 0n) {
    bytes.unshift(Number(n & 255n))
    n >>= 8n
  }
  const leadingZeroes = value.match(/^1*/)?.[0].length || 0
  const decoded = Uint8Array.from([...Array(leadingZeroes).fill(0), ...bytes])
  if (decoded.length !== 25 || decoded[0] !== 0x41)
    throw new RgbServiceError('Tron burn recipient address is invalid')
  const body = decoded.slice(0, 21)
  const checksum = sha256(sha256(body)).slice(0, 4)
  if (!checksum.every((byte, index) => byte === decoded[index + 21]))
    throw new RgbServiceError('Tron burn recipient checksum is invalid')
  return body
}

export function createBfaBurnDestinationV1(destinationChainId: number, address: string): BfaBurnDestinationV1 {
  const route = BFA_BURN_ROUTES.find(item => item.destinationChainId === destinationChainId)
  if (!route) throw new RgbServiceError('BFA burn destination network is unsupported')
  const value = address.trim()
  const recipient = destinationChainId === 728126428
    ? (/^(?:0x)?41[0-9a-f]{40}$/i.test(value)
      ? Uint8Array.from(Buffer.from(value.replace(/^0x/i, ''), 'hex'))
      : decodeTronAddress(value))
    : Uint8Array.from(Buffer.from(value.replace(/^0x/i, ''), 'hex'))
  if (recipient.length !== (destinationChainId === 728126428 ? 21 : 20) ||
    (destinationChainId !== 728126428 && !/^(?:0x)?[0-9a-f]{40}$/i.test(value)) ||
    (destinationChainId === 728126428 ? recipient.slice(1) : recipient).every(byte => byte === 0))
    throw new RgbServiceError('BFA burn recipient address is invalid')
  return { version: 1, destinationChainId, dstEid: route.dstEid, recipient: Buffer.from(recipient).toString('hex') }
}

export function hashBfaBurnDestinationV1(record: BfaBurnDestinationV1): string {
  const route = BFA_BURN_ROUTES.find(item => item.destinationChainId === record.destinationChainId)
  if (!route || record.version !== 1 || record.dstEid !== route.dstEid)
    throw new RgbServiceError('BFA burn destination route is invalid')
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{2})?$/i.test(record.recipient))
    throw new RgbServiceError('BFA burn recipient address is invalid')
  const recipient = Uint8Array.from(Buffer.from(record.recipient, 'hex'))
  if (recipient.length !== (record.destinationChainId === 728126428 ? 21 : 20) ||
    (record.destinationChainId === 728126428 ? recipient.slice(1) : recipient).every(byte => byte === 0) ||
    (record.destinationChainId === 728126428 && recipient[0] !== 0x41))
    throw new RgbServiceError('BFA burn recipient address is invalid')
  const encoded = Buffer.alloc(128)
  Buffer.from(TYPEHASH_V1, 'hex').copy(encoded, 0)
  encoded.writeBigUInt64BE(BigInt(record.destinationChainId), 56)
  encoded.writeUInt32BE(record.dstEid, 92)
  Buffer.from(keccak_256(recipient)).copy(encoded, 96)
  return Buffer.from(keccak_256(encoded)).toString('hex')
}

/** BFA commits either a V0 EVM address or a precomputed V1 destination hash as bytes32. */
export function normalizeBfaBurnDestination(destination: string | undefined): string {
  const value = destination?.trim().replace(/^0x/i, '').toLowerCase() || ''
  if (/^[0-9a-f]{40}$/.test(value) && !/^0+$/.test(value))
    return value.padStart(64, '0')
  if (/^[0-9a-f]{64}$/.test(value) && !/^0+$/.test(value))
    return value
  throw new RgbServiceError('BFA burn requires an EVM address or a 32-byte destination hash')
}
