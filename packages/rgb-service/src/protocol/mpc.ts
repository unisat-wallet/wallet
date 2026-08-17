import { sha256 } from '@noble/hashes/sha256'
import { RgbServiceError } from '../errors'

const TAG_MERKLE_NODE = 'urn:ubideco:merkle:node#2024-01-31'
const TAG_MPC_COMMITMENT = 'urn:ubideco:mpc:commitment#2024-01-31'
const MIN_TREE_DEPTH = 3
const VIRTUAL_LEAF = new Uint8Array(32).fill(0xff)

export interface MpcMessage {
  protocolId: Uint8Array
  message: Uint8Array
}

export interface MpcCommitment {
  commitment: Uint8Array
  merkleRoot: Uint8Array
  depth: number
  cofactor: number
  positions: Map<string, number>
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

function taggedHash(tag: string, value: Uint8Array) {
  const tagHash = sha256(new TextEncoder().encode(tag))
  return sha256(concat(tagHash, tagHash, value))
}

function compare(left: Uint8Array, right: Uint8Array) {
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return 0
}

function u16(value: number) {
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff])
}

function u32(value: number) {
  return Uint8Array.from([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ])
}

function u64(value: bigint) {
  const bytes = new Uint8Array(8)
  for (let index = 0n; index < 8n; index++)
    bytes[Number(index)] = Number((value >> (index * 8n)) & 0xffn)
  return bytes
}

function u256(value: number) {
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
) {
  return taggedHash(
    TAG_MERKLE_NODE,
    concat(Uint8Array.from([branching, depth]), u256(width), left, right)
  )
}

