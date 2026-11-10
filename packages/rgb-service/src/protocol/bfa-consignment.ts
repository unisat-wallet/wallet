import { RgbServiceError } from '../errors'
import {
  unwrapRgbTransferConsignment,
  wrapRgbTransferConsignment,
  type RgbTransferTerminal,
} from './consignment'
import { StrictReader, StrictWriter } from './strict'

// Current rgb-schemas BridgedFungibleAsset::schema_id(). The byte order here
// is the strict-encoded SchemaId in Genesis, not the baid64 display form.
export const BFA_SCHEMA_ID = 'dc8d316551109d0c58564eef0e7879b8db50c947ec993870e9d5fd9fe1af6f9a'
// rgb-schemas 0.11.2-rc.1. Assets issued with this schema remain valid and
// must stay spendable after adding support for the current BFA profile.
export const LEGACY_BFA_SCHEMA_ID = '472979790677207ad4d397b7016750649478141e46bf164fcbde9cc212620297'
export const NIA_V1_SCHEMA_ID = '45687051f4cca6e3f665fc75fe3e27b30080346789ad83aa0dc29e95a315e335'
export const BFA_SCHEMA_IDS = [BFA_SCHEMA_ID, LEGACY_BFA_SCHEMA_ID] as const
const SUPPORTED_V1_SCHEMAS = [...BFA_SCHEMA_IDS, NIA_V1_SCHEMA_ID]

export function isBfaSchemaId(schemaId: string) {
  return BFA_SCHEMA_IDS.includes(schemaId as (typeof BFA_SCHEMA_IDS)[number])
}

function hex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('hex')
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

function compare(left: Uint8Array, right: Uint8Array) {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index]! - right[index]!
  }
  return left.length - right.length
}

/** Exact transfer header emitted by wallet 1.8.2, including its terminals map. */
function encodeLegacyTerminals(terminals: RgbTransferTerminal[]): Uint8Array {
  if (terminals.length > 0xffff) throw new RgbServiceError('BFA has too many terminal bundles')
  const ordered = terminals.map(terminal => {
    if (terminal.bundleId.length !== 32 || !terminal.secretSeals.length ||
      terminal.secretSeals.length > 0xffff)
      throw new RgbServiceError('BFA terminal is invalid')
    const seals = [...terminal.secretSeals].sort(compare)
    if (seals.some(seal => seal.length !== 32))
      throw new RgbServiceError('BFA terminal seal must be 32 bytes')
    return { bundleId: terminal.bundleId, seals }
  }).sort((left, right) => compare(left.bundleId, right.bundleId))
  if (ordered.some((item, index) => index > 0 &&
    compare(item.bundleId, ordered[index - 1]!.bundleId) === 0))
    throw new RgbServiceError('BFA transfer has duplicate terminal bundles')
  const writer = new StrictWriter().writeU8(1).writeU8(1).writeU16(ordered.length)
  for (const terminal of ordered) {
    writer.writeFixedBytes(terminal.bundleId, 32).writeU16(terminal.seals.length)
    for (const seal of terminal.seals) writer.writeU8(1).writeFixedBytes(seal, 32)
  }
  return writer.toBytes()
}

function hasPrefix(value: Uint8Array, prefix: readonly number[]) {
  return value.length >= prefix.length && prefix.every((byte, index) => value[index] === byte)
}

const RGB_CONSIGNMENT_MAGIC = [0x52, 0x47, 0x42, 0x00] as const
const RGB_TRANSFER_HEADER = [...RGB_CONSIGNMENT_MAGIC, 0x54, 0x46, 0x52] as const
const RGB_CONTRACT_HEADER = [...RGB_CONSIGNMENT_MAGIC, 0x43, 0x4f, 0x4e] as const

/**
 * Convert the exact V1 layout emitted by Wallet 1.8.0-1.8.2 into current V1.
 *
 * The old layout inserted a Strict-encoded `terminals` map between the
 * transfer flag and Genesis. Current RGB derives the same graph information
 * from assignments and does not serialize the map. This reader is deliberately
 * limited to supported BFA/NIA-V1 schemas and leaves current or unrelated
 * payloads untouched.
 */
