import { sha256 } from '@noble/hashes/sha256'
import { RgbServiceError } from '../errors'
import type { RgbNetwork } from '../types'
import { StrictWriter } from './strict'

const NIA_SCHEMA_ID = '45687051f4cca6e3f665fc75fe3e27b30080346789ad83aa0dc29e95a315e335'
const ASSET_OWNER = 4000
const GLOBAL_SPEC = 2000
const GLOBAL_TERMS = 2001
const GLOBAL_ISSUED_SUPPLY = 2010
const TAG_MERKLE_NODE = 'urn:ubideco:merkle:node#2024-01-31'
const TAG_STRICT_HASH = 'urn:ubideco:strict-types:value-hash#2024-02-10'
const TAG_SECRET_SEAL = 'urn:lnp-bp:seals:secret#2024-02-03'
const TAG_OPERATION = 'urn:lnp-bp:rgb:operation#2024-02-03'
const VIRTUAL_LEAF = new Uint8Array(32).fill(0xff)

export interface NiaGenesisAllocation {
  txid: string
  vout: number
  blinding: bigint
  amount: bigint
}

export interface NiaGenesis {
  ticker: string
  name: string
  precision: number
  timestamp: number
  network: RgbNetwork
  allocations: NiaGenesisAllocation[]
}

export interface EncodedNiaGenesis {
  strict: Uint8Array
  opCommitment: Uint8Array
  assetId: Uint8Array
  /** Original input indexes in the strict assignment order. */
  allocationIndexes: number[]
}

export type NiaAssetSpecIssue = 'invalid_ticker' | 'invalid_name' | 'invalid_precision'

/** RGB NIA metadata constraints defined by rgb-std's AssetSpec. */
export function getNiaAssetSpecIssue(input: {
  ticker?: string
  name?: string
  precision?: number
}): NiaAssetSpecIssue | undefined {
  if (!/^[A-Za-z][A-Za-z0-9]{0,7}$/.test(input.ticker || '')) return 'invalid_ticker'
  if (!input.name || input.name.length > 40 || [...input.name].some(character => {
    const code = character.codePointAt(0)!
    return code < 0x20 || code > 0x7e
  })) return 'invalid_name'
  if (!Number.isInteger(input.precision) || input.precision! < 0 || input.precision! > 18)
    return 'invalid_precision'
  return undefined
}

export function isStandardNiaAssetSpec(input: {
  ticker?: string
  name?: string
  precision?: number
}) {
  return getNiaAssetSpecIssue(input) === undefined
}

