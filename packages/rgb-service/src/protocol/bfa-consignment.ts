import { RgbServiceError } from '../errors'
import { unwrapRgbTransferConsignment, wrapRgbTransferConsignment, type RgbTransferTerminal } from './consignment'
import { StrictReader, StrictWriter } from './strict'

// rgb-schemas 0.11.2-rc.1, BridgedFungibleAsset::schema_id(). The byte order
// here is the strict-encoded SchemaId in Genesis, not the baid64 display form.
export const BFA_SCHEMA_ID = '472979790677207ad4d397b7016750649478141e46bf164fcbde9cc212620297'
export const NIA_V1_SCHEMA_ID = '45687051f4cca6e3f665fc75fe3e27b30080346789ad83aa0dc29e95a315e335'
const SUPPORTED_V1_SCHEMAS = [BFA_SCHEMA_ID, NIA_V1_SCHEMA_ID]

function hex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('hex')
}

function compare(left: Uint8Array, right: Uint8Array) {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return left.length - right.length
}

function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

/**
 * Read only the schema discriminator of a v1 transfer. Use
 * validateBfaTransferConsignment for local validation before accepting funds.
 */
export function v1TransferSchemaId(value: Uint8Array): string | undefined {
  if (value.length >= 7 && value[0] === 0x52 && value[1] === 0x47 &&
    value[2] === 0x42 && value[3] === 0 && value[4] === 0x43 &&
    value[5] === 0x4f && value[6] === 0x4e) return undefined
  const reader = new StrictReader(unwrapRgbTransferConsignment(value))
  if (reader.readU8() !== 1 || reader.readU8() !== 1) return undefined
  const terminalCount = reader.readU16()
  for (let index = 0; index < terminalCount; index++) {
    reader.readFixedBytes(32)
    const sealCount = reader.readU16()
    if (!sealCount) throw new RgbServiceError('BFA transfer has an empty terminal')
    for (let seal = 0; seal < sealCount; seal++) {
      const kind = reader.readU8()
      if (kind === 1) reader.readFixedBytes(32)
      else if (kind === 0) {
        const txPtr = reader.readU8()
        if (txPtr === 1) reader.readFixedBytes(32)
        else if (txPtr !== 0) throw new RgbServiceError('BFA terminal has an invalid tx pointer')
        reader.readU32()
        reader.readU64()
      } else throw new RgbServiceError('BFA transfer has an invalid terminal seal')
    }
  }
  if (reader.readU16() !== 0) throw new RgbServiceError('RGB Genesis version is unsupported')
  return hex(reader.readFixedBytes(32))
}

export function isSupportedV1TransferConsignment(value: Uint8Array): boolean {
  return SUPPORTED_V1_SCHEMAS.includes(v1TransferSchemaId(value) || '')
}

export function isBfaTransferConsignment(value: Uint8Array): boolean {
  return v1TransferSchemaId(value) === BFA_SCHEMA_ID
}

/** Recognize the v1 BFA Genesis-only contract container in imported history. */
export function isBfaContractConsignment(value: Uint8Array): boolean {
  const reader = new StrictReader(unwrapRgbTransferConsignment(value))
  if (reader.readU8() !== 1 || reader.readU8() !== 0 || reader.readU16() !== 0) return false
  if (reader.readU16() !== 0) return false
  return hex(reader.readFixedBytes(32)) === BFA_SCHEMA_ID
}

export function isSupportedV1ContractConsignment(value: Uint8Array): boolean {
  if (value.length >= 7 && value[0] === 0x52 && value[1] === 0x47 &&
    value[2] === 0x42 && value[3] === 0 && value[4] === 0x54 &&
    value[5] === 0x46 && value[6] === 0x52) return false
  const body = unwrapRgbContractConsignment(value)
  const reader = new StrictReader(body)
  if (reader.readU8() !== 1 || reader.readU8() !== 0 || reader.readU16() !== 0) return false
  if (reader.readU16() !== 0) return false
  return SUPPORTED_V1_SCHEMAS.includes(hex(reader.readFixedBytes(32)))
}

