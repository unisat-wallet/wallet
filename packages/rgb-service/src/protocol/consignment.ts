import { RgbServiceError } from '../errors'
import { transitionBundleId, type RgbBundleInput } from './bundle'
import { serializeStrictBitcoinTransaction } from './fascia'
import { serializeMpcMerkleProof } from './mpc'
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
}): NiaOpretWitnessBundle {
  if (input.transitionId.length !== 32)
    throw new RgbServiceError('RGB transition ID must be 32 bytes')
  if (!input.inputs.length || input.inputs.length > 0xffff) {
    throw new RgbServiceError('RGB WitnessBundle requires between one and 65535 inputs')
  }
  const contractId = hex32(input.contractId, 'RGB contract ID')
  const inputs = [...input.inputs].sort((left, right) =>
    compare(serializeOpout(left), serializeOpout(right))
  )
  const bundleId = transitionBundleId(
    inputs.map(item => ({ ...item, transitionId: input.transitionId }))
  )
  const proof = serializeMpcMerkleProof(
    [{ protocolId: contractId, message: bundleId }],
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
  // OpretProof is an empty strict tuple and contributes no bytes.
  return {
    strict: concat(
      Uint8Array.from([1]),
      serializeStrictBitcoinTransaction(input.witnessTx),
      proof,
      bundle.toBytes()
    ),
    bundleId,
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