export function normalizeLegacyV1Consignment(value: Uint8Array): Uint8Array {
  const wrappedTransfer = hasPrefix(value, RGB_TRANSFER_HEADER)
  const wrappedContract = hasPrefix(value, RGB_CONTRACT_HEADER)
  if (hasPrefix(value, RGB_CONSIGNMENT_MAGIC) && !wrappedTransfer && !wrappedContract) return value
  const headerLength = wrappedTransfer || wrappedContract ? 7 : 0
  const body = value.slice(headerLength)
  if (body.length < 36 || body[0] !== 1 || (body[1] !== 0 && body[1] !== 1)) return value
  const transfer = body[1] === 1
  if ((wrappedTransfer && !transfer) || (wrappedContract && transfer)) return value

  // Current layout: version, transfer flag, Genesis version, SchemaId.
  if (body[2] === 0 && body[3] === 0 &&
    SUPPORTED_V1_SCHEMAS.includes(hex(body.slice(4, 36)))) return value

  try {
    const reader = new StrictReader(body)
    if (reader.readU8() !== 1 || reader.readU8() !== (transfer ? 1 : 0)) return value
    const terminalCount = reader.readU16()
    if (!transfer && terminalCount !== 0) return value
    let previousBundleId: string | undefined
    for (let terminalIndex = 0; terminalIndex < terminalCount; terminalIndex++) {
      const bundleId = hex(reader.readFixedBytes(32))
      if (previousBundleId !== undefined && bundleId <= previousBundleId) return value
      previousBundleId = bundleId
      const sealCount = reader.readU16()
      if (!sealCount) return value
      for (let sealIndex = 0; sealIndex < sealCount; sealIndex++) {
        const kind = reader.readU8()
        if (kind === 1) {
          reader.readFixedBytes(32)
        } else if (kind === 0) {
          const txPtr = reader.readU8()
          if (txPtr === 1) reader.readFixedBytes(32)
          else if (txPtr !== 0) return value
          reader.readU32()
          reader.readU64()
        } else return value
      }
    }
    const genesisStart = reader.position
    if (reader.readU16() !== 0) return value
    if (!SUPPORTED_V1_SCHEMAS.includes(hex(reader.readFixedBytes(32)))) return value
    const canonicalBody = concat([body.slice(0, 2), body.slice(genesisStart)])
    return headerLength ? concat([value.slice(0, headerLength), canonicalBody]) : canonicalBody
  } catch {
    return value
  }
}

/**
 * Read only the schema discriminator of a v1 transfer. Use
 * validateBfaTransferConsignment for local validation before accepting funds.
 */
export function v1TransferSchemaId(value: Uint8Array): string | undefined {
  value = normalizeLegacyV1Consignment(value)
  if (value.length >= 7 && value[0] === 0x52 && value[1] === 0x47 &&
    value[2] === 0x42 && value[3] === 0 && value[4] === 0x43 &&
    value[5] === 0x4f && value[6] === 0x4e) return undefined
  const reader = new StrictReader(unwrapRgbTransferConsignment(value))
  if (reader.readU8() !== 1 || reader.readU8() !== 1) return undefined
  if (reader.readU16() !== 0) throw new RgbServiceError('RGB Genesis version is unsupported')
  return hex(reader.readFixedBytes(32))
}

export function isSupportedV1TransferConsignment(value: Uint8Array): boolean {
  return SUPPORTED_V1_SCHEMAS.includes(v1TransferSchemaId(value) || '')
}

export function isBfaTransferConsignment(value: Uint8Array): boolean {
  const schemaId = v1TransferSchemaId(value)
  return schemaId !== undefined && isBfaSchemaId(schemaId)
}

/** Recognize the v1 BFA Genesis-only contract container in imported history. */
export function isBfaContractConsignment(value: Uint8Array): boolean {
  value = normalizeLegacyV1Consignment(value)
  const reader = new StrictReader(unwrapRgbTransferConsignment(value))
  if (reader.readU8() !== 1 || reader.readU8() !== 0) return false
  if (reader.readU16() !== 0) return false
  return isBfaSchemaId(hex(reader.readFixedBytes(32)))
}

export function isSupportedV1ContractConsignment(value: Uint8Array): boolean {
  value = normalizeLegacyV1Consignment(value)
  if (value.length >= 7 && value[0] === 0x52 && value[1] === 0x47 &&
    value[2] === 0x42 && value[3] === 0 && value[4] === 0x54 &&
    value[5] === 0x46 && value[6] === 0x52) return false
  const body = unwrapRgbContractConsignment(value)
  const reader = new StrictReader(body)
  if (reader.readU8() !== 1 || reader.readU8() !== 0) return false
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

/**
 * Locally construct a BFA transfer consignment from a locally validated contract
 * history. The caller supplies exact Genesis and ancestor v1 witness bytes;
 * the wallet constructs and signs the new transfer witness on this device.
 */
export function encodeBfaTransferConsignment(input: {
  genesis: Uint8Array
  validatedWitnessBundles: Uint8Array[]
  witnessBundle: Uint8Array
  /** Emits the exact 1.8.2 V1 container when present. Burn proofs pass an empty map. */
  legacyTerminals?: RgbTransferTerminal[]
}): Uint8Array {
  if (input.genesis.length < 34 || !SUPPORTED_V1_SCHEMAS.includes(hex(input.genesis.slice(2, 34))))
    throw new RgbServiceError('RGB v1 transfer requires a supported Genesis')
  if (input.genesis[0] !== 0 || input.genesis[1] !== 0)
    throw new RgbServiceError('BFA Genesis version is unsupported')
  const bundles = [...input.validatedWitnessBundles, input.witnessBundle]
  if (!input.witnessBundle.length || bundles.some(bundle => !bundle.length) || bundles.length > 0xffff_ffff)
    throw new RgbServiceError('BFA transfer has invalid witness history')
  const body = concat([
    input.legacyTerminals
      ? encodeLegacyTerminals(input.legacyTerminals)
      // Current RGB V1 derives graph terminals from unspent assignments.
      : new StrictWriter().writeU8(1).writeU8(1).toBytes(),
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
    new StrictWriter().writeU8(1).writeU8(0).toBytes(),
    genesis,
    new StrictWriter().writeU32(0).toBytes(),
  ])
}
