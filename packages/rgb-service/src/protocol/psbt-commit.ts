import { Psbt } from 'bitcoinjs-lib'
import { RgbServiceError } from '../errors'
import { commitMpc, serializeMpcMerkleBlock, type MpcMessage } from './mpc'
import {
  RGB_PSBT_PREFIX,
  RGB_PSBT_SUBTYPE,
  encodeProprietaryPsbtKey,
  opretHostRecord,
} from './psbt'

export interface OpretRgbPsbtCommitment {
  psbtHex: string
  hostVout: number
  entropy: bigint
  messages: MpcMessage[]
  transitionId: Uint8Array
  transition: Uint8Array
  closeMethod?: 'opretFirst'
}

export interface CommittedOpretRgbPsbt {
  psbtHex: string
  commitment: Uint8Array
  mpcProof: Uint8Array
}

interface MutableUnsignedTransaction {
  outs?: Array<{ script: Buffer }>
  tx?: MutableUnsignedTransaction
}

function u64(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn)
    throw new RgbServiceError('RGB MPC entropy is invalid')
  const bytes = new Uint8Array(8)
  for (let index = 0n; index < 8n; index++)
    bytes[Number(index)] = Number((value >> (index * 8n)) & 0xffn)
  return bytes
}

function setProprietaryRecord(
  target: { unknownKeyVals?: Array<{ key: Buffer; value: Buffer }> },
  key: Uint8Array,
  value: Uint8Array
): void {
  const record = { key: Buffer.from(key), value: Buffer.from(value) }
  const records = target.unknownKeyVals ?? []
  const index = records.findIndex(item => item.key.equals(record.key))
  if (index >= 0) records[index] = record
  else records.push(record)
  target.unknownKeyVals = records
}

function opretScript(commitment: Uint8Array): Buffer {
  if (commitment.length > 75) throw new RgbServiceError('RGB OP_RETURN commitment is too large')
  return Buffer.from([0x6a, commitment.length, ...commitment])
}

/**
 * Add an already-built local RGB transition and its LNPBP-4 proof to a PSBT.
 * The caller supplies a PSBT with an empty OP_RETURN host at `hostVout`; the
 * unsigned transaction is modified before signing.
 */
export function commitOpretRgbPsbt(input: OpretRgbPsbtCommitment): CommittedOpretRgbPsbt {
  if (input.transitionId.length !== 32)
    throw new RgbServiceError('RGB transition ID must be 32 bytes')
  const psbt = Psbt.fromHex(input.psbtHex)
  const hostOutput = psbt.txOutputs[input.hostVout]
  const hostData = psbt.data.outputs[input.hostVout]
  if (!hostOutput || !hostData || hostOutput.script[0] !== 0x6a) {
    throw new RgbServiceError('RGB Opret host output is missing')
  }
  if (hostOutput.script.length !== 1)
    throw new RgbServiceError('RGB Opret host output must be empty before commitment')

  const mpc = commitMpc(input.messages, input.entropy)
  const mpcProof = serializeMpcMerkleBlock(input.messages, input.entropy)
  for (const message of input.messages) {
    setProprietaryRecord(
      hostData,
      encodeProprietaryPsbtKey({
        prefix: RGB_PSBT_PREFIX.MPC,
        subtype: 0x00,
        keyData: message.protocolId,
      }),
      message.message
    )
  }
  setProprietaryRecord(
    hostData,
    encodeProprietaryPsbtKey({ prefix: RGB_PSBT_PREFIX.MPC, subtype: 0x01 }),
    u64(input.entropy)
  )
  setProprietaryRecord(
    hostData,
    encodeProprietaryPsbtKey({ prefix: RGB_PSBT_PREFIX.MPC, subtype: 0x10 }),
    mpc.commitment
  )
  setProprietaryRecord(
    hostData,
    encodeProprietaryPsbtKey({ prefix: RGB_PSBT_PREFIX.MPC, subtype: 0x11 }),
    mpcProof
  )
  const hostRecord = opretHostRecord()
  setProprietaryRecord(hostData, hostRecord.key, hostRecord.value)
  setProprietaryRecord(
    hostData,
    encodeProprietaryPsbtKey({
      prefix: RGB_PSBT_PREFIX.OPRET,
      subtype: RGB_PSBT_SUBTYPE.OPRET_COMMITMENT,
    }),
    mpc.commitment
  )
  setProprietaryRecord(
    psbt.data.globalMap,
    encodeProprietaryPsbtKey({
      prefix: RGB_PSBT_PREFIX.RGB,
      subtype: RGB_PSBT_SUBTYPE.RGB_TRANSITION,
      keyData: input.transitionId,
    }),
    input.transition
  )
  setProprietaryRecord(
    psbt.data.globalMap,
    encodeProprietaryPsbtKey({
      prefix: RGB_PSBT_PREFIX.RGB,
      subtype: RGB_PSBT_SUBTYPE.RGB_CLOSE_METHOD,
    }),
    Uint8Array.from([0])
  )

  // bitcoinjs keeps the unsigned transaction in the PSBT global map. Updating
  // this field before signing changes the transaction ID committed by Fascia.
  const unsignedTx = psbt.data.globalMap.unsignedTx as unknown as MutableUnsignedTransaction
  const transaction = unsignedTx.tx ?? unsignedTx
  const host = transaction.outs?.[input.hostVout]
  if (!host) throw new RgbServiceError('RGB Opret host transaction output is missing')
  host.script = opretScript(mpc.commitment)
  return { psbtHex: psbt.toHex(), commitment: mpc.commitment, mpcProof }
}
