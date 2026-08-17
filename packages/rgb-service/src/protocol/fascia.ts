import { Transaction } from 'bitcoinjs-lib'
import { RgbServiceError } from '../errors'
import { serializeMpcMerkleBlock, type MpcMessage } from './mpc'
import { StrictWriter } from './strict'

export interface FasciaInput {
  opId: Uint8Array
  assignmentType: number
  assignmentIndex: number
}

export interface OpretFascia {
  witnessTx: Uint8Array
  contractId: Uint8Array
  transitionId: Uint8Array
  transition: Uint8Array
  inputs: FasciaInput[]
  mpcMessages: MpcMessage[]
  entropy: bigint
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

function u16(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff)
    throw new RgbServiceError('Fascia u16 value is invalid')
  return Uint8Array.from([value & 0xff, value >>> 8])
}

function u24(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff)
    throw new RgbServiceError('Fascia u24 value is invalid')
  return Uint8Array.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff])
}

function strictI32(value: number) {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new RgbServiceError('Strict Bitcoin transaction version is invalid')
  }
  return Uint8Array.from([
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ])
}

/**
 * RGB stores PubWitness::Tx using strict encoding, not Bitcoin wire encoding.
 * Its transaction/input/output/witness collections use fixed u32 lengths.
 */
export function serializeStrictBitcoinTransaction(wireTransaction: Uint8Array) {
  let transaction: Transaction
  try {
    transaction = Transaction.fromBuffer(Buffer.from(wireTransaction))
  } catch {
    throw new RgbServiceError('Fascia witness transaction is not valid Bitcoin serialization')
  }

  const writer = new StrictWriter().writeFixedBytes(strictI32(transaction.version), 4)
  writer.writeConfinedCollection(transaction.ins, 0xffff_ffff, input => {
    writer
      .writeFixedBytes(input.hash, 32)
      .writeU32(input.index)
      .writeConfinedBytes(input.script, 0xffff_ffff)
      .writeU32(input.sequence)
      .writeConfinedCollection(input.witness, 0xffff_ffff, item => {
        writer.writeConfinedBytes(item, 0xffff_ffff)
      })
  })
  writer.writeConfinedCollection(transaction.outs, 0xffff_ffff, output => {
    writer.writeU64(BigInt(output.value)).writeConfinedBytes(output.script, 0xffff_ffff)
  })
  return writer.writeU32(transaction.locktime).toBytes()
}

function opout(input: FasciaInput) {
  if (input.opId.length !== 32)
    throw new RgbServiceError('Fascia input operation ID must be 32 bytes')
  return concat(input.opId, u16(input.assignmentType), u16(input.assignmentIndex))
}

/**
 * Strict-serialize an OpretFirst Fascia for one contract and one transition.
 * `witnessTx` is the unsigned wire transaction after its OP_RETURN has
 * received the MPC commitment. It is converted to RGB strict encoding.
 */
export function serializeOpretFascia(input: OpretFascia) {
  if (input.contractId.length !== 32 || input.transitionId.length !== 32) {
    throw new RgbServiceError('Fascia contract and transition IDs must be 32 bytes')
  }
  if (!input.inputs.length) throw new RgbServiceError('Fascia requires a consumed RGB input')
  const bundleInputs = input.inputs.map(opout)
  const mpcBlock = serializeMpcMerkleBlock(input.mpcMessages, input.entropy)
  return concat(
    Uint8Array.from([1]),
    serializeStrictBitcoinTransaction(input.witnessTx),
    mpcBlock,
    Uint8Array.from([2]),
    u24(1),
    input.contractId,
    u16(bundleInputs.length),
    ...bundleInputs.flatMap((encoded, index) => [encoded, input.transitionId]),
    u16(1),
    input.transitionId,
    input.transition
  )
}
