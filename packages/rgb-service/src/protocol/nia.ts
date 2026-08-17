import { sha256 } from '@noble/hashes/sha256'
import { RgbServiceError } from '../errors'
import type { RgbAllocation } from '../types'
import { StrictWriter } from './strict'

const RGB_NIA_ASSET_OWNER = 4000
const RGB_NIA_TRANSFER = 10000
const TAG_MERKLE_NODE = 'urn:ubideco:merkle:node#2024-01-31'
const TAG_STRICT_HASH = 'urn:ubideco:strict-types:value-hash#2024-02-10'
const TAG_SECRET_SEAL = 'urn:lnp-bp:seals:secret#2024-02-03'
const TAG_OPERATION = 'urn:lnp-bp:rgb:operation#2024-02-03'
const VIRTUAL_LEAF = new Uint8Array(32).fill(0xff)

export interface NiaOutpoint {
  opId: string
  assignmentIndex: number
}

/** Convert indexed RGB ancestry into the input required by a NIA transition. */
export function niaInputFromAllocation(allocation: RgbAllocation): NiaOutpoint {
  if (!allocation.opId || allocation.assignmentIndex === undefined) {
    throw new RgbServiceError('RGB allocation is missing its parent operation output')
  }
  if (
    allocation.assignmentType !== undefined &&
    allocation.assignmentType !== RGB_NIA_ASSET_OWNER
  ) {
    throw new RgbServiceError('RGB allocation is not a NIA asset-owner assignment')
  }
  return { opId: allocation.opId, assignmentIndex: allocation.assignmentIndex }
}

export interface NiaRevealedSeal {
  /** Null represents an output in the witness transaction being constructed. */
  txid: string | null
  vout: number
  blinding: bigint
}

export interface NiaConfidentialSeal {
  secretSeal: string
}

export interface NiaFungibleAssignment {
  amount: bigint
  seal: NiaRevealedSeal | NiaConfidentialSeal
}

export interface NiaTransition {
  contractId: string
  nonce: bigint
  inputs: NiaOutpoint[]
  assignments: NiaFungibleAssignment[]
}

export interface EncodedNiaTransition {
  strict: Uint8Array
  opCommitment: Uint8Array
  opId: Uint8Array
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function hexBytes(value: string, name: string): Uint8Array {
  const normalized = value.replace(/^rgb:/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new RgbServiceError(`${name} must be a 32-byte hexadecimal value`)
  }
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const leftByte = left[index]
    const rightByte = right[index]
    if (leftByte === undefined || rightByte === undefined) break
    if (leftByte !== rightByte) return leftByte - rightByte
  }
  return left.length - right.length
}

function taggedHash(tag: string, value: Uint8Array): Uint8Array {
  const tagHash = sha256(new TextEncoder().encode(tag))
  return sha256(concat(tagHash, tagHash, value))
}

function encodeU256(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RgbServiceError('Merkle tree width is invalid')
  }
  const bytes = new Uint8Array(32)
  let remaining = BigInt(value)
  for (let index = 0; index < bytes.length; index++) {
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
): Uint8Array {
  return taggedHash(
    TAG_MERKLE_NODE,
    concat(Uint8Array.from([branching, depth]), encodeU256(width), left, right)
  )
}

/** LNPBP-81 merklization used by RGB operation commitments. */
function merklize(leaves: Uint8Array[], depth = 0, baseWidth = leaves.length): Uint8Array {
  if (leaves.length === 0) return merkleNode(0, depth, baseWidth, VIRTUAL_LEAF, VIRTUAL_LEAF)
  if (leaves.length === 1) {
    const [leaf] = leaves
    if (!leaf) throw new RgbServiceError('Merkle tree leaf is missing')
    return depth === 0 ? leaf : merkleNode(1, depth, baseWidth, leaf, VIRTUAL_LEAF)
  }
  if (leaves.length === 2) {
    const [left, right] = leaves
    if (!left || !right) throw new RgbServiceError('Merkle tree leaf is missing')
    return merkleNode(2, depth, baseWidth, left, right)
  }

  const split = Math.ceil(leaves.length / 2)
  return merkleNode(
    2,
    depth,
    baseWidth,
    merklize(leaves.slice(0, split), depth + 1, baseWidth),
    merklize(leaves.slice(split), depth + 1, baseWidth)
  )
}

function serializeSeal(seal: NiaRevealedSeal): Uint8Array {
  const writer = new StrictWriter()
  if (seal.txid === null) {
    writer.writeU8(0)
  } else {
    writer.writeU8(1).writeFixedBytes(hexBytes(seal.txid, 'RGB seal transaction ID').reverse(), 32)
  }
  return writer.writeU32(seal.vout).writeU64(seal.blinding).toBytes()
}