function assertStandardNiaAssetSpec(input: NiaGenesis) {
  const issue = getNiaAssetSpecIssue(input)
  if (issue === 'invalid_ticker')
    throw new RgbServiceError('NIA ticker must start with an ASCII letter and contain only ASCII letters or digits (1-8 characters)')
  if (issue === 'invalid_name')
    throw new RgbServiceError('NIA name must contain 1-40 printable ASCII characters')
  if (issue === 'invalid_precision')
    throw new RgbServiceError('NIA precision must be between 0 and 18')
}

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function bytes32(value: string, name: string) {
  if (!/^[0-9a-fA-F]{64}$/.test(value))
    throw new RgbServiceError(`${name} must be 32-byte hexadecimal`)
  const bytes = new Uint8Array(32)
  for (let index = 0; index < 32; index++)
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

/** Bitcoin Txid strings are display-order; RGB strict encoding uses Txid bytes. */
function txidBytes(value: string, name: string) {
  return Uint8Array.from(bytes32(value, name)).reverse()
}

function utf8(value: string, maxLength: number, name: string) {
  const bytes = new TextEncoder().encode(value)
  if (!bytes.length || bytes.length > maxLength)
    throw new RgbServiceError(`${name} has an invalid length`)
  return bytes
}

function compare(left: Uint8Array, right: Uint8Array) {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return left.length - right.length
}

function taggedHash(tag: string, value: Uint8Array) {
  const tagHash = sha256(new TextEncoder().encode(tag))
  return sha256(concat(tagHash, tagHash, value))
}

function u256(value: number) {
  const bytes = new Uint8Array(32)
  let remaining = BigInt(value)
  for (let index = 0; index < 32; index++) {
    bytes[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return bytes
}

function merkleNode(
  branching: 0 | 1 | 2,
  depth: number,
  width: number,
  left: Uint8Array,
  right: Uint8Array
) {
  return taggedHash(
    TAG_MERKLE_NODE,
    concat(Uint8Array.from([branching, depth]), u256(width), left, right)
  )
}

function merklize(leaves: Uint8Array[], depth = 0, width = leaves.length): Uint8Array {
  if (!leaves.length) return merkleNode(0, depth, width, VIRTUAL_LEAF, VIRTUAL_LEAF)
  if (leaves.length === 1) {
    return depth === 0 ? leaves[0]! : merkleNode(1, depth, width, leaves[0]!, VIRTUAL_LEAF)
  }
  if (leaves.length === 2) return merkleNode(2, depth, width, leaves[0]!, leaves[1]!)
  const split = Math.ceil(leaves.length / 2)
  return merkleNode(
    2,
    depth,
    width,
    merklize(leaves.slice(0, split), depth + 1, width),
    merklize(leaves.slice(split), depth + 1, width)
  )
}

function chainNet(network: RgbNetwork) {
  switch (network) {
    case 'mainnet':
    case 'fractal-mainnet':
    case 'fractal-test':
      return 0
    case 'testnet':
      return 1
    case 'testnet4':
      return 2
    case 'signet':
      return 3
  }
}

function serializeGenesisSeal(allocation: NiaGenesisAllocation) {
  return new StrictWriter()
    .writeFixedBytes(txidBytes(allocation.txid, 'NIA allocation transaction ID'), 32)
    .writeU32(allocation.vout)
    .writeU64(allocation.blinding)
    .toBytes()
}

function secretSeal(allocation: NiaGenesisAllocation) {
  return taggedHash(TAG_SECRET_SEAL, serializeGenesisSeal(allocation))
}

function serializeAssetSpec(input: NiaGenesis) {
  assertStandardNiaAssetSpec(input)
  const ticker = utf8(input.ticker, 8, 'NIA ticker')
  const name = utf8(input.name, 40, 'NIA name')
  return new StrictWriter()
    .writeConfinedBytes(ticker, 8)
    .writeConfinedBytes(name, 40)
    .writeU8(0)
    .writeU8(input.precision)
    .toBytes()
}

function serializeTerms() {
  // ContractTerms with the empty Ricardian contract and no media attachment.
  return new StrictWriter().writeConfinedString('', 65535).writeU8(0).toBytes()
}

function serializeGlobal(globalType: number, rawState: Uint8Array) {
  return new StrictWriter()
    .writeU16(globalType)
    .writeU16(1)
    .writeConfinedBytes(rawState, 65535)
    .toBytes()
}

function globalCommitment(globalType: number, rawState: Uint8Array) {
  return taggedHash(
    TAG_MERKLE_NODE,
    new StrictWriter().writeU16(globalType).writeConfinedBytes(rawState, 65535).toBytes()
  )
}

function serializeAssignment(allocation: NiaGenesisAllocation) {
  return concat(
    Uint8Array.from([0]),
    serializeGenesisSeal(allocation),
    new StrictWriter().writeU8(8).writeU64(allocation.amount).toBytes()
  )
}

function assignmentCommitment(allocation: NiaGenesisAllocation) {
  return taggedHash(
    TAG_MERKLE_NODE,
    new StrictWriter()
      .writeU16(ASSET_OWNER)
      .writeU8(8)
      .writeU64(allocation.amount)
      .writeFixedBytes(secretSeal(allocation), 32)
      .toBytes()
  )
}

/** Strict-serialize a standard no-media NIA Genesis and derive its asset ID. */
export function encodeNiaGenesis(input: NiaGenesis): EncodedNiaGenesis {
  if (!Number.isSafeInteger(input.timestamp)) throw new RgbServiceError('NIA timestamp is invalid')
  if (!input.allocations.length) throw new RgbServiceError('NIA issuance requires an allocation')
  const supply = input.allocations.reduce((sum, allocation) => sum + allocation.amount, 0n)
  if (supply <= 0n) throw new RgbServiceError('NIA issued supply must be positive')

  const spec = serializeAssetSpec(input)
  const terms = serializeTerms()
  const issuedSupply = new StrictWriter().writeU64(supply).toBytes()
  const globals = [
    [GLOBAL_SPEC, spec],
    [GLOBAL_TERMS, terms],
    [GLOBAL_ISSUED_SUPPLY, issuedSupply],
  ] as const
  const allocations = input.allocations
    .map((allocation, index) => ({ allocation, index }))
    .sort((left, right) => compare(secretSeal(left.allocation), secretSeal(right.allocation)))

  const writer = new StrictWriter()
  writer
    .writeU16(0)
    .writeFixedBytes(bytes32(NIA_SCHEMA_ID, 'NIA schema ID'), 32)
    .writeU64(BigInt(input.timestamp))
    .writeConfinedString('ssi:anonymous', 4096)
    .writeU8(chainNet(input.network))
    .writeU8(0)
    .writeU8(0)
    .writeU8(globals.length)
  globals.forEach(([type, state]) => {
    const encoded = serializeGlobal(type, state)
    writer.writeFixedBytes(encoded, encoded.length)
  })
  writer.writeU16(1).writeU16(ASSET_OWNER).writeU8(1).writeU16(allocations.length)
  allocations.forEach(({ allocation }) => {
    const encoded = serializeAssignment(allocation)
    writer.writeFixedBytes(encoded, encoded.length)
  })

  const issuerHash = taggedHash(
    TAG_STRICT_HASH,
    new StrictWriter().writeConfinedString('ssi:anonymous', 4096).toBytes()
  )
  const globalsRoot = merklize(globals.map(([type, state]) => globalCommitment(type, state)))
  const assignmentRoot = merklize(
    allocations.map(({ allocation }) => assignmentCommitment(allocation))
  )
  const commitment = new StrictWriter()
    .writeU16(0)
    .writeU64(0xffff_ffff_ffff_ffffn)
    .writeU8(0)
    .writeFixedBytes(bytes32(NIA_SCHEMA_ID, 'NIA schema ID'), 32)
    .writeU64(BigInt(input.timestamp))
    .writeFixedBytes(issuerHash, 32)
    .writeU8(chainNet(input.network))
    .writeU8(0)
    .writeFixedBytes(taggedHash(TAG_STRICT_HASH, Uint8Array.from([0])), 32)
    .writeFixedBytes(globalsRoot, 32)
    .writeFixedBytes(merklize([]), 32)
    .writeFixedBytes(assignmentRoot, 32)
    .toBytes()
  return {
    strict: writer.toBytes(),
    opCommitment: commitment,
    assetId: taggedHash(TAG_OPERATION, commitment),
    allocationIndexes: allocations.map(({ index }) => index),
  }
}