function merklize(leaves: Uint8Array[], depth = 0, width = leaves.length): Uint8Array {
  if (!leaves.length) return merkleNode(0, depth, width, VIRTUAL_LEAF, VIRTUAL_LEAF)
  if (leaves.length === 1)
    return depth === 0 ? leaves[0]! : merkleNode(1, depth, width, leaves[0]!, VIRTUAL_LEAF)
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

function key(bytes: Uint8Array) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function protocolPosition(protocolId: Uint8Array, cofactor: number, depth: number) {
  const width = 2 ** depth
  let value = 0n
  // ProtocolId is interpreted as a little-endian u256 by LNPBP-4.
  for (let index = protocolId.length - 1; index >= 0; index--)
    value = (value << 8n) | BigInt(protocolId[index]!)
  return Number(value % BigInt(Math.max(1, width - cofactor)))
}

function leaf(
  protocolId: Uint8Array | undefined,
  message: Uint8Array | undefined,
  entropy: bigint,
  position: number
) {
  return protocolId && message
    ? taggedHash(TAG_MERKLE_NODE, concat(Uint8Array.from([0x10]), protocolId, message))
    : taggedHash(TAG_MERKLE_NODE, concat(Uint8Array.from([0x11]), u64(entropy), u32(position)))
}

function buildTree(messages: readonly MpcMessage[], entropy: bigint, minDepth: number) {
  const sorted = [...messages].sort((left, right) => compare(left.protocolId, right.protocolId))
  let depth = minDepth
  let cofactor = 0
  let positions = new Map<string, number>()
  while (true) {
    const width = 2 ** depth
    let matched = false
    for (let candidate = 0; candidate <= Math.min(width, 500); candidate++) {
      const next = new Map<string, number>()
      if (
        sorted.every(item => {
          const position = protocolPosition(item.protocolId, candidate, depth)
          if ([...next.values()].includes(position)) return false
          next.set(key(item.protocolId), position)
          return true
        })
      ) {
        positions = next
        cofactor = candidate
        matched = true
        break
      }
    }
    if (matched) return { sorted, depth, cofactor, positions }
    depth++
    if (depth > 16) throw new RgbServiceError('MPC messages cannot fit into a commitment tree')
  }
}

function mpcLeaves(messages: readonly MpcMessage[], entropy: bigint, minDepth: number) {
  const layout = buildTree(messages, entropy, minDepth)
  const width = 2 ** layout.depth
  const byPosition = new Map(
    [...layout.positions.entries()].map(([id, position]) => [
      position,
      layout.sorted.find(item => key(item.protocolId) === id)!,
    ])
  )
  return {
    ...layout,
    leaves: Array.from({ length: width }, (_, position) => {
      const item = byPosition.get(position)
      return leaf(item?.protocolId, item?.message, entropy, position)
    }),
  }
}

/** Build the deterministic LNPBP-4 commitment used by RGB OPRET anchors. */
export function commitMpc(
  messages: readonly MpcMessage[],
  entropy: bigint,
  minDepth = MIN_TREE_DEPTH
): MpcCommitment {
  if (!messages.length) throw new RgbServiceError('MPC commitment requires at least one message')
  if (!Number.isInteger(minDepth) || minDepth < 0 || minDepth > 16)
    throw new RgbServiceError('MPC tree depth is invalid')
  if (entropy < 0n || entropy > 0xffff_ffff_ffff_ffffn)
    throw new RgbServiceError('MPC entropy is invalid')
  messages.forEach(({ protocolId, message }) => {
    if (protocolId.length !== 32 || message.length !== 32)
      throw new RgbServiceError('MPC protocol IDs and messages must be 32 bytes')
  })

  const { depth, cofactor, positions, leaves } = mpcLeaves(messages, entropy, minDepth)
  const merkleRoot = merklize(leaves)
  return {
    commitment: taggedHash(
      TAG_MPC_COMMITMENT,
      concat(Uint8Array.from([depth]), u16(cofactor), merkleRoot)
    ),
    merkleRoot,
    depth,
    cofactor,
    positions,
  }
}

/** Strict-serialize the LNPBP-4 MerkleProof carried by a WitnessBundle anchor. */
export function serializeMpcMerkleProof(
  messages: readonly MpcMessage[],
  entropy: bigint,
  protocolId: Uint8Array,
  minDepth = MIN_TREE_DEPTH
) {
  if (protocolId.length !== 32) throw new RgbServiceError('MPC protocol ID must be 32 bytes')
  const { depth, cofactor, positions, leaves } = mpcLeaves(messages, entropy, minDepth)
  const position = positions.get(key(protocolId))
  if (position === undefined) throw new RgbServiceError('MPC proof protocol ID is not committed')

  const path: Uint8Array[] = []
  let nodes = leaves
  let nodePosition = position
  let treeDepth = depth - 1
  while (nodes.length > 1) {
    path.push(nodes[nodePosition ^ 1]!)
    nodes = Array.from({ length: nodes.length / 2 }, (_, index) =>
      merkleNode(2, treeDepth, leaves.length, nodes[index * 2]!, nodes[index * 2 + 1]!)
    )
    nodePosition = Math.floor(nodePosition / 2)
    treeDepth--
  }

  // Strict MerkleProof stores hashing partners from the root side to the leaf.
  path.reverse()
  return concat(u32(position), u16(cofactor), Uint8Array.from([path.length]), ...path)
}

/** Rebuild and verify the LNPBP-4 commitment disclosed by a strict MerkleProof. */
export function verifyMpcMerkleProof(input: {
  protocolId: Uint8Array
  message: Uint8Array
  proof: Uint8Array
}) {
  if (input.protocolId.length !== 32 || input.message.length !== 32 || input.proof.length < 7) {
    throw new RgbServiceError('RGB MPC proof is invalid')
  }
  const position =
    input.proof[0]! | (input.proof[1]! << 8) | (input.proof[2]! << 16) | (input.proof[3]! << 24)
  const cofactor = input.proof[4]! | (input.proof[5]! << 8)
  const depth = input.proof[6]!
  if (depth < MIN_TREE_DEPTH || input.proof.length !== 7 + depth * 32)
    throw new RgbServiceError('RGB MPC proof path is invalid')
  const width = 2 ** depth
  if (position >= width || protocolPosition(input.protocolId, cofactor, depth) !== position) {
    throw new RgbServiceError('RGB MPC proof position is invalid')
  }
  let node = leaf(input.protocolId, input.message, 0n, position)
  for (let level = 0; level < depth; level++) {
    const siblingOffset = 7 + (depth - 1 - level) * 32
    const sibling = input.proof.slice(siblingOffset, siblingOffset + 32)
    node =
      (position >>> level) & 1
        ? merkleNode(2, depth - 1 - level, width, sibling, node)
        : merkleNode(2, depth - 1 - level, width, node, sibling)
  }
  return taggedHash(TAG_MPC_COMMITMENT, concat(Uint8Array.from([depth]), u16(cofactor), node))
}

/** Strict-serialize the revealed MPC MerkleBlock carried by a RGB Fascia. */
export function serializeMpcMerkleBlock(
  messages: readonly MpcMessage[],
  entropy: bigint,
  minDepth = MIN_TREE_DEPTH
) {
  const { sorted, depth, cofactor, positions } = buildTree(messages, entropy, minDepth)
  const width = 2 ** depth
  const byPosition = new Map(
    [...positions.entries()].map(([id, position]) => [
      position,
      sorted.find(item => key(item.protocolId) === id)!,
    ])
  )
  const parts: Uint8Array[] = [Uint8Array.from([depth]), u16(cofactor), u32(width)]
  for (let position = 0; position < width; position++) {
    const item = byPosition.get(position)
    parts.push(
      item
        ? concat(Uint8Array.from([1]), item.protocolId, item.message)
        : concat(Uint8Array.from([0, depth]), leaf(undefined, undefined, entropy, position))
    )
  }
  parts.push(Uint8Array.from([1]), u64(entropy))
  return concat(...parts)
}