function secretSeal(seal: NiaFungibleAssignment['seal']): Uint8Array {
  return 'secretSeal' in seal
    ? hexBytes(seal.secretSeal, 'RGB secret seal')
    : taggedHash(TAG_SECRET_SEAL, serializeSeal(seal))
}

function serializeFungibleState(amount: bigint): Uint8Array {
  return new StrictWriter().writeU8(8).writeU64(amount).toBytes()
}

function serializeAssignment(assignment: NiaFungibleAssignment): Uint8Array {
  const state = serializeFungibleState(assignment.amount)
  if ('secretSeal' in assignment.seal) {
    return concat(Uint8Array.from([1]), secretSeal(assignment.seal), state)
  }
  return concat(Uint8Array.from([0]), serializeSeal(assignment.seal), state)
}

function serializeOpout(input: NiaOutpoint): Uint8Array {
  return new StrictWriter()
    .writeFixedBytes(hexBytes(input.opId, 'RGB input operation ID'), 32)
    .writeU16(RGB_NIA_ASSET_OWNER)
    .writeU16(input.assignmentIndex)
    .toBytes()
}

function assignmentCommitment(assignment: NiaFungibleAssignment): Uint8Array {
  // AssignmentCommitment commits the assignment type, the underlying
  // RevealedValue (not the RevealedState enum tag), and its concealed seal.
  return taggedHash(
    TAG_MERKLE_NODE,
    concat(
      new StrictWriter().writeU16(RGB_NIA_ASSET_OWNER).toBytes(),
      serializeFungibleState(assignment.amount),
      secretSeal(assignment.seal)
    )
  )
}

function serializeOpCommitment(
  input: NiaTransition,
  inputsRoot: Uint8Array,
  assignmentsRoot: Uint8Array
): Uint8Array {
  const metadataHash = taggedHash(TAG_STRICT_HASH, Uint8Array.from([0]))
  const globalsRoot = merklize([])
  return new StrictWriter()
    .writeU16(0)
    .writeU64(input.nonce)
    .writeU8(1)
    .writeFixedBytes(hexBytes(input.contractId, 'RGB contract ID'), 32)
    .writeU16(RGB_NIA_TRANSFER)
    .writeFixedBytes(metadataHash, 32)
    .writeFixedBytes(globalsRoot, 32)
    .writeFixedBytes(inputsRoot, 32)
    .writeFixedBytes(assignmentsRoot, 32)
    .toBytes()
}

/**
 * Strict-serialize and commit a NIA fungible transfer. This covers the RGB
 * Transition and OpId layers; anchor/Fascia construction remains separate.
 */
export function encodeNiaTransition(input: NiaTransition): EncodedNiaTransition {
  if (!input.inputs.length) throw new RgbServiceError('An RGB NIA transition requires an input')
  if (!input.assignments.length)
    throw new RgbServiceError('An RGB NIA transition requires an assignment')

  const inputs = [...input.inputs].sort((left, right) =>
    compareBytes(serializeOpout(left), serializeOpout(right))
  )
  const assignments = [...input.assignments].sort((left, right) =>
    compareBytes(secretSeal(left.seal), secretSeal(right.seal))
  )

  const writer = new StrictWriter()
  writer
    .writeU16(0)
    .writeFixedBytes(hexBytes(input.contractId, 'RGB contract ID'), 32)
    .writeU64(input.nonce)
    .writeU16(RGB_NIA_TRANSFER)
    .writeU8(0)
    .writeU8(0)
    .writeU16(inputs.length)
  inputs.forEach(item => writer.writeFixedBytes(serializeOpout(item), 36))

  writer.writeU16(1).writeU16(RGB_NIA_ASSET_OWNER).writeU8(1).writeU16(assignments.length)
  assignments.forEach(item => {
    const encoded = serializeAssignment(item)
    writer.writeFixedBytes(encoded, encoded.length)
  })
  writer.writeU8(0)

  const inputRoot = merklize(inputs.map(item => taggedHash(TAG_MERKLE_NODE, serializeOpout(item))))
  const assignmentsRoot = merklize(assignments.map(assignmentCommitment))
  const opCommitment = serializeOpCommitment(input, inputRoot, assignmentsRoot)
  return { strict: writer.toBytes(), opCommitment, opId: taggedHash(TAG_OPERATION, opCommitment) }
}