export function unwrapRgbContractConsignment(value: Uint8Array): Uint8Array {
  const magic = Uint8Array.from([0x52, 0x47, 0x42, 0x00])
  if (value.length < 4 || !magic.every((byte, index) => value[index] === byte)) return value
  const contract = Uint8Array.from([0x43, 0x4f, 0x4e])
  if (value.length < 7 || !contract.every((byte, index) => value[index + 4] === byte))
    throw new RgbServiceError('RGB Consignment type is unsupported')
  return value.slice(7)
}

/** Strict-encode v1 transfer terminals; blind seals use BuilderSeal::Concealed. */
function encodeTerminals(terminals: RgbTransferTerminal[]): Uint8Array {
  if (terminals.length > 0xffff) throw new RgbServiceError('BFA has too many terminal bundles')
  const ordered = terminals.map(terminal => {
    if (terminal.bundleId.length !== 32 || !terminal.secretSeals.length || terminal.secretSeals.length > 0xffff)
      throw new RgbServiceError('BFA terminal is invalid')
    const seals = [...terminal.secretSeals].sort(compare)
    if (seals.some(seal => seal.length !== 32))
      throw new RgbServiceError('BFA terminal seal must be 32 bytes')
    return { bundleId: terminal.bundleId, seals }
  }).sort((left, right) => compare(left.bundleId, right.bundleId))
  if (ordered.some((item, index) => index > 0 && compare(item.bundleId, ordered[index - 1]!.bundleId) === 0))
    throw new RgbServiceError('BFA transfer has duplicate terminal bundles')
  const writer = new StrictWriter().writeU8(1).writeU8(1).writeU16(ordered.length)
  for (const terminal of ordered) {
    writer.writeFixedBytes(terminal.bundleId, 32).writeU16(terminal.seals.length)
    for (const seal of terminal.seals) writer.writeU8(1).writeFixedBytes(seal, 32)
  }
  return writer.toBytes()
}

/**
 * Locally construct a BFA transfer consignment from a locally validated contract
 * history. The caller supplies exact Genesis and ancestor v1 witness bytes;
 * the wallet constructs and signs the new transfer witness on this device.
 */
export function encodeBfaTransferConsignment(input: {
  genesis: Uint8Array
  validatedWitnessBundles: Uint8Array[]
  witnessBundle: Uint8Array
  terminals: RgbTransferTerminal[]
}): Uint8Array {
  if (input.genesis.length < 34 || !SUPPORTED_V1_SCHEMAS.includes(hex(input.genesis.slice(2, 34))))
    throw new RgbServiceError('RGB v1 transfer requires a supported Genesis')
  if (input.genesis[0] !== 0 || input.genesis[1] !== 0)
    throw new RgbServiceError('BFA Genesis version is unsupported')
  const bundles = [...input.validatedWitnessBundles, input.witnessBundle]
  if (!input.witnessBundle.length || bundles.some(bundle => !bundle.length) || bundles.length > 0xffff_ffff)
    throw new RgbServiceError('BFA transfer has invalid witness history')
  const body = concat([
    encodeTerminals(input.terminals),
    input.genesis,
    new StrictWriter().writeU32(bundles.length).toBytes(),
    ...bundles,
  ])
  const result = wrapRgbTransferConsignment(body)
  if (!isSupportedV1TransferConsignment(result))
    throw new RgbServiceError('Locally encoded BFA consignment failed its schema check')
  return result
}

/** Export only the validated v1 BFA Genesis, without ownership history. */
export function encodeBfaContractConsignment(genesis: Uint8Array): Uint8Array {
  if (genesis.length < 34 || genesis[0] !== 0 || genesis[1] !== 0 ||
    !SUPPORTED_V1_SCHEMAS.includes(hex(genesis.slice(2, 34))))
    throw new RgbServiceError('RGB v1 contract export requires a supported Genesis')
  return concat([
    new StrictWriter().writeU8(1).writeU8(0).writeU16(0).toBytes(),
    genesis,
    new StrictWriter().writeU32(0).toBytes(),
  ])
}
