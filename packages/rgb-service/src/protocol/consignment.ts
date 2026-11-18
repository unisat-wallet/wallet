import { RgbServiceError } from '../errors'
import { transitionBundleId, type RgbBundleInput } from './bundle'
import { serializeStrictBitcoinTransaction } from './fascia'
import { serializeMpcMerkleProof, type MpcMessage } from './mpc'
import { rgbContractIdBytes } from './contract-id'
import { StrictWriter } from './strict'

function hex32(value: string, name: string) {
  const normalized = value.replace(/^rgb:/, '')
  if (!/^[0-9a-f]{64}$/i.test(normalized))
    throw new RgbServiceError(`${name} must be a 32-byte hexadecimal value`)
  return Uint8Array.from(Buffer.from(normalized, 'hex'))
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

const RGB_CONSIGNMENT_MAGIC = Uint8Array.from([0x52, 0x47, 0x42, 0x00])
const RGB_TRANSFER_CONSIGNMENT_HEADER = Uint8Array.from([
  ...RGB_CONSIGNMENT_MAGIC,
  0x54,
  0x46,
  0x52,
])

function hasPrefix(value: Uint8Array, prefix: Uint8Array) {
  return value.length >= prefix.length && prefix.every((byte, index) => value[index] === byte)
}

/** Add the standard RGB Transfer consignment envelope around its strict body. */
export function wrapRgbTransferConsignment(value: Uint8Array) {
  return concat(RGB_TRANSFER_CONSIGNMENT_HEADER, value)
}

/** Accept both standard RGB Transfer consignments and legacy unwrapped bodies. */
export function unwrapRgbTransferConsignment(value: Uint8Array) {
  if (!hasPrefix(value, RGB_CONSIGNMENT_MAGIC)) return value
  if (!hasPrefix(value, RGB_TRANSFER_CONSIGNMENT_HEADER)) {
    throw new RgbServiceError('RGB Consignment type is unsupported')
  }
  return value.slice(RGB_TRANSFER_CONSIGNMENT_HEADER.length)
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

export interface NiaOpretWitnessBundle {
  strict: Uint8Array
  bundleId: Uint8Array
}

// Anchor<MerkleProof, OpretProof> encodes the Opret proof variant as a tag.
const OPRET_PROOF_TAG = 2

/**
 * Strict-serialize a single-contract OpretFirst WitnessBundle. The anchor
 * proof is derived locally from the same MPC message committed into the PSBT.
 */
export function serializeNiaOpretWitnessBundle(input: {
  witnessTx: Uint8Array
  contractId: string
  transitionId: Uint8Array
  transition: Uint8Array
  inputs: Omit<RgbBundleInput, 'transitionId'>[]
  entropy: bigint
  /** All contract messages sharing the witness commitment. */
  mpcMessages?: MpcMessage[]
}): NiaOpretWitnessBundle {
  if (input.transitionId.length !== 32)
    throw new RgbServiceError('RGB transition ID must be 32 bytes')
  if (!input.inputs.length || input.inputs.length > 0xffff) {
    throw new RgbServiceError('RGB WitnessBundle requires between one and 65535 inputs')
  }
  const contractId = rgbContractIdBytes(input.contractId)
  const inputs = [...input.inputs].sort((left, right) =>
    compare(serializeOpout(left), serializeOpout(right))
  )
  const bundleId = transitionBundleId(
    inputs.map(item => ({ ...item, transitionId: input.transitionId }))
  )
  const messages = input.mpcMessages || [{ protocolId: contractId, message: bundleId }]
  const proof = serializeMpcMerkleProof(
    messages,
    input.entropy,
    contractId
  )

  const bundle = new StrictWriter().writeU16(inputs.length)
  for (const item of inputs) {
    bundle.writeFixedBytes(serializeOpout(item), 36).writeFixedBytes(input.transitionId, 32)
  }
  bundle
    .writeU16(1)
    .writeFixedBytes(input.transitionId, 32)
    .writeFixedBytes(input.transition, input.transition.length)

  // PubWitness::Tx tag, Anchor<MerkleProof, OpretProof>, TransitionBundle.
  // OpretProof carries its variant tag even though its payload is empty.
  return {
    strict: concat(
      Uint8Array.from([1]),
      serializeStrictBitcoinTransaction(input.witnessTx),
      proof,
      Uint8Array.from([OPRET_PROOF_TAG]),
      bundle.toBytes()
    ),
    bundleId,
  }
}

/**
 * RGB 0.11.2 V1 carries the complete transaction directly and an optional SPV
 * proof before the anchor. The transition, MPC proof and Opret proof remain
 * locally constructed exactly as in the legacy witness bundle.
 */
export function serializeBfaOpretWitnessBundle(
  input: Parameters<typeof serializeNiaOpretWitnessBundle>[0]
): NiaOpretWitnessBundle {
  const legacy = serializeNiaOpretWitnessBundle(input)
  const transaction = serializeStrictBitcoinTransaction(input.witnessTx)
  if (legacy.strict[0] !== 1) {
    throw new RgbServiceError('RGB witness bundle has an unsupported transaction variant')
  }
  return {
    strict: concat(
      transaction,
      // Option<SpvProof>::None. A validator can resolve chain state later.
      Uint8Array.from([0]),
      legacy.strict.slice(1 + transaction.length)
    ),
    bundleId: legacy.bundleId,
  }
}

export interface RgbTransferTerminal {
  bundleId: Uint8Array
  secretSeals: Uint8Array[]
}

/** Strict-serialize the transfer-only prefix shared by RGB Consignments. */
export function serializeRgbTransferPrefix(terminals: RgbTransferTerminal[]) {
  if (terminals.length > 0xffff)
    throw new RgbServiceError('RGB transfer has too many terminal bundles')
  const encoded = terminals
    .map(terminal => {
      if (
        terminal.bundleId.length !== 32 ||
        !terminal.secretSeals.length ||
        terminal.secretSeals.length > 0xffff
      ) {
        throw new RgbServiceError('RGB transfer terminal is invalid')
      }
      const seals = [...terminal.secretSeals]
      if (seals.some(seal => seal.length !== 32))
        throw new RgbServiceError('RGB terminal secret seal must be 32 bytes')
      seals.sort(compare)
      return { bundleId: terminal.bundleId, seals }
    })
    .sort((left, right) => compare(left.bundleId, right.bundleId))

  const writer = new StrictWriter().writeU8(0).writeU8(1).writeU16(encoded.length)
  for (const terminal of encoded) {
    writer.writeFixedBytes(terminal.bundleId, 32).writeU16(terminal.seals.length)
    terminal.seals.forEach(seal => writer.writeFixedBytes(seal, 32))
  }
  return writer.toBytes()
}
