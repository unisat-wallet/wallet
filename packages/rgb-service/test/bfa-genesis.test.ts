import { describe, expect, it } from 'vitest'
import { BFA_SCHEMA_ID, LEGACY_BFA_SCHEMA_ID } from '../src/protocol/bfa-consignment'
import { validateBfaTransferConsignment } from '../src/protocol/bfa-validator'
import { StrictWriter } from '../src/protocol/strict'

function partialBfaConsignment(extraGlobal: number) {
  const spec = new StrictWriter().writeConfinedString('BFA', 8).writeConfinedString('Bridged asset', 40)
    .writeU8(0).writeU8(8).toBytes()
  const bridge = new StrictWriter().writeU8(0).writeU64(1n).writeFixedBytes(new Uint8Array(20).fill(3), 20).toBytes()
  const rejectList = new StrictWriter().writeU8(1).writeU64(1n).writeFixedBytes(new Uint8Array(20).fill(4), 20).toBytes()
  const globals = [[2000, spec], [2001, new Uint8Array()], [3008, bridge], [extraGlobal, rejectList]] as const
  const writer = new StrictWriter().writeU8(1).writeU8(1)
    .writeU16(0).writeFixedBytes(Buffer.from(LEGACY_BFA_SCHEMA_ID, 'hex'), 32).writeU64(1n)
    .writeConfinedString('ssi:anonymous', 4096).writeU8(0).writeU8(0).writeU8(0)
    .writeU8(globals.length)
  for (const [type, value] of [...globals].sort((left, right) => left[0] - right[0]))
    writer.writeU16(type).writeU16(1).writeConfinedBytes(value, 65535)
  writer.writeU16(1).writeU16(4013).writeU8(0).writeU16(1)
    .writeU8(0).writeFixedBytes(new Uint8Array(32).fill(5), 32).writeU32(0).writeU64(1n)
    .writeU32(0) // intentionally omit witness bundles, after Genesis parsing
  return writer.toBytes()
}

function currentBfaConsignment() {
  const ticker = new StrictWriter().writeU8(3).writeFixedBytes(Buffer.from('BFA'), 3).toBytes()
  const name = new StrictWriter().writeConfinedString('Bridged asset', 40).toBytes()
  const bridge = new StrictWriter().writeU8(0).writeU64(1n)
    .writeFixedBytes(new Uint8Array(20).fill(3), 20).toBytes()
  const rejectList = new StrictWriter().writeU8(1).writeU64(1n)
    .writeFixedBytes(new Uint8Array(20).fill(4), 20).toBytes()
  const globals = [
    [2001, new Uint8Array()], [2013, new Uint8Array(32).fill(9)], [3001, name],
    [3005, Uint8Array.from([8])], [3008, bridge], [3010, rejectList], [3011, ticker],
  ] as const
  const writer = new StrictWriter().writeU8(1).writeU8(1)
    .writeU16(0).writeFixedBytes(Buffer.from(BFA_SCHEMA_ID, 'hex'), 32).writeU64(1n)
    .writeConfinedString('ssi:anonymous', 4096).writeU8(0).writeU8(0).writeU8(0)
    .writeU8(globals.length)
  for (const [type, value] of globals)
    writer.writeU16(type).writeU16(1).writeConfinedBytes(value, 65535)
  writer.writeU16(1).writeU16(4013).writeU8(0).writeU16(1)
    .writeU8(0).writeFixedBytes(new Uint8Array(32).fill(5), 32).writeU32(0).writeU64(1n)
    .writeU32(0)
  return writer.toBytes()
}

describe('BFA Genesis globals', () => {
  it('recognizes the current rgb-lib BFA schema and separate nominal fields', async () => {
    await expect(validateBfaTransferConsignment(currentBfaConsignment(), {
      network: 0, isBitcoinTxConfirmed: async () => true,
    })).rejects.toThrow('invalid witness bundle count')
  })

  it('parses the Rust schema optional EVM rejectList global', async () => {
    await expect(validateBfaTransferConsignment(partialBfaConsignment(3010), {
      network: 0, isBitcoinTxConfirmed: async () => true,
    })).rejects.toThrow('invalid witness bundle count')
  })

  it('continues to reject unsupported external link rules', async () => {
    await expect(validateBfaTransferConsignment(partialBfaConsignment(2013), {
      network: 0, isBitcoinTxConfirmed: async () => true,
    })).rejects.toThrow('unsupported Genesis global state')
  })
})
