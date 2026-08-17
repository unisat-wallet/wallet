import { sha256 } from '@noble/hashes/sha256'
import { RgbServiceError } from '../errors'
import { StrictWriter } from './strict'

const TAG_TRANSITION_BUNDLE = 'urn:lnp-bp:rgb:bundle#2024-02-03'

export interface RgbBundleInput {
  opId: string
  assignmentType: number
  assignmentIndex: number
  transitionId: Uint8Array
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
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function compare(left: Uint8Array, right: Uint8Array) {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return left.length - right.length
}

function serializeOpout(input: Omit<RgbBundleInput, 'transitionId'>) {
  return new StrictWriter()
    .writeFixedBytes(hex32(input.opId, 'RGB bundle input operation ID'), 32)
    .writeU16(input.assignmentType)
    .writeU16(input.assignmentIndex)
    .toBytes()
}

/**
 * Compute the RGB TransitionBundle ID for a single contract's input map.
 * Per RGB consensus the bundle commitment commits only to this sorted map;
 * disclosed transition bodies are intentionally excluded.
 */
export function transitionBundleId(inputs: RgbBundleInput[]) {
  if (!inputs.length) throw new RgbServiceError('RGB transition bundle requires at least one input')
  if (inputs.length > 0xffff) throw new RgbServiceError('RGB transition bundle has too many inputs')

  const sorted = [...inputs].sort((left, right) =>
    compare(serializeOpout(left), serializeOpout(right))
  )
  const writer = new StrictWriter().writeU16(sorted.length)
  for (const input of sorted) {
    if (input.transitionId.length !== 32)
      throw new RgbServiceError('RGB transition bundle ID must be 32 bytes')
    writer.writeFixedBytes(serializeOpout(input), 36).writeFixedBytes(input.transitionId, 32)
  }
  return taggedHash(TAG_TRANSITION_BUNDLE, writer.toBytes())
}
